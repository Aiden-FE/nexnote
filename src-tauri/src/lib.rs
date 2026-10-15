mod agent_scenario;
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
mod menu_labels;
mod plugin_service;
mod print_service;
mod product;
mod reasoning_filter;
mod retrieval_service;
mod settings_search;
mod skill_service;
mod updater_service;
mod vault_fs;
mod vault_operations;
mod watcher_service;

use tauri::{Emitter, Manager};

use std::path::PathBuf;

pub fn run() {
    let app_data = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nexnote");
    let _ = std::fs::create_dir_all(&app_data);
    let host_version = env!("CARGO_PKG_VERSION").to_owned();
    // DEV-124: tauri-plugin-updater panics during plugin init when its config
    // carries no signing public key, which made the app unlaunchable before
    // the release pipeline exists. Register it only when a key is configured;
    // `updater:check` then reports UPDATE_PLUGIN_NOT_READY, which the settings
    // UI already surfaces.
    //
    // The gate reads the compile-time embedded config, not the file on disk:
    // an installed app's CWD is not src-tauri, so a file probe would silently
    // disable the updater everywhere except `cargo run`.
    let context = tauri::generate_context!();
    let updater_pubkey = context
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|plugin| plugin.get("pubkey"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .is_some();
    let updater_enabled = updater_pubkey;
    let base = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(product::ProductState::with_app_data(&app_data))
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
            let language = product::persisted_language(app.handle());
            build_native_menu(app.handle(), menu_labels::UiLanguage::parse(&language));
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
        });

    // `generate_context!` expands exactly once (it embeds a symbol), so the
    // context is built first and the branches differ only in the plugin.
    if updater_enabled {
        base.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        base
    }
    .build(context)
    .expect("failed to build NexNote Tauri runtime")
    .run(|_app_handle, _event| {});
}

/// Builds the native application menu and wires clicks to `menu:action`.
///
/// Mirrors the Electron `buildApplicationMenuTemplate` — file actions dispatch
/// to the renderer, Edit/View/Window use platform predefined items.
fn build_native_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    language: menu_labels::UiLanguage,
) {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let spec = menu_labels::menu_spec(language);
    let file = Submenu::new(app, spec.file_title, true).expect("file submenu");
    for (index, entry) in spec.file_items.iter().enumerate() {
        let item = MenuItem::with_id(
            app,
            entry.id,
            entry.label,
            true,
            (!entry.accelerator.is_empty()).then_some(entry.accelerator),
        )
        .expect("menu item");
        let _ = file.append(&item);
        if entry.separator_after && index + 1 < spec.file_items.len() {
            let _ = file.append(&PredefinedMenuItem::separator(app).expect("separator"));
        }
    }

    let edit = Submenu::new(app, spec.edit_title, true).expect("edit submenu");
    let _ = edit.append(&PredefinedMenuItem::undo(app, None).expect("undo"));
    let _ = edit.append(&PredefinedMenuItem::redo(app, None).expect("redo"));
    let _ = edit.append(&PredefinedMenuItem::separator(app).expect("separator"));
    let _ = edit.append(&PredefinedMenuItem::cut(app, None).expect("cut"));
    let _ = edit.append(&PredefinedMenuItem::copy(app, None).expect("copy"));
    let _ = edit.append(&PredefinedMenuItem::paste(app, None).expect("paste"));
    let _ = edit.append(&PredefinedMenuItem::select_all(app, None).expect("select all"));

    let menu = Menu::new(app).expect("application menu");
    let _ = menu.append_items(&[&file, &edit]);
    let _ = menu.set_as_app_menu();

    // Emit `menu:action` for every app-specific menu item click.
    let handle = app.clone();
    let actions = spec.actions.clone();
    app.on_menu_event(move |_app, event| {
        let Some((_, action)) = actions.iter().find(|(id, _)| *id == event.id().as_ref()) else {
            return;
        };
        let _ = handle.emit("menu:action", action.clone());
    });
}

/// Rebuilds the native menu for a new language. The OS menu cannot read the
/// renderer's catalog, so a language change has to rebuild it here (DEV-124).
pub fn rebuild_menu_for_language<R: tauri::Runtime>(app: &tauri::AppHandle<R>, language: &str) {
    build_native_menu(app, menu_labels::UiLanguage::parse(language));
}
