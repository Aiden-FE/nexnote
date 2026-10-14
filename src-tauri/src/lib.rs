mod agent_service;
mod agent_tools;
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

use serde_json::json;
use tauri::{Emitter, Manager};

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

            build_native_menu(app.handle(), &main);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    // Editor hosts are parented to the main window on macOS
                    // and owned on Windows/Linux; explicit destroy keeps the
                    // registry from leaking across a close/reopen cycle.
                    tauri::WindowEvent::CloseRequested { .. } => {
                        binary_host_service::destroy_all(window.app_handle());
                    }
                    // Hosts use renderer-reported placeholder rects; when the
                    // window shrinks, clamp them to stay inside the new area.
                    tauri::WindowEvent::Resized(_) => {
                        binary_host_service::layout_visible(window.app_handle());
                    }
                    _ => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run NexNote Tauri runtime");
}

/// Builds the native application menu and wires clicks to `menu:action`.
///
/// Mirrors the Electron `buildApplicationMenuTemplate` — file actions dispatch
/// to the renderer, Edit/View/Window use platform predefined items.
fn build_native_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    _main: &tauri::WebviewWindow<R>,
) {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let file = Submenu::new(app, "File", true).expect("file submenu");
    let items: [(&str, &str, &str, Option<serde_json::Value>); 8] = [
        (
            "menu-new-block",
            "New document (block editing)",
            "CmdOrCtrl+N",
            Some(json!({ "type": "createNote", "format": "native-block" })),
        ),
        (
            "menu-new-md",
            "New Markdown (source mode)",
            "CmdOrCtrl+Shift+N",
            Some(json!({ "type": "createNote", "format": "markdown" })),
        ),
        (
            "menu-new-xlsx",
            "New blank XLSX",
            "",
            Some(json!({ "type": "createBlankBinary", "kind": "xlsx" })),
        ),
        (
            "menu-new-xmind",
            "New blank XMind",
            "",
            Some(json!({ "type": "createBlankBinary", "kind": "xmind" })),
        ),
        (
            "menu-import-docx",
            "Import Word document…",
            "",
            Some(json!({ "type": "importDocx" })),
        ),
        (
            "menu-import-xlsx",
            "Import XLSX…",
            "",
            Some(json!({ "type": "importXlsx" })),
        ),
        (
            "menu-import-xmind",
            "Import XMind…",
            "",
            Some(json!({ "type": "importXmind" })),
        ),
        (
            "menu-print",
            "Print current document…",
            "CmdOrCtrl+P",
            Some(json!({ "type": "printDocument" })),
        ),
    ];

    let _ = file.append_items(&[&tauri::menu::MenuItem::with_id(
        app,
        "menu-new-block",
        items[0].1,
        true,
        Some(items[0].2),
    )
    .expect("menu item")]);
    // Build remaining items and separators inline for readability.
    let md =
        MenuItem::with_id(app, items[1].0, items[1].1, true, Some(items[1].2)).expect("menu item");
    let xlsx =
        MenuItem::with_id(app, items[2].0, items[2].1, true, Some(items[2].2)).expect("menu item");
    let xmind =
        MenuItem::with_id(app, items[3].0, items[3].1, true, Some(items[3].2)).expect("menu item");
    let docx =
        MenuItem::with_id(app, items[4].0, items[4].1, true, Some(items[4].2)).expect("menu item");
    let imp_xlsx =
        MenuItem::with_id(app, items[5].0, items[5].1, true, Some(items[5].2)).expect("menu item");
    let imp_xmind =
        MenuItem::with_id(app, items[6].0, items[6].1, true, Some(items[6].2)).expect("menu item");
    let print_item =
        MenuItem::with_id(app, items[7].0, items[7].1, true, Some(items[7].2)).expect("menu item");

    let _ = file.append_items(&[&md]);
    let _ = file.append(&PredefinedMenuItem::separator(app).unwrap());
    let _ = file.append_items(&[&xlsx, &xmind]);
    let _ = file.append(&PredefinedMenuItem::separator(app).unwrap());
    let _ = file.append_items(&[&docx, &imp_xlsx, &imp_xmind]);
    let _ = file.append(&PredefinedMenuItem::separator(app).unwrap());
    let _ = file.append_items(&[&print_item]);

    let edit = Submenu::new(app, "Edit", true).expect("edit submenu");
    let _ = edit.append(&PredefinedMenuItem::undo(app, None).unwrap());
    let _ = edit.append(&PredefinedMenuItem::redo(app, None).unwrap());
    let _ = edit.append(&PredefinedMenuItem::separator(app).unwrap());
    let _ = edit.append(&PredefinedMenuItem::cut(app, None).unwrap());
    let _ = edit.append(&PredefinedMenuItem::copy(app, None).unwrap());
    let _ = edit.append(&PredefinedMenuItem::paste(app, None).unwrap());
    let _ = edit.append(&PredefinedMenuItem::select_all(app, None).unwrap());

    let menu = Menu::new(app).expect("application menu");
    let _ = menu.append_items(&[&file, &edit]);
    let _ = menu.set_as_app_menu();

    // Emit `menu:action` for every app-specific menu item click.
    let handle = app.clone();
    app.on_menu_event(move |_app, event| {
        let action = match event.id().as_ref() {
            "menu-new-block" => json!({ "type": "createNote", "format": "native-block" }),
            "menu-new-md" => json!({ "type": "createNote", "format": "markdown" }),
            "menu-new-xlsx" => json!({ "type": "createBlankBinary", "kind": "xlsx" }),
            "menu-new-xmind" => json!({ "type": "createBlankBinary", "kind": "xmind" }),
            "menu-import-docx" => json!({ "type": "importDocx" }),
            "menu-import-xlsx" => json!({ "type": "importXlsx" }),
            "menu-import-xmind" => json!({ "type": "importXmind" }),
            "menu-print" => json!({ "type": "printDocument" }),
            _ => return,
        };
        let _ = handle.emit("menu:action", action);
    });
}
