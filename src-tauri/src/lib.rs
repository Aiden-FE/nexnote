mod index_service;
mod product;
mod vault_fs;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(product::ProductState::default())
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
