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

/// `binary:host:flush` — asks an editor to persist pending writes before the
/// tab closes. Returns `flushed:false` when the host is unknown, not yet ready
/// (the editor has no page to persist from), or has already been destroyed.
/// The blocking round-trip through `window.__nexnoteHostFlush` remains
/// DEV-123 work; until then the command is delivered and the tab keeps its
/// window alive so a subsequent close cannot drop unsaved state.
pub fn flush<R: Runtime>(app: &AppHandle<R>, kind: &str, path: &str) -> Value {
    let key = host_key(kind, path);
    let state = {
        let reg = registry().lock().expect("binary host registry lock");
        match reg.hosts.get(&key) {
            None => return ok(json!({ "flushed": false })),
            Some(entry) => (
                entry.ready,
                entry.loaded,
                entry.kind.clone(),
                entry.path.clone(),
            ),
        }
    };
    let (ready, loaded, kind, path) = state;
    if !ready || !loaded {
        // Nothing has been handed to the page yet: nothing can be pending.
        return ok(json!({ "flushed": true }));
    }
    let command = json!({ "command": "flush", "kind": kind, "path": path });
    deliver_command(app, &kind, &path, &command);
    ok(json!({ "flushed": true }))
}

/// `binary:host:ready` — the editor page ack; pull-model command delivery.
pub fn ready(app: &AppHandle<impl Runtime>, language: &str) -> Value {
    // The host page invokes this after it subscribed to events, so the pending
    // queue is returned as the invoke response (pull model). Pushing instead
    // would drop the initial load into a page that has no listener yet.
    let mut reg = registry().lock().expect("binary host registry lock");
    let Some((key, entry)) = reg.hosts.iter_mut().find(|(_, e)| !e.ready) else {
        return ok(json!({ "commands": [] }));
    };
    entry.ready = true;
    let _ = key;

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
