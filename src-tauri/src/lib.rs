mod agent_service;
mod ai_service;
mod binary_host_service;
mod binary_service;
mod confidence_service;
mod embedding_service;
mod git_service;
mod git_sync;
mod index_service;
mod plugin_service;
mod print_service;
mod product;
mod retrieval_service;
mod skill_service;
mod updater_service;
mod vault_fs;
mod watcher_service;

use tauri::Manager;

use std::path::PathBuf;

pub fn run() {
    let app_data = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nexnote");
    let _ = std::fs::create_dir_all(&app_data);
    let host_version = env!("CARGO_PKG_VERSION").to_owned();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(product::ProductState::default())
        .manage(std::sync::Arc::new(embedding_service::EmbeddingState::new(
            &app_data,
        )))
        .manage(product::PluginState::new(app_data, &host_version))
        .manage(product::VaultRoot::default())
        .invoke_handler(tauri::generate_handler![product::nexnote_invoke])
        .setup(|app| {
            let main = app
                .get_webview_window("main")
                .expect("NexNote main webview must be declared");
            let _ = main.set_title("NexNote");
            Ok(())
        })
        .on_window_event(|window, event| {
            // Editor hosts are parented to the main window on macOS and owned
            // on Windows/Linux, but destroying them explicitly keeps the
            // registry from leaking across a close/reopen cycle.
            if matches!(event, tauri::WindowEvent::CloseRequested { .. })
                && window.label() == "main"
            {
                binary_host_service::destroy_all(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run NexNote Tauri runtime");
}
