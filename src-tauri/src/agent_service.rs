//! Active agent run registry for cancellation (DEV-121).
//!
//! The Electron gateway tracks every in-flight run so `agent:cancel` can abort
//! the provider stream mid-response. Tauri runs each scenario on a worker
//! thread, so the registry keeps one shared `AtomicBool` per run: the streaming
//! loop polls it between chunks and `agent:cancel` flips it.

use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunStatus {
    Active,
    Cancelled,
}

struct ActiveRun {
    scenario: String,
    cancelled: Arc<AtomicBool>,
    status: RunStatus,
}

#[derive(Default)]
struct Registry {
    runs: Mutex<HashMap<String, ActiveRun>>,
}

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::default)
}

/// A cancellation handle for one run. Cloning shares the same flag.
#[derive(Debug, Clone)]
pub struct RunHandle {
    cancelled: Arc<AtomicBool>,
}

impl RunHandle {
    /// True once someone cancelled this run.
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

/// Registers a new active run and returns its cancellation handle.
pub fn register_run(run_id: &str, scenario: &str) -> RunHandle {
    let cancelled = Arc::new(AtomicBool::new(false));
    registry().runs.lock().expect("agent registry lock").insert(
        run_id.to_owned(),
        ActiveRun {
            scenario: scenario.to_owned(),
            cancelled: Arc::clone(&cancelled),
            status: RunStatus::Active,
        },
    );
    RunHandle { cancelled }
}

/// Marks a run finished and drops it from the registry.
pub fn finish_run(run_id: &str) {
    registry()
        .runs
        .lock()
        .expect("agent registry lock")
        .remove(run_id);
}

/// Cancels an active run. Returns the scenario when the cancel took effect,
/// and `None` when the run is unknown or already finished — matching the
/// Electron `cancel()` contract.
pub fn cancel_run(run_id: &str) -> Option<String> {
    let mut runs = registry().runs.lock().expect("agent registry lock");
    let run = runs.get_mut(run_id)?;
    if run.status != RunStatus::Active {
        return None;
    }
    run.cancelled.store(true, Ordering::SeqCst);
    run.status = RunStatus::Cancelled;
    Some(run.scenario.clone())
}

/// Test helper: drops every registered run.
#[cfg(test)]
pub fn reset_registry() {
    registry().runs.lock().expect("agent registry lock").clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as TestMutex;

    /// The registry is process-global, so tests that reset it must not run
    /// concurrently — one test's reset would erase another's run.
    static TEST_LOCK: TestMutex<()> = TestMutex::new(());

    fn with_test_lock<T>(operation: impl FnOnce() -> T) -> T {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        operation()
    }

    #[test]
    fn cancel_flips_the_flag_and_reports_the_scenario() {
        with_test_lock(|| {
            reset_registry();
            let handle = register_run("run-1", "chat");
            assert!(!handle.is_cancelled());
            assert_eq!(cancel_run("run-1").as_deref(), Some("chat"));
            assert!(handle.is_cancelled());
            // A second cancel finds a non-active run.
            assert_eq!(cancel_run("run-1"), None);
            reset_registry();
        });
    }

    #[test]
    fn unknown_run_is_not_cancellable() {
        with_test_lock(|| {
            reset_registry();
            assert_eq!(cancel_run("missing"), None);
        });
    }

    #[test]
    fn finished_run_cannot_be_cancelled() {
        with_test_lock(|| {
            reset_registry();
            register_run("run-2", "writing");
            finish_run("run-2");
            assert_eq!(cancel_run("run-2"), None);
            reset_registry();
        });
    }

    #[test]
    fn handles_share_one_flag() {
        with_test_lock(|| {
            reset_registry();
            let first = register_run("run-3", "debug");
            let second = first.clone();
            cancel_run("run-3");
            assert!(first.is_cancelled());
            assert!(second.is_cancelled(), "cloned handles share the flag");
            reset_registry();
        });
    }
}
