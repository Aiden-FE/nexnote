//! Vault file watcher (DEV-119, replaces the Electron chokidar service).
//!
//! Watches the open vault root and emits `fs:changed` events that match the
//! reference contract exactly: vault-relative POSIX paths, `add`/`change`/
//! `unlink`/`addDir`/`unlinkDir` kinds, `format` for newly added Markdown
//! documents, and `origin: 'app'` for writes the app itself performed (so the
//! renderer never raises an external-modification conflict against itself).
//!
//! Chokidar's `awaitWriteFinish` (120ms stability) is approximated with a
//! 220ms quiet-window debounce: bursts of filesystem events for one save
//! collapse into a single emit, matching the reference behaviour.

use crate::index_service;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        mpsc::{self, RecvTimeoutError},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Runtime};

/// Quiet window that collapses a save's event burst into one emit.
const DEBOUNCE: Duration = Duration::from_millis(220);
/// App-write registrations expire quickly; only enough to outlast the debounce.
const APP_WRITE_TTL: Duration = Duration::from_secs(10);
const APP_WRITE_MAX_ENTRIES: usize = 500;

/// Tracks recent app-initiated writes so the watcher can mark them
/// `origin: 'app'`. Mirrors the reference `AppWriteTracker` (DEV-020).
#[derive(Default)]
struct AppWriteTracker {
    recent: Mutex<HashMap<String, Instant>>,
}

impl AppWriteTracker {
    fn record(&self, abs_path: &Path) {
        let mut map = self.recent.lock().expect("app write tracker lock");
        map.insert(normalize_key(abs_path), Instant::now());
        // Evict the oldest entries so a long session cannot leak unboundedly.
        while map.len() > APP_WRITE_MAX_ENTRIES {
            let Some(oldest) = map
                .iter()
                .min_by_key(|(_, at)| **at)
                .map(|(path, _)| path.clone())
            else {
                break;
            };
            map.remove(&oldest);
        }
    }

    fn is_recent(&self, abs_path: &Path) -> bool {
        let key = normalize_key(abs_path);
        let mut map = self.recent.lock().expect("app write tracker lock");
        match map.get(&key) {
            Some(at) if at.elapsed() <= APP_WRITE_TTL => true,
            Some(_) => {
                map.remove(&key);
                false
            }
            None => false,
        }
    }
}

/// Canonical form of a path, so a writer using `/var/...` matches a watcher
/// reporting `/private/var/...` on macOS. Falls back to the literal path when
/// the file no longer exists (deletions cannot be canonicalized).
fn normalize_key(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

static APP_WRITES: OnceLock<AppWriteTracker> = OnceLock::new();

fn app_writes() -> &'static AppWriteTracker {
    APP_WRITES.get_or_init(AppWriteTracker::default)
}

/// Registers a path the app itself just wrote (called from `vault_fs`).
pub fn record_app_write(abs_path: &Path) {
    app_writes().record(abs_path);
}

/// Live watcher state. A single global slot keeps switching vaults simple:
/// starting a new watcher stops the previous one first.
struct WatcherSlot {
    _watcher: RecommendedWatcher,
    _debounce_thread: std::thread::JoinHandle<()>,
}

static WATCHER: OnceLock<Mutex<Option<WatcherSlot>>> = OnceLock::new();

fn watcher_slot() -> &'static Mutex<Option<WatcherSlot>> {
    WATCHER.get_or_init(|| Mutex::new(None))
}

/// A pending change to emit once the burst settles.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingChange {
    kind: &'static str,
    relative: String,
    /// Absolute path, needed to look up `origin: 'app'`.
    absolute: PathBuf,
}

/// Maps a notify event to zero or more pending changes, dropping excluded
/// paths and normalising to vault-relative POSIX form.
fn map_event(root: &Path, event: &notify::Event) -> Vec<PendingChange> {
    let kind = match event.kind {
        EventKind::Create(notify::event::CreateKind::Folder) => "addDir",
        EventKind::Create(_) => "add",
        EventKind::Remove(notify::event::RemoveKind::Folder) => "unlinkDir",
        EventKind::Remove(_) => "unlink",
        EventKind::Modify(_) => "change",
        // Access events are read-only noise; ignore them entirely.
        _ => return Vec::new(),
    };
    let mut changes = Vec::new();
    for path in &event.paths {
        if is_excluded(root, path) {
            continue;
        }
        let Some(relative) = to_relative(root, path) else {
            continue;
        };
        if relative.is_empty() {
            continue;
        }
        changes.push(PendingChange {
            kind,
            relative,
            absolute: path.to_path_buf(),
        });
    }
    changes
}

/// Prefix strip that survives path-form mismatches between the canonical
/// watch root and what the backend reports.
///
/// Windows canonicalizes to the `\\?\C:\...` extended-length form while a
/// backend may emit events without that prefix (or the reverse); a bare
/// `strip_prefix` then fails and the event would be silently dropped — the
/// whole watcher would be dead on that platform. Retry once against the
/// canonicalized event path (existing files only; deletions keep the literal
/// form, which the app-write tracker also uses for them).
fn strip_root<'a>(root: &Path, path: &'a Path) -> Option<std::borrow::Cow<'a, Path>> {
    if let Ok(relative) = path.strip_prefix(root) {
        return Some(std::borrow::Cow::Borrowed(relative));
    }
    let canonical = std::fs::canonicalize(path).ok()?;
    let relative = canonical.strip_prefix(root).ok()?;
    Some(std::borrow::Cow::Owned(relative.to_path_buf()))
}

/// `.nexnote`, `.git`, `.trash` and `node_modules` are never user content.
fn is_excluded(root: &Path, path: &Path) -> bool {
    let Some(relative) = strip_root(root, path) else {
        return true;
    };
    relative.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| crate::vault_fs::EXCLUDED_DIRS.contains(&name))
    })
}

/// Vault-relative path with forward slashes, or `None` when outside the root.
fn to_relative(root: &Path, path: &Path) -> Option<String> {
    let relative = strip_root(root, path)?;
    let text = relative.to_string_lossy().replace('\\', "/");
    if text.starts_with("..") || text.contains(':') {
        return None;
    }
    Some(text)
}

/// Reads the sidecar metadata format for a newly added Markdown document.
fn document_format(root: &Path, relative: &str) -> Option<&'static str> {
    if !relative.rsplit_once('.').is_some_and(|(_, ext)| {
        ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown")
    }) {
        return None;
    }
    let metadata = crate::vault_fs::read_metadata(root, relative)?;
    match metadata.get("format")?.as_str()? {
        "markdown" => Some("markdown"),
        "native-block" => Some("native-block"),
        _ => None,
    }
}

/// Starts watching `root`, stopping any previous watcher first. Safe to call
/// repeatedly when switching vaults.
pub fn start<R: Runtime>(app: &tauri::AppHandle<R>, root: &Path) {
    stop();
    // FSEvents and friends report canonical paths; without this a symlinked
    // location (`/var` → `/private/var`) makes every event fail its own
    // prefix check and get dropped — the reference service realpaths for the
    // same reason.
    let captured_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let (tx, rx) = mpsc::channel::<notify::Event>();
    let mut watcher =
        match notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            if let Ok(event) = result {
                let _ = tx.send(event);
            }
        }) {
            Ok(watcher) => watcher,
            Err(error) => {
                eprintln!("[watcher] failed to create watcher: {error}");
                return;
            }
        };
    if let Err(error) = watcher.watch(&captured_root, RecursiveMode::Recursive) {
        eprintln!(
            "[watcher] failed to watch {}: {error}",
            captured_root.display()
        );
        return;
    }
    let debounce_root = captured_root.clone();
    let debounce_app = app.clone();
    let debounce_thread = std::thread::Builder::new()
        .name("nexnote-vault-watch".to_string())
        .spawn(move || debounce_loop(debounce_app, debounce_root, rx))
        .ok();
    let Some(debounce_thread) = debounce_thread else {
        return;
    };
    *watcher_slot().lock().expect("watcher slot lock") = Some(WatcherSlot {
        _watcher: watcher,
        _debounce_thread: debounce_thread,
    });
}

/// Stops the active watcher, if any.
pub fn stop() {
    let taken = watcher_slot().lock().expect("watcher slot lock").take();
    drop(taken);
}

/// Collects events until the burst goes quiet, then emits one event per change
/// and drives the incremental index. Directory changes schedule a full rebuild.
fn debounce_loop<R: Runtime>(
    app: tauri::AppHandle<R>,
    root: PathBuf,
    rx: mpsc::Receiver<notify::Event>,
) {
    let mut pending: Vec<PendingChange> = Vec::new();
    loop {
        match rx.recv_timeout(DEBOUNCE) {
            Ok(event) => {
                pending.extend(map_event(&root, &event));
            }
            Err(RecvTimeoutError::Timeout) => {
                if !pending.is_empty() {
                    flush(&app, &root, std::mem::take(&mut pending));
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                // The watcher was dropped: flush what is left, then exit.
                if !pending.is_empty() {
                    flush(&app, &root, pending);
                }
                return;
            }
        }
    }
}

/// Emits one `fs:changed` event per change and updates the index accordingly.
fn flush<R: Runtime>(app: &tauri::AppHandle<R>, root: &Path, changes: Vec<PendingChange>) {
    let mut needs_rebuild = false;
    for change in changes {
        let mut event = json!({ "kind": change.kind, "path": change.relative });
        if (change.kind == "add" || change.kind == "change")
            && app_writes().is_recent(&change.absolute)
        {
            event["origin"] = json!("app");
        }
        if change.kind == "add" {
            if let Some(format) = document_format(root, &change.relative) {
                event["format"] = json!(format);
            }
        }
        let _ = app.emit("fs:changed", event);

        match change.kind {
            "add" | "change" => {
                index_service::update_page(root, &change.relative);
                let _ = app.emit(
                    "index:statusChanged",
                    index_service::status(root)["data"].clone(),
                );
            }
            "unlink" => {
                index_service::remove_page(root, &change.relative);
                let _ = app.emit(
                    "index:statusChanged",
                    index_service::status(root)["data"].clone(),
                );
            }
            // Directory churn cascades into many descendants; one rebuild covers it.
            _ => needs_rebuild = true,
        }
    }
    if needs_rebuild {
        index_service::rebuild(root);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index_service;
    use serde_json::Value;
    use std::{fs, sync::mpsc, time::Duration};
    use tauri::Listener;

    #[test]
    fn relative_paths_use_forward_slashes() {
        let root = Path::new("/vault");
        assert_eq!(
            to_relative(root, Path::new("/vault/docs/notes/a.md")).as_deref(),
            Some("docs/notes/a.md")
        );
        assert_eq!(to_relative(root, Path::new("/vault")).as_deref(), Some(""));
        assert_eq!(to_relative(root, Path::new("/elsewhere/a.md")), None);
    }

    #[test]
    fn excluded_directories_are_never_watched() {
        let root = Path::new("/vault");
        assert!(is_excluded(root, Path::new("/vault/.nexnote/index.db")));
        assert!(is_excluded(root, Path::new("/vault/.git/config")));
        assert!(is_excluded(root, Path::new("/vault/node_modules/x/y.js")));
        assert!(is_excluded(root, Path::new("/vault/docs/.trash/a.md")));
        assert!(!is_excluded(root, Path::new("/vault/docs/a.md")));
        assert!(is_excluded(root, Path::new("/outside/a.md")));
    }

    #[test]
    fn map_event_filters_access_and_excluded_paths() {
        let root = Path::new("/vault");
        let access = notify::Event {
            kind: EventKind::Access(notify::event::AccessKind::Read),
            paths: vec![PathBuf::from("/vault/a.md")],
            attrs: Default::default(),
        };
        assert!(map_event(root, &access).is_empty());

        let create = notify::Event {
            kind: EventKind::Create(notify::event::CreateKind::File),
            paths: vec![
                PathBuf::from("/vault/docs/a.md"),
                PathBuf::from("/vault/.nexnote/index.db"),
            ],
            attrs: Default::default(),
        };
        let mapped = map_event(root, &create);
        assert_eq!(mapped.len(), 1);
        assert_eq!(mapped[0].kind, "add");
        assert_eq!(mapped[0].relative, "docs/a.md");
    }

    #[test]
    fn app_write_tracker_expires_entries() {
        let tracker = AppWriteTracker::default();
        let path = PathBuf::from("/vault/docs/a.md");
        assert!(!tracker.is_recent(&path));
        tracker.record(&path);
        assert!(tracker.is_recent(&path));
        // Simulate expiry by rewriting with an old timestamp.
        tracker.recent.lock().expect("tracker lock").insert(
            path.to_string_lossy().into_owned(),
            Instant::now() - APP_WRITE_TTL * 2,
        );
        assert!(!tracker.is_recent(&path));
    }

    #[test]
    fn app_write_tracker_evicts_beyond_capacity() {
        let tracker = AppWriteTracker::default();
        for index in 0..(APP_WRITE_MAX_ENTRIES + 10) {
            tracker.record(&PathBuf::from(format!("/vault/{index}.md")));
        }
        let map = tracker.recent.lock().expect("tracker lock");
        assert_eq!(map.len(), APP_WRITE_MAX_ENTRIES);
    }

    /// End-to-end: a real notify watcher on a temp vault streams `fs:changed`
    /// with the reference contract (relative path, kind, origin) and drives
    /// incremental indexing. Requires no window — the mock runtime suffices.
    #[test]
    fn watcher_streams_events_and_updates_index_end_to_end() {
        index_service::with_test_lock(|| {
            let root = std::env::temp_dir().join(format!(
                "nexnote-watcher-e2e-{}-{}",
                std::process::id(),
                Instant::now().elapsed().as_nanos()
            ));
            fs::create_dir_all(root.join(".nexnote")).expect("create vault");
            // The watcher canonicalizes its root; the test must use the same
            // identity or every call would reopen (and re-migrate) the index.
            let root = fs::canonicalize(&root).expect("canonical vault root");
            let app = tauri::test::mock_app();
            let handle = app.handle();
            let (events_tx, events_rx) = mpsc::channel::<String>();
            handle.listen("fs:changed", move |event| {
                let _ = events_tx.send(event.payload().to_string());
            });

            start(handle, &root);

            // External write: no origin field.
            fs::write(root.join("Watcher.md"), "# Watcher\n\nContent here.\n")
                .expect("write external file");
            let first = recv_json(&events_rx, "external add");
            assert_eq!(first["kind"], "add");
            assert_eq!(first["path"], "Watcher.md");
            assert!(first.get("origin").is_none());
            wait_for_page(&root, "Watcher");

            // Let any residual events from the first write flush, then drain
            // them: the next assertion must observe the *next* write only.
            std::thread::sleep(DEBOUNCE * 3);
            while events_rx.try_recv().is_ok() {}

            // App write: the same file change carries origin:"app".
            let target = root.join("Watcher.md");
            record_app_write(&target);
            fs::write(&target, "# Watcher\n\nUpdated content.\n").expect("rewrite file");
            // A single write can surface as Create + Modify(Metadata) +
            // Modify(Data), so wait for the change event specifically.
            let second = recv_kind(&events_rx, "change", "app change");
            assert_eq!(second["kind"], "change");
            assert_eq!(second["path"], "Watcher.md");
            assert_eq!(second["origin"], "app");

            // Unlink removes both the event and the indexed page.
            fs::remove_file(&target).expect("remove file");
            let third = recv_kind(&events_rx, "unlink", "unlink");
            assert_eq!(third["kind"], "unlink");
            assert_eq!(third["path"], "Watcher.md");
            wait_for_page_removal(&root, "Watcher");

            stop();
            index_service::close();
            let _ = fs::remove_dir_all(&root);
        });
    }

    /// Receives one JSON payload or fails with context after 5 seconds.
    fn recv_json(rx: &mpsc::Receiver<String>, context: &str) -> Value {
        rx.recv_timeout(Duration::from_secs(5))
            .unwrap_or_else(|error| panic!("fs:changed event missing ({context}): {error}"))
            .parse()
            .unwrap_or_else(|error| panic!("fs:changed payload is not JSON ({context}): {error}"))
    }

    /// Receives events until one of `kind` arrives; a single write can emit
    /// several event kinds within one debounce window.
    fn recv_kind(rx: &mpsc::Receiver<String>, kind: &str, context: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            let event = recv_json(rx, context);
            if event["kind"] == kind {
                return event;
            }
        }
        panic!("no {kind} event arrived ({context})");
    }

    /// Polls until the page is indexed; the index write happens after emit.
    fn wait_for_page(root: &Path, stem: &str) {
        for _ in 0..50 {
            let result = index_service::search(root, &json!({ "query": stem, "limit": 5 }));
            if result["ok"] == true {
                let hits = result["data"].as_array().cloned().unwrap_or_default();
                if hits
                    .iter()
                    .any(|hit| hit["path"].as_str().is_some_and(|p| p.starts_with(stem)))
                {
                    return;
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("watcher never indexed {stem}");
    }

    /// Polls until the page is gone from the index.
    fn wait_for_page_removal(root: &Path, stem: &str) {
        for _ in 0..50 {
            let result = index_service::search(root, &json!({ "query": stem, "limit": 5 }));
            let gone = result["data"].as_array().is_none_or(|hits| {
                hits.iter()
                    .all(|hit| !hit["path"].as_str().is_some_and(|p| p.starts_with(stem)))
            });
            if gone {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("watcher never removed {stem} from the index");
    }

    /// Windows canonicalizes to the `\\?\` extended-length form while a
    /// backend may report events without it; the retry in `strip_root` must
    /// re-couple such a path to the root instead of dropping the event. A
    /// symlinked root reproduces the same "two forms for one directory"
    /// situation on macOS without needing a Windows machine.
    #[test]
    fn strip_root_recovers_when_the_reported_form_differs_from_the_root() {
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let base =
            std::env::temp_dir().join(format!("nexnote-strip-root-{}-{id}", std::process::id()));
        let real = base.join("real-vault");
        fs::create_dir_all(real.join("notes")).expect("create real root");
        fs::write(real.join("notes/a.md"), "content").expect("seed file");
        // Canonical root, symlink-formed event path: the literal strip fails.
        let canonical_root = fs::canonicalize(&real).expect("canonical root");
        let link = base.join("link-vault");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        let event = link.join("notes/a.md");
        assert!(event.strip_prefix(&canonical_root).is_err());
        let relative = strip_root(&canonical_root, &event).expect("retry must recover");
        assert_eq!(relative, std::path::Path::new("notes/a.md"));
        // A path outside the root stays rejected after the retry.
        let outsider = base.join("elsewhere.md");
        fs::write(&outsider, "x").expect("outsider");
        assert!(strip_root(&canonical_root, &outsider).is_none());
        fs::remove_dir_all(&base).ok();
    }
}
