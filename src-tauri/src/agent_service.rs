//! Active agent run registry, permission modes, and the tool-approval store
//! (DEV-121).
//!
//! The Electron gateway tracks every in-flight run so `agent:cancel` can abort
//! the provider stream mid-response, and it parks a pending approval whenever a
//! write tool is about to run. Tauri runs each scenario on a worker thread, so
//! the registry keeps one shared `AtomicBool` per run (polled between chunks)
//! and a condvar-backed approval table shared between the run thread and the
//! `agent:approval:respond` IPC handler.

use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Condvar, Mutex, OnceLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Chat-dock tool permission for one run (DEV-121).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionMode {
    /// Tools may read; every write is refused.
    Conversation,
    /// Writes are allowed but each one waits for user approval.
    Edit,
    /// Writes execute without approval, still bound by the five guardrails.
    Full,
}

impl PermissionMode {
    /// Parses the renderer-provided mode; only `chat` may upgrade beyond
    /// `conversation`, matching the Electron gateway.
    pub fn parse(value: &str, scenario: &str) -> Option<Self> {
        let mode = match value {
            "conversation" => Self::Conversation,
            "edit" => Self::Edit,
            "full" => Self::Full,
            _ => return None,
        };
        if scenario == "chat" {
            Some(mode)
        } else {
            Some(Self::Conversation)
        }
    }
}

/// Options a run carries for the whole of its lifetime.
#[derive(Debug, Clone, Default)]
pub struct RunOptions {
    pub permission_mode: Option<PermissionMode>,
    pub context_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunStatus {
    Active,
    Cancelled,
}

struct ActiveRun {
    scenario: String,
    cancelled: Arc<AtomicBool>,
    status: RunStatus,
    permission_mode: PermissionMode,
    context_paths: Vec<String>,
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
    expires_at: Arc<AtomicU64>,
}

impl RunHandle {
    /// True once someone cancelled this run, or once the run outlived its TTL.
    /// A provider that stalls without closing the connection would otherwise
    /// hang the run forever.
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst) || self.has_expired()
    }

    /// True once the run passed its wall-clock deadline.
    pub fn has_expired(&self) -> bool {
        let deadline = self.expires_at.load(Ordering::SeqCst);
        deadline != 0 && now_millis() >= deadline
    }
}

/// A snapshot of one run's policy, taken before the run thread parks on an
/// approval so the tool decision does not race the registry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunPolicy {
    pub scenario: String,
    pub permission_mode: PermissionMode,
    pub context_paths: Vec<String>,
}

/// Reads the policy for a live run, or `None` once it has finished/cancelled.
pub fn run_policy(run_id: &str) -> Option<RunPolicy> {
    let runs = registry().runs.lock().expect("agent registry lock");
    let run = runs.get(run_id)?;
    (run.status == RunStatus::Active).then(|| RunPolicy {
        scenario: run.scenario.clone(),
        permission_mode: run.permission_mode,
        context_paths: run.context_paths.clone(),
    })
}

/// Registers a run that carries a permission mode and active-document scope.
pub fn register_run_with_options(run_id: &str, scenario: &str, options: RunOptions) -> RunHandle {
    let cancelled = Arc::new(AtomicBool::new(false));
    let expires_at = Arc::new(AtomicU64::new(now_millis().saturating_add(RUN_TTL_MS)));
    registry().runs.lock().expect("agent registry lock").insert(
        run_id.to_owned(),
        ActiveRun {
            scenario: scenario.to_owned(),
            cancelled: Arc::clone(&cancelled),
            status: RunStatus::Active,
            permission_mode: options
                .permission_mode
                .unwrap_or(PermissionMode::Conversation),
            context_paths: options.context_paths,
        },
    );
    RunHandle {
        cancelled,
        expires_at,
    }
}

/// Marks a run finished and drops it from the registry.
pub fn finish_run(run_id: &str) {
    registry()
        .runs
        .lock()
        .expect("agent registry lock")
        .remove(run_id);
    // A finished run can no longer act on an approval, so pending waiters are
    // settled as denied instead of hanging until their TTL.
    revoke_run_approvals(run_id);
}

/// Cancels an active run. Returns the scenario when the cancel took effect,
/// and `None` when the run is unknown or already finished — matching the
/// Electron `cancel()` contract.
pub fn cancel_run(run_id: &str) -> Option<String> {
    let scenario = {
        let mut runs = registry().runs.lock().expect("agent registry lock");
        let run = runs.get_mut(run_id)?;
        if run.status != RunStatus::Active {
            return None;
        }
        run.cancelled.store(true, Ordering::SeqCst);
        run.status = RunStatus::Cancelled;
        run.scenario.clone()
    };
    // Wake any approval waiter immediately so the run thread stops instead of
    // sitting on the condvar until the banner TTL expires.
    revoke_run_approvals(run_id);
    Some(scenario)
}

/// Test helper: drops every registered run.
#[cfg(test)]
pub fn reset_registry() {
    registry().runs.lock().expect("agent registry lock").clear();
    reset_approvals();
}

// ── Tool approvals ─────────────────────────────────────────────────────────

/// Wall-clock lifetime of one agent run, mirroring the gateway's `TTL_MS`.
/// Exceeding it cancels the run: a provider that stalls mid-stream must not
/// hold the run open forever.
pub const RUN_TTL_MS: u64 = 10 * 60_000;

/// Approval lifetime, mirroring `APPROVAL_TTL_MS` in the Electron store.
pub const APPROVAL_TTL_MS: u64 = 5 * 60_000;

/// A pending approval handed back to the caller so it can emit the banner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalTicket {
    pub approval_id: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalDecision {
    Approved,
    Denied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalError {
    /// The approval id is unknown, already consumed, or expired.
    Expired,
}

struct PendingApproval {
    tool: String,
    run_id: String,
    expires_at: u64,
    decision: Option<ApprovalDecision>,
}

#[derive(Default)]
struct ApprovalTable {
    pending: Mutex<HashMap<String, PendingApproval>>,
    changed: Condvar,
}

fn approvals() -> &'static ApprovalTable {
    static TABLE: OnceLock<ApprovalTable> = OnceLock::new();
    TABLE.get_or_init(ApprovalTable::default)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

/// Parks an approval request and returns the id + expiry for the event.
///
/// Returns `None` when the run is no longer active: a tool cannot ask for
/// approval after the user cancelled or the run already finished.
pub fn request_approval(run_id: &str, tool: &str) -> Option<ApprovalTicket> {
    let expires_at = now_millis().saturating_add(APPROVAL_TTL_MS);
    request_approval_until(run_id, tool, expires_at)
}

fn request_approval_until(run_id: &str, tool: &str, expires_at: u64) -> Option<ApprovalTicket> {
    let runs = registry().runs.lock().expect("agent registry lock");
    let run = runs.get(run_id)?;
    if run.status != RunStatus::Active {
        return None;
    }
    drop(runs);
    let approval_id = uuid::Uuid::new_v4().to_string();
    let mut pending = approvals().pending.lock().expect("approval table lock");
    pending.insert(
        approval_id.clone(),
        PendingApproval {
            tool: tool.to_owned(),
            run_id: run_id.to_owned(),
            expires_at,
            decision: None,
        },
    );
    Some(ApprovalTicket {
        approval_id,
        expires_at,
    })
}

/// Records the user's decision and wakes the waiting run thread.
///
/// Returns `false` when the id is unknown, already decided, or expired — the
/// same rejection surface the renderer's second-response guard relies on.
pub fn respond_approval(approval_id: &str, decision: ApprovalDecision) -> bool {
    let mut pending = approvals().pending.lock().expect("approval table lock");
    let Some(entry) = pending.get_mut(approval_id) else {
        return false;
    };
    // An already-decided approval keeps its entry: the run thread has not
    // consumed the decision yet, and a duplicate response must not destroy it.
    if entry.decision.is_some() {
        return false;
    }
    if entry.expires_at <= now_millis() {
        pending.remove(approval_id);
        approvals().changed.notify_all();
        return false;
    }
    entry.decision = Some(decision);
    approvals().changed.notify_all();
    true
}

/// Blocks the run thread until the user decides, the approval expires, or the
/// run is cancelled.
pub fn wait_approval(
    approval_id: &str,
    tool: &str,
    run_id: &str,
) -> Result<ApprovalDecision, ApprovalError> {
    let mut pending = approvals().pending.lock().expect("approval table lock");
    loop {
        let Some(entry) = pending.get(approval_id) else {
            return Err(ApprovalError::Expired);
        };
        // The tool/run pair is part of the identity check: a response for one
        // tool must never release a different tool's approval.
        if entry.tool != tool || entry.run_id != run_id {
            return Err(ApprovalError::Expired);
        }
        if let Some(decision) = entry.decision {
            return Ok(decision);
        }
        let remaining = entry.expires_at.saturating_sub(now_millis());
        if remaining == 0 {
            pending.remove(approval_id);
            approvals().changed.notify_all();
            return Err(ApprovalError::Expired);
        }
        let (guard, timeout) = approvals()
            .changed
            .wait_timeout(pending, Duration::from_millis(remaining.min(200)))
            .expect("approval condvar");
        pending = guard;
        if timeout.timed_out() && pending.get(approval_id).is_some() {
            // Cancellation surfaces as a denied decision from revoke; if the
            // entry is simply gone the next loop iteration reports Expired.
            continue;
        }
    }
}

/// Settles every pending approval for one run as denied.
pub fn revoke_run_approvals(run_id: &str) {
    let mut pending = approvals().pending.lock().expect("approval table lock");
    let mut revoked = 0;
    for entry in pending.values_mut() {
        if entry.run_id == run_id && entry.decision.is_none() {
            entry.decision = Some(ApprovalDecision::Denied);
            revoked += 1;
        }
    }
    // Decided entries stay until the parked run thread consumes them, so a
    // cancellation wakes the waiter as a denial instead of an expiry.
    if revoked > 0 {
        approvals().changed.notify_all();
    }
}

/// Number of approvals currently awaiting a response.
#[cfg(test)]
pub fn pending_approval_count() -> usize {
    approvals()
        .pending
        .lock()
        .expect("approval table lock")
        .len()
}

/// Test helper: clears the approval table.
#[cfg(test)]
pub fn reset_approvals() {
    approvals()
        .pending
        .lock()
        .expect("approval table lock")
        .clear();
}

/// Test helper: parks an approval with an explicit expiry.
#[cfg(test)]
pub fn request_approval_with_expiry(
    run_id: &str,
    tool: &str,
    expires_at: u64,
) -> Option<ApprovalTicket> {
    request_approval_until(run_id, tool, expires_at)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as TestMutex;

    /// The registry is process-global, so tests that reset it must not run
    /// concurrently — one test's reset would erase another's run.
    static TEST_LOCK: TestMutex<()> = TestMutex::new(());

    /// Default registration used by registry-only tests.
    fn register(run_id: &str, scenario: &str) -> RunHandle {
        register_run_with_options(run_id, scenario, RunOptions::default())
    }

    fn with_test_lock<T>(operation: impl FnOnce() -> T) -> T {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        operation()
    }

    #[test]
    fn cancel_flips_the_flag_and_reports_the_scenario() {
        with_test_lock(|| {
            reset_registry();
            let handle = register("run-1", "chat");
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
            register("run-2", "writing");
            finish_run("run-2");
            assert_eq!(cancel_run("run-2"), None);
            reset_registry();
        });
    }

    #[test]
    fn handles_share_one_flag() {
        with_test_lock(|| {
            reset_registry();
            let first = register("run-3", "debug");
            let second = first.clone();
            cancel_run("run-3");
            assert!(first.is_cancelled());
            assert!(second.is_cancelled(), "cloned handles share the flag");
            reset_registry();
        });
    }

    #[test]
    fn permission_mode_is_forced_to_conversation_outside_chat() {
        assert_eq!(
            PermissionMode::parse("full", "chat"),
            Some(PermissionMode::Full)
        );
        assert_eq!(
            PermissionMode::parse("edit", "writing"),
            Some(PermissionMode::Conversation),
            "writing/translation never upgrade beyond conversation"
        );
        assert_eq!(PermissionMode::parse("nonsense", "chat"), None);
    }

    #[test]
    fn approved_flow_resolves_the_waiter_once() {
        with_test_lock(|| {
            reset_registry();
            register("run-approve", "chat");
            let ticket = request_approval("run-approve", "edit_current_selection").expect("ticket");
            assert_eq!(pending_approval_count(), 1);
            // A second response for the same id must be rejected: the
            // renderer relies on this to stop duplicate approvals.
            assert!(respond_approval(
                &ticket.approval_id,
                ApprovalDecision::Approved
            ));
            assert!(
                !respond_approval(&ticket.approval_id, ApprovalDecision::Denied),
                "a decided approval cannot be answered twice"
            );
            assert_eq!(
                wait_approval(&ticket.approval_id, "edit_current_selection", "run-approve"),
                Ok(ApprovalDecision::Approved)
            );
            reset_registry();
        });
    }

    #[test]
    fn denied_flow_resolves_with_denied() {
        with_test_lock(|| {
            reset_registry();
            register("run-deny", "chat");
            let ticket = request_approval("run-deny", "append_to_document").expect("ticket");
            assert!(respond_approval(
                &ticket.approval_id,
                ApprovalDecision::Denied
            ));
            assert_eq!(
                wait_approval(&ticket.approval_id, "append_to_document", "run-deny"),
                Ok(ApprovalDecision::Denied)
            );
            reset_registry();
        });
    }

    #[test]
    fn wait_rejects_a_mismatched_tool_or_run() {
        with_test_lock(|| {
            reset_registry();
            register("run-mismatch", "chat");
            let ticket = request_approval("run-mismatch", "append_to_document").expect("ticket");
            assert_eq!(
                wait_approval(
                    &ticket.approval_id,
                    "edit_current_selection",
                    "run-mismatch"
                ),
                Err(ApprovalError::Expired),
                "a response for one tool must not release another"
            );
            assert_eq!(
                wait_approval(&ticket.approval_id, "append_to_document", "other-run"),
                Err(ApprovalError::Expired)
            );
            reset_registry();
        });
    }

    #[test]
    fn expired_approvals_are_rejected_and_wake_the_waiter() {
        with_test_lock(|| {
            reset_registry();
            register("run-expiry", "chat");
            // An expiry in the past is the deterministic case: the response
            // must be refused and the waiter must observe Expired.
            let ticket =
                request_approval_with_expiry("run-expiry", "append_to_document", now_millis() - 1)
                    .expect("ticket");
            assert!(!respond_approval(
                &ticket.approval_id,
                ApprovalDecision::Approved
            ));
            assert_eq!(
                wait_approval(&ticket.approval_id, "append_to_document", "run-expiry"),
                Err(ApprovalError::Expired)
            );
            assert_eq!(pending_approval_count(), 0);
            reset_registry();
        });
    }

    #[test]
    fn cancelling_a_run_denies_its_pending_approvals() {
        with_test_lock(|| {
            reset_registry();
            register("run-cancel", "chat");
            let ticket = request_approval("run-cancel", "append_to_document").expect("ticket");
            assert_eq!(cancel_run("run-cancel").as_deref(), Some("chat"));
            // The waiter must observe the revoke as a denial so the tool loop
            // stops instead of blocking until the banner TTL.
            assert_eq!(
                wait_approval(&ticket.approval_id, "append_to_document", "run-cancel"),
                Ok(ApprovalDecision::Denied)
            );
            reset_registry();
        });
    }

    #[test]
    fn a_finished_run_cannot_request_new_approvals() {
        with_test_lock(|| {
            reset_registry();
            register("run-finished", "chat");
            finish_run("run-finished");
            assert!(request_approval("run-finished", "append_to_document").is_none());
            reset_registry();
        });
    }

    /// A run outliving its wall-clock deadline must report itself cancelled so
    /// a stalled provider cannot hold the run open forever.
    #[test]
    fn run_expiry_reports_the_handle_as_cancelled() {
        with_test_lock(|| {
            reset_registry();
            let handle = register_run_with_options(
                "run-ttl",
                "chat",
                RunOptions {
                    permission_mode: Some(PermissionMode::Edit),
                    context_paths: Vec::new(),
                },
            );
            assert!(!handle.has_expired(), "a fresh run is not expired");
            assert!(!handle.is_cancelled());
            // Force the deadline into the past.
            handle
                .expires_at
                .store(now_millis().saturating_sub(1), Ordering::SeqCst);
            assert!(handle.has_expired());
            assert!(handle.is_cancelled(), "an expired run must stop streaming");
            reset_registry();
        });
    }

    #[test]
    fn cancelled_runs_report_no_expiry() {
        with_test_lock(|| {
            reset_registry();
            let handle = register("run-not-expired", "chat");
            cancel_run("run-not-expired");
            assert!(handle.is_cancelled());
            assert!(
                !handle.has_expired(),
                "a user cancel is not a TTL expiry — the caller reports it differently"
            );
            reset_registry();
        });
    }
}
