mod ai_service;
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
mod vault_fs;

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
        .run(tauri::generate_context!())
        .expect("failed to run NexNote Tauri runtime");
}
