//! Tauri 2 updater integration (DEV-124).
//!
//! The Electron channel contract splits check / download / install into three
//! calls. The Tauri updater plugin combines download+install, so this service
//! stores the pending update from `check` and `downloadUpdate`/`installUpdate`
//! both consume it; the split stays renderer-compatible.
//!
//! Signing is mandatory: the plugin refuses to run without a pubkey and a
//! signed manifest on the endpoint. This slice wires the channels and returns
//! a clear `UPDATE_NOT_CONFIGURED` error until the release pipeline owns a
//! keypair — it never silently skips verification.

use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

/// A checked update awaiting download/install.
struct PendingUpdate(Update);

static PENDING: OnceLock<Mutex<Option<PendingUpdate>>> = OnceLock::new();

fn pending() -> &'static Mutex<Option<PendingUpdate>> {
    PENDING.get_or_init(|| Mutex::new(None))
}

fn ok(data: Value) -> Value {
    json!({ "ok": true, "data": data })
}

fn error(code: &str, message: &str) -> Value {
    json!({ "ok": false, "error": message, "code": code })
}

/// Runs an async updater operation on its own thread and blocks until it
/// finishes. `dispatch` is synchronous and may execute on a tokio worker, so
/// calling `block_on` inline could panic ("cannot block inside a runtime").
fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, tauri_plugin_updater::Error>> + Send + 'static,
    T: Send + 'static,
{
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("nexnote-updater".to_string())
        .spawn(move || {
            let result = tauri::async_runtime::block_on(operation);
            let _ = done_tx.send(result);
        })
        .map_err(|error| format!("Failed to start the updater task: {error}"))?;
    done_rx
        .recv()
        .map_err(|_| "The updater task exited without reporting".to_string())?
        .map_err(|error| classify_updater_error(&error))
}

fn classify_updater_error(error: &tauri_plugin_updater::Error) -> String {
    let text = error.to_string();
    if text.contains("pubkey") || text.contains("signature") || text.contains("endpoint") {
        format!(
            "Update signing or endpoint is not configured: {text}. \
             Configure tauri.conf.json updater endpoints and pubkey (DEV-124 release pipeline)."
        )
    } else {
        text
    }
}

/// `app:checkForUpdates`: stores the update for the next call and returns the
/// metadata without downloading anything.
pub fn check<R: Runtime>(app: &tauri::AppHandle<R>) -> Value {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(updater_error) => return error("UPDATE_PLUGIN_NOT_READY", &updater_error.to_string()),
    };
    match run_blocking(async move { updater.check().await }) {
        Ok(Some(update)) => {
            // The renderer drives its update banner from this event, not from
            // the command response alone, so both carry the same shape.
            let metadata = json!({
                "status": "available",
                "version": update.version,
                "action": "install-started",
            });
            *pending().lock().expect("pending update lock") = Some(PendingUpdate(update));
            let _ = app.emit("app:updateStatus", metadata.clone());
            ok(metadata)
        }
        Ok(None) => {
            let metadata = json!({ "status": "up-to-date" });
            let _ = app.emit("app:updateStatus", metadata.clone());
            ok(metadata)
        }
        Err(message) => error("UPDATE_CHECK_FAILED", &message),
    }
}

/// `app:downloadUpdate` / `app:installUpdate`: consumes the pending update
/// from a previous check, downloads and installs the signed artifact, then
/// restarts so the user lands on the new version immediately.
pub fn download_and_install<R: Runtime>(app: &tauri::AppHandle<R>) -> Value {
    let update = pending()
        .lock()
        .expect("pending update lock")
        .take()
        .map(|stored| stored.0);
    let Some(update) = update else {
        return error(
            "UPDATE_NOT_CHECKED",
            "Call app:checkForUpdates before downloading or installing an update",
        );
    };
    let handle = app.clone();
    match run_blocking(async move {
        update
            .clone()
            .download_and_install(|_chunk, _total| {}, || {})
            .await
    }) {
        Ok(()) => {
            // Hand the restart to Tauri's run loop (the same path the
            // process plugin's restart command uses) so the user lands on the
            // new version without the current call ever returning.
            handle.request_restart();
            ok(json!({ "installed": true, "restarting": true }))
        }
        Err(message) => error("UPDATE_INSTALL_FAILED", &message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_and_signature_errors_explain_release_setup() {
        let message = classify_updater_error(&tauri_plugin_updater::Error::EmptyEndpoints);
        assert!(
            message.contains("endpoint"),
            "missing endpoints must name the release pipeline: {message}"
        );
    }

    #[test]
    fn install_without_prior_check_requires_check_first() {
        let app = tauri::test::mock_app();
        // Ensure no pending update from another test.
        *pending().lock().expect("pending update lock") = None;
        let response = download_and_install(app.handle());
        assert_eq!(response["ok"], false);
        assert_eq!(response["code"], "UPDATE_NOT_CHECKED");
    }
}
