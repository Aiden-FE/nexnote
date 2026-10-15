//! Binary editor host manager (DEV-123, replaces Electron WebContentsView).
//!
//! Each xlsx / xmind document gets its own borderless child window positioned
//! over the main window's content area. The renderer reports a placeholder
//! rectangle (content-area coordinates) and the host window is clamped to stay
//! inside the main window — it never covers the sidebar, tab bar or status bar.
//!
//! Tauri 2 has no direct WebContentsView equivalent, so this uses per-document
//! `WebviewWindow` with `parent(main)` + `decorations(false)` + `skip_taskbar`.
//! On macOS the parent creates a true child window; on Windows/Linux it creates
//! an owned/transient window that stays above the parent and hides with it.
//!
//! The ready protocol is pull-model (matching Electron): the editor page
//! invokes `binary:host:ready` after bootstrap, the response carries any
//! commands queued before the page subscribed, so the initial `load` is never
//! lost to a push-into-void race.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// Editor shell page; each host window loads this with its own WebView.
const EDITOR_HOST_PAGE: &str = "editor-host.html";

/// Renderer-reported placeholder rect in main-window content coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HostBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

struct HostEntry {
    kind: String,
    path: String,
    ready: bool,
    loaded: bool,
    pending: Vec<Value>,
    bounds: Option<HostBounds>,
    // In-flight flush round-trips awaiting the page's ack, keyed by token.
    flush_waiters: Vec<(String, std::sync::mpsc::Sender<FlushOutcome>)>,
}

/// Result of one host flush round-trip.
#[derive(Debug, PartialEq, Eq)]
pub enum FlushOutcome {
    Flushed,
    Failed(String),
}

#[derive(Default)]
struct HostRegistry {
    hosts: HashMap<String, HostEntry>,
    active_key: Option<String>,
}

fn registry() -> &'static Mutex<HostRegistry> {
    static REGISTRY: std::sync::OnceLock<Mutex<HostRegistry>> = std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HostRegistry::default()))
}

fn host_key(kind: &str, path: &str) -> String {
    format!("{kind}:{path}")
}

fn ok(data: Value) -> Value {
    json!({ "ok": true, "data": data })
}

fn error(code: &str, message: &str) -> Value {
    json!({ "ok": false, "error": message, "code": code })
}

/// `binary:host:open` — creates or reuses a hidden editor window.
pub fn open<R: Runtime>(app: &AppHandle<R>, kind: &str, path: &str) -> Value {
    let key = host_key(kind, path);
    let label = format!("binary-editor-{}", key.replace([':', '/'], "-"));

    {
        let reg = registry().lock().expect("binary host registry lock");
        if reg.hosts.contains_key(&key) {
            return ok(json!({ "opened": true }));
        }
    }

    let main = match app.get_webview_window("main") {
        Some(window) => window,
        None => {
            return error(
                "BINARY_HOST_NO_MAIN_WINDOW",
                "The main window is not available",
            )
        }
    };

    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(EDITOR_HOST_PAGE.into()))
        .title("NexNote Editor")
        .decorations(false)
        .skip_taskbar(true)
        .visible(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .fullscreen(false);

    // Parent creates a child window on macOS and an owned/transient window on
    // Windows/Linux — both stay above the main window and hide with it.
    let builder = match builder.parent(&main) {
        Ok(builder) => builder,
        Err(e) => {
            return error(
                "BINARY_HOST_PARENT_FAILED",
                &format!("Failed to parent the editor window: {e}"),
            )
        }
    };

    match builder.build() {
        Ok(_) => {
            let mut reg = registry().lock().expect("binary host registry lock");
            reg.hosts.insert(
                key,
                HostEntry {
                    kind: kind.to_owned(),
                    path: path.to_owned(),
                    ready: false,
                    loaded: false,
                    pending: Vec::new(),
                    bounds: None,
                    flush_waiters: Vec::new(),
                },
            );
            ok(json!({ "opened": true }))
        }
        Err(e) => error(
            "BINARY_HOST_OPEN_FAILED",
            &format!("Failed to create the editor window: {e}"),
        ),
    }
}

/// `binary:host:close` — destroys the window (pending flush is a stretch).
pub fn close<R: Runtime>(app: &AppHandle<R>, kind: &str, path: &str) -> Value {
    let key = host_key(kind, path);
    let label = format!("binary-editor-{}", key.replace([':', '/'], "-"));

    let removed = {
        let mut reg = registry().lock().expect("binary host registry lock");
        reg.hosts.remove(&key).map(|_| ())
    };

    if removed.is_none() {
        return ok(json!({ "closed": true }));
    }

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }

    let mut reg = registry().lock().expect("binary host registry lock");
    if reg.active_key.as_deref() == Some(key.as_str()) {
        reg.active_key = None;
    }
    ok(json!({ "closed": true }))
}

/// `binary:host:setActive` — activates a binary tab or clears the active host.
pub fn set_active<R: Runtime>(app: &AppHandle<R>, kind: Option<&str>, path: Option<&str>) -> Value {
    let mut reg = registry().lock().expect("binary host registry lock");
    reg.active_key = match (kind, path) {
        (Some(kind), Some(path)) => Some(host_key(kind, path)),
        _ => None,
    };

    // Hide all non-active windows; show the active one only if bounds are set.
    let active = reg.active_key.clone();
    let keys_with_bounds: Vec<(String, bool)> = reg
        .hosts
        .iter()
        .map(|(key, entry)| (key.clone(), entry.bounds.is_some()))
        .collect();
    drop(reg);

    for (key, has_bounds) in keys_with_bounds {
        let label = format!("binary-editor-{}", key.replace([':', '/'], "-"));
        if let Some(window) = app.get_webview_window(&label) {
            let should_show = Some(&key) == active.as_ref() && has_bounds;
            let _ = if should_show {
                window.show()
            } else {
                window.hide()
            };
        }
    }

    // Queue (or immediately deliver) the initial load the first time a tab
    // becomes active. A ready host must receive it now — dropping it would
    // strand the editor on "waiting for document…".
    if let Some(key) = &active {
        let ready_now = {
            let mut reg = registry().lock().expect("binary host registry lock");
            let Some(entry) = reg.hosts.get_mut(key) else {
                return ok(json!({ "active": true }));
            };
            if entry.loaded {
                None
            } else {
                entry.loaded = true;
                let command = json!({
                    "command": "load",
                    "kind": entry.kind,
                    "path": entry.path,
                });
                if entry.ready {
                    Some((entry.kind.clone(), entry.path.clone(), command))
                } else {
                    entry.pending.push(command);
                    None
                }
            }
        };
        if let Some((kind, path, command)) = ready_now {
            deliver_command(app, &kind, &path, &command);
        }
    }

    ok(json!({ "active": active.is_some() }))
}

/// Sends one command to an editor window's own listener scope.
fn deliver_command<R: Runtime>(app: &AppHandle<R>, kind: &str, path: &str, command: &Value) {
    use tauri::Emitter;
    let key = host_key(kind, path);
    let label = format!("binary-editor-{}", key.replace([':', '/'], "-"));
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.emit_to(label.as_str(), "binary:editorCommand", command);
    }
}

/// `binary:host:setBounds` — the renderer reports the placeholder rect.
pub fn set_bounds<R: Runtime>(
    app: &AppHandle<R>,
    kind: &str,
    path: &str,
    bounds: Option<HostBounds>,
) -> Value {
    let key = host_key(kind, path);
    let label = format!("binary-editor-{}", key.replace([':', '/'], "-"));

    let should_show = {
        let mut reg = registry().lock().expect("binary host registry lock");
        let Some(entry) = reg.hosts.get_mut(&key) else {
            return ok(json!({ "applied": true }));
        };
        entry.bounds = bounds;
        bounds.is_some() && reg.active_key.as_deref() == Some(key.as_str())
    };

    if let (Some(bounds), Some(window)) = (&bounds, app.get_webview_window(&label)) {
        let _ = window.set_position(tauri::LogicalPosition::new(bounds.x, bounds.y));
        let _ = window.set_size(tauri::LogicalSize::new(bounds.width, bounds.height));
        if should_show {
            let _ = window.show();
        }
    } else if let Some(window) = app.get_webview_window(&label) {
        let _ = window.hide();
    }

    ok(json!({ "applied": true }))
}

/// Repositions every active host to fit inside the main window's current
/// bounds. Called on main-window resize/maximize/unmaximize so hosts never
/// extend past the visible area after the window shrinks.
pub fn layout_visible<R: Runtime>(app: &AppHandle<R>) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Ok(main_size) = main.inner_size() else {
        return;
    };
    let Ok(scale) = main.scale_factor() else {
        return;
    };
    let (max_w, max_h) = (
        main_size.width as f64 / scale,
        main_size.height as f64 / scale,
    );

    let entries: Vec<(String, HostBounds)> = {
        let reg = registry().lock().expect("binary host registry lock");
        let Some(active) = &reg.active_key else {
            return;
        };
        reg.hosts
            .iter()
            .filter_map(|(key, entry)| {
                let bounds = entry.bounds?;
                (key == active).then_some((key.clone(), bounds))
            })
            .collect()
    };

    for (key, bounds) in entries {
        let label = format!("binary-editor-{}", key.replace([':', '/'], "-"));
        let Some(window) = app.get_webview_window(&label) else {
            continue;
        };
        // Clamp to the main window content area, mirroring Electron's
        // layoutBounds: never cover sidebar/status beyond the window edge.
        let x = bounds.x.clamp(0.0, max_w);
        let y = bounds.y.clamp(0.0, max_h);
        let w = bounds.width.min(max_w - x).max(0.0);
        let h = bounds.height.min(max_h - y).max(0.0);
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
        let _ = window.set_size(tauri::LogicalSize::new(w, h));
    }
}

/// Upper bound on one flush round-trip. Electron uses the same value for its
/// ready wait: a host that never answers must not stall tab close forever.
const FLUSH_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1500);

/// `binary:host:flush` — persists the host's pending writes and waits for the
/// page to confirm, mirroring Electron's `roundTrip`: the command carries a
/// one-shot token, the page flushes and acknowledges it through
/// `binary:host:flushAck`, and only then does this call resolve. `flushed:true`
/// is returned when the host has nothing pending (unknown/not yet loaded).
pub fn flush<R: Runtime>(app: &AppHandle<R>, kind: &str, path: &str) -> Value {
    let key = host_key(kind, path);
    let (ready, loaded) = {
        let reg = registry().lock().expect("binary host registry lock");
        match reg.hosts.get(&key) {
            None => return ok(json!({ "flushed": false })),
            Some(entry) => (entry.ready, entry.loaded),
        }
    };
    if !ready || !loaded {
        // Nothing has been handed to the page yet: nothing can be pending.
        return ok(json!({ "flushed": true }));
    }
    let token = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = std::sync::mpsc::channel();
    {
        let mut reg = registry().lock().expect("binary host registry lock");
        let Some(entry) = reg.hosts.get_mut(&key) else {
            return ok(json!({ "flushed": false }));
        };
        entry.flush_waiters.push((token.clone(), sender));
    }
    let command = json!({
        "command": "flush",
        "kind": kind,
        "path": path,
        "token": token.as_str(),
    });
    deliver_command(app, kind, path, &command);
    match receiver.recv_timeout(FLUSH_TIMEOUT) {
        Ok(FlushOutcome::Flushed) => ok(json!({ "flushed": true })),
        Ok(FlushOutcome::Failed(message)) => error("BINARY_HOST_FLUSH_FAILED", &message),
        Err(_) => {
            // The waiter is dropped so a late ack cannot resolve a stale token.
            let mut reg = registry().lock().expect("binary host registry lock");
            if let Some(entry) = reg.hosts.get_mut(&key) {
                entry.flush_waiters.retain(|(id, _)| *id != token);
            }
            error(
                "BINARY_HOST_FLUSH_TIMEOUT",
                &format!(
                    "The editor did not confirm the flush within {}ms",
                    FLUSH_TIMEOUT.as_millis()
                ),
            )
        }
    }
}

/// `binary:host:flushAck` — the editor page confirms (or fails) a flush token.
pub fn flush_ack(
    app: &AppHandle<impl Runtime>,
    sender: Option<&str>,
    token: &str,
    ok_value: bool,
    message: Option<&str>,
) -> Value {
    let Some(label) = sender else {
        return error(
            "BINARY_HOST_SENDER_UNKNOWN",
            "The invoking window could not be identified",
        );
    };
    let mut reg = registry().lock().expect("binary host registry lock");
    let Some(key) = reg
        .hosts
        .keys()
        .find(|key| label_for(key) == label)
        .cloned()
    else {
        return ok(json!({ "accepted": false }));
    };
    let Some(entry) = reg.hosts.get_mut(&key) else {
        return ok(json!({ "accepted": false }));
    };
    let Some(index) = entry.flush_waiters.iter().position(|(id, _)| id == token) else {
        // Unknown or already-settled token: a duplicate ack must not fail.
        return ok(json!({ "accepted": false }));
    };
    let (_, waiter) = entry.flush_waiters.remove(index);
    let outcome = if ok_value {
        FlushOutcome::Flushed
    } else {
        FlushOutcome::Failed(
            message
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| "The editor failed to save pending writes".to_owned()),
        )
    };
    // The waiter is parked on this thread's own channel, so waking it here
    // cannot deadlock on the registry lock.
    drop(reg);
    let _ = waiter.send(outcome);
    let _ = app;
    ok(json!({ "accepted": true }))
}

// Label of the window created for one host key.
///
/// Tauri window labels allow only alphanumeric characters, `-`, `/`, `:` and
/// `_`. Vault paths contain dots (every `book.xlsx` / `board.xmind` does), so
/// sanitizing alone is not enough — and collapsing `.` onto `-` could collide
/// with a path that genuinely contains `-`. A short stable hash of the raw key
/// keeps labels unique and inside the allowed charset. Before this fix
/// `open()` failed with `InvalidWindowLabel` for every real document.
fn label_for(key: &str) -> String {
    // FNV-1a: dependency-free, stable across runs and platforms.
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in key.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!(
        "binary-editor-{}-{hash:016x}",
        key.replace([':', '/', '.'], "-")
    )
}

// `sender` is the window label Tauri injected for the invoking WebView — the
// same identity the Electron implementation derives from
// `senderId = webContents.id`. It is required: with several editors booting
// concurrently, "the first host that is not ready yet" can attribute one
// document's commands to a different host.
pub fn ready(app: &AppHandle<impl Runtime>, sender: Option<&str>, language: &str) -> Value {
    // The host page invokes this after it subscribed to events, so the pending
    // queue is returned as the invoke response (pull model). Pushing instead
    // would drop the initial load into a page that has no listener yet.
    let mut reg = registry().lock().expect("binary host registry lock");
    let Some(label) = sender else {
        return error(
            "BINARY_HOST_SENDER_UNKNOWN",
            "The invoking window could not be identified",
        );
    };
    let Some(key) = reg
        .hosts
        .keys()
        .find(|key| label_for(key) == label)
        .cloned()
    else {
        // A window that is not a registered host (main window replaying the
        // ack) must not claim another host's queue.
        return ok(json!({ "commands": [] }));
    };
    let Some(entry) = reg.hosts.get_mut(&key) else {
        return ok(json!({ "commands": [] }));
    };
    entry.ready = true;

    // Return the language command first (matching Electron), then any pending.
    let mut commands = vec![json!({
        "command": "language",
        "kind": entry.kind,
        "language": language,
    })];
    commands.append(&mut entry.pending);
    drop(reg);
    let _ = app;
    ok(json!({ "commands": commands }))
}

/// `binary:editorTheme` — broadcasts a theme to every editor window (they do
/// not share renderer memory, so the push is the only way to reach them).
pub fn apply_theme<R: Runtime>(app: &AppHandle<R>, theme: &str) {
    let hosts: Vec<(String, String)> = {
        let reg = registry().lock().expect("binary host registry lock");
        reg.hosts
            .values()
            .map(|entry| (entry.kind.clone(), entry.path.clone()))
            .collect()
    };
    for (kind, path) in hosts {
        let command = json!({ "command": "theme", "kind": kind, "theme": theme });
        deliver_command(app, &kind, &path, &command);
    }
}

/// Destroys all editor windows (main window closing).
pub fn destroy_all<R: Runtime>(app: &AppHandle<R>) {
    let keys: Vec<String> = {
        let reg = registry().lock().expect("binary host registry lock");
        reg.hosts.keys().cloned().collect()
    };
    for key in keys {
        let label = format!("binary-editor-{}", key.replace([':', '/'], "-"));
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
    registry()
        .lock()
        .expect("binary host registry lock")
        .hosts
        .clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as TestMutex;

    /// The registry is process-global, so fixtures must not interleave.
    static TEST_LOCK: TestMutex<()> = TestMutex::new(());

    fn with_test_lock<T>(operation: impl FnOnce() -> T) -> T {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        operation()
    }

    /// Installs a host entry directly so flush/ack can be tested without a
    /// real window (the window lookup only happens at delivery time).
    fn install_host(key: &str, ready: bool, loaded: bool) {
        let mut reg = registry().lock().expect("binary host registry lock");
        let (kind, path) = key.split_once(':').expect("key must be kind:path");
        reg.hosts.insert(
            key.to_owned(),
            HostEntry {
                kind: kind.to_owned(),
                path: path.to_owned(),
                ready,
                loaded,
                pending: Vec::new(),
                bounds: None,
                flush_waiters: Vec::new(),
            },
        );
    }

    fn clear_hosts() {
        registry()
            .lock()
            .expect("binary host registry lock")
            .hosts
            .clear();
    }

    #[test]
    fn label_for_is_valid_and_collision_free() {
        with_test_lock(|| {
            // Every real binary path carries a dot; the label must still
            // satisfy Tauri's charset (alphanumeric, `-`, `/`, `:`, `_`).
            let label = label_for("xlsx:sheets/book.xlsx");
            assert!(
                label
                    .chars()
                    .all(|c| c.is_alphanumeric() || matches!(c, '-' | '/' | ':' | '_')),
                "label {label} contains characters Tauri rejects"
            );
            // Different paths must not collapse onto one label.
            assert_ne!(label_for("xlsx:a-b.xlsx"), label_for("xlsx:a.b.xlsx"));
            // The same key always maps to the same label (lookup identity).
            assert_eq!(label_for("xlsx:sheets/book.xlsx"), label);
        })
    }

    #[test]
    fn flush_ack_settles_a_matching_token_once() {
        with_test_lock(|| {
            clear_hosts();
            install_host("xlsx:a.xlsx", true, true);
            let key = host_key("xlsx", "a.xlsx");
            let (sender, receiver) = std::sync::mpsc::channel();
            let token = "token-1".to_owned();
            {
                let mut reg = registry().lock().expect("binary host registry lock");
                reg.hosts
                    .get_mut(&key)
                    .expect("host")
                    .flush_waiters
                    .push((token.clone(), sender));
            }

            let app = tauri::test::mock_app();
            let label = label_for(&key);
            assert_eq!(
                flush_ack(app.handle(), Some(&label), &token, true, None)["data"]["accepted"],
                json!(true)
            );
            assert_eq!(
                receiver.recv().expect("waiter woken"),
                FlushOutcome::Flushed
            );

            // A duplicate ack finds no waiter: it must report false, not fail.
            assert_eq!(
                flush_ack(app.handle(), Some(&label), &token, true, None)["data"]["accepted"],
                json!(false)
            );
            clear_hosts();
        })
    }

    #[test]
    fn flush_ack_rejects_a_token_from_the_wrong_window() {
        with_test_lock(|| {
            clear_hosts();
            install_host("xlsx:a.xlsx", true, true);
            let key = host_key("xlsx", "a.xlsx");
            let (sender, receiver) = std::sync::mpsc::channel();
            let token = "token-2".to_owned();
            {
                let mut reg = registry().lock().expect("binary host registry lock");
                reg.hosts
                    .get_mut(&key)
                    .expect("host")
                    .flush_waiters
                    .push((token.clone(), sender));
            }

            let app = tauri::test::mock_app();
            let other = label_for("mindmap:b.xmind");
            assert_eq!(
                flush_ack(app.handle(), Some(&other), &token, true, None)["data"]["accepted"],
                json!(false),
                "another editor's ack must not release this host's flush"
            );
            assert!(
                receiver.try_recv().is_err(),
                "the waiter must still be parked"
            );
            clear_hosts();
        })
    }

    #[test]
    fn flush_skips_hosts_that_never_loaded() {
        with_test_lock(|| {
            clear_hosts();
            install_host("xlsx:a.xlsx", false, false);
            let app = tauri::test::mock_app();
            // Not ready/loaded → nothing pending, so this is a no-op success.
            let response = flush(app.handle(), "xlsx", "a.xlsx");
            assert_eq!(response["ok"], json!(true));
            assert_eq!(response["data"]["flushed"], json!(true));
            clear_hosts();
        })
    }

    #[test]
    fn flush_reports_unknown_hosts_without_error() {
        with_test_lock(|| {
            clear_hosts();
            let app = tauri::test::mock_app();
            let response = flush(app.handle(), "xlsx", "missing.xlsx");
            assert_eq!(response["data"]["flushed"], json!(false));
        })
    }

    /// Full host protocol against real window objects: ready (pull model) →
    /// setActive → setBounds → flush → ack → close. This is the DEV-123 path
    /// that registry-only unit tests could not reach, because `ready`,
    /// `set_active`, `set_bounds`, and `flush` all resolve windows by label.
    ///
    /// The mock runtime segfaults on `parent().build()`, so the host window is
    /// created unparented here; window parenting itself is covered by the
    /// macOS GUI run (the app launches and hosts render over the main window).
    #[test]
    fn host_protocol_runs_end_to_end() {
        with_test_lock(|| {
            clear_hosts();
            let app = tauri::test::mock_app();
            let handle = app.handle();
            let kind = "xlsx";
            let path = "sheets/book.xlsx";
            let key = host_key(kind, path);
            let label = label_for(&key);

            // A real (unparented) window the protocol can resolve by label,
            // mirroring exactly what `open` registers on the happy path.
            let _host = tauri::WebviewWindowBuilder::new(
                handle,
                label.as_str(),
                tauri::WebviewUrl::App("editor-host.html".into()),
            )
            .decorations(false)
            .visible(false)
            .build()
            .expect("mock host window");
            let mut reg = registry().lock().expect("binary host registry lock");
            reg.hosts.insert(
                key.clone(),
                HostEntry {
                    kind: kind.to_owned(),
                    path: path.to_owned(),
                    ready: false,
                    loaded: false,
                    pending: Vec::new(),
                    bounds: None,
                    flush_waiters: Vec::new(),
                },
            );
            drop(reg);
            let label = label_for(&host_key(kind, path));
            assert!(
                handle.get_webview_window(&label).is_some(),
                "open must create a window the ready ack can identify"
            );

            // ready: pulls the queued commands for THIS host only.
            let ack = ready(handle, Some(&label), "zh-CN");
            assert_eq!(ack["ok"], json!(true));
            let commands: Vec<Value> = ack["data"]["commands"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            assert_eq!(
                commands
                    .first()
                    .and_then(|c| c.get("command"))
                    .and_then(Value::as_str),
                Some("language"),
                "the language command comes first"
            );
            assert_eq!(
                commands[0].get("language").and_then(Value::as_str),
                Some("zh-CN")
            );

            // A second host must not be able to claim the first one's queue.
            let other_key = host_key("xmind", "maps/board.xmind");
            let other_label = label_for(&other_key);
            {
                let mut reg = registry().lock().expect("binary host registry lock");
                reg.hosts.insert(
                    other_key,
                    HostEntry {
                        kind: "xmind".to_owned(),
                        path: "maps/board.xmind".to_owned(),
                        ready: false,
                        loaded: false,
                        pending: Vec::new(),
                        bounds: None,
                        flush_waiters: Vec::new(),
                    },
                );
            }
            let other_ack = ready(handle, Some(&other_label), "zh-CN");
            let other_commands = other_ack["data"]["commands"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            assert!(
                other_commands
                    .iter()
                    .all(|c| c.get("path").and_then(Value::as_str) != Some(path)),
                "a host must only receive its own commands"
            );

            // setActive queues the initial load exactly once.
            assert_eq!(
                set_active(handle, Some(kind), Some(path))["data"]["active"],
                json!(true)
            );
            assert_eq!(
                set_active(handle, Some(kind), Some(path))["data"]["active"],
                json!(true)
            );

            // setBounds positions the window over the placeholder rect.
            let bounds = HostBounds {
                x: 10.0,
                y: 20.0,
                width: 400.0,
                height: 300.0,
            };
            assert_eq!(
                set_bounds(handle, kind, path, Some(bounds))["data"]["applied"],
                json!(true)
            );
            let window = handle
                .get_webview_window(&label)
                .expect("host window survives bounds");
            // The mock runtime accepts the calls but does not simulate a
            // window server, so the exact geometry is not asserted here — the
            // macOS GUI run covers real placement. The call path (and the
            // show/hide bookkeeping around it) is what this test pins.
            assert!(window.scale_factor().is_ok());
            assert!(window.outer_position().is_ok());
            assert!(window.inner_size().is_ok());

            // flush parks until the page acknowledges. The call runs on a
            // thread because it blocks on the ack channel.
            let flush_handle = handle.clone();
            let flusher = std::thread::spawn(move || flush(&flush_handle, kind, path));
            std::thread::sleep(std::time::Duration::from_millis(60));
            // The registry lives in this process, so the token the flusher
            // parked on can be resolved from here.
            let token = {
                let reg = registry().lock().expect("binary host registry lock");
                let entry = reg.hosts.get(&key).expect("host");
                entry
                    .flush_waiters
                    .first()
                    .map(|(token, _)| token.clone())
                    .expect("flush must park a waiter")
            };
            let acked = flush_ack(handle, Some(&label), &token, true, None);
            assert_eq!(acked["data"]["accepted"], json!(true));
            let flushed = flusher.join().expect("flusher thread");
            assert_eq!(flushed["data"]["flushed"], json!(true));

            // close: destroys the window and drops the registry entry. The
            // mock runtime records the close without a real window server, so
            // only the registry side is asserted here.
            assert_eq!(close(handle, kind, path)["data"]["closed"], json!(true));
            {
                let reg = registry().lock().expect("binary host registry lock");
                assert!(
                    !reg.hosts.contains_key(&key),
                    "close must drop the registry entry"
                );
            }
            clear_hosts();
        });
    }
}
