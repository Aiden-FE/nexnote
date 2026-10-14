use crate::{
    ai_service::{self, AiStore},
    binary_service,
    git_service::{self, GitError},
    git_sync, index_service, plugin_service, print_service, vault_fs,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VaultInfo {
    root: String,
    name: String,
    config_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecentVaultEntry {
    path: String,
    name: String,
    last_opened_at: u64,
}

#[derive(Debug)]
pub struct ProductState {
    global_settings: Mutex<Value>,
    current_vault: Mutex<Option<VaultInfo>>,
    recent_vaults: Mutex<Vec<RecentVaultEntry>>,
}

pub struct PluginState {
    store: Mutex<plugin_service::PluginStore>,
}

impl PluginState {
    pub fn new(app_data: PathBuf, host_version: &str) -> Self {
        Self {
            store: Mutex::new(plugin_service::PluginStore::new(
                Some(app_data.join("nexnote-plugins.json")),
                Some(app_data.join("plugins")),
                host_version,
            )),
        }
    }
}

#[derive(Default)]
pub struct VaultRoot {
    root: Mutex<Option<PathBuf>>,
}

impl VaultRoot {
    fn get(&self) -> Option<PathBuf> {
        self.root.lock().expect("vault root lock").clone()
    }
}

impl Default for ProductState {
    fn default() -> Self {
        Self {
            global_settings: Mutex::new(default_global_settings()),
            current_vault: Mutex::new(None),
            recent_vaults: Mutex::new(Vec::new()),
        }
    }
}

impl ProductState {
    fn set_current_vault(&self, vault: VaultInfo) {
        *self.current_vault.lock().expect("vault state lock") = Some(vault.clone());
        let mut recent = self.recent_vaults.lock().expect("recent vault lock");
        recent.retain(|entry| entry.path != vault.root);
        recent.insert(
            0,
            RecentVaultEntry {
                path: vault.root.clone(),
                name: vault.name,
                last_opened_at: unix_timestamp_seconds(),
            },
        );
        recent.truncate(10);
    }
}

fn unix_timestamp_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

fn ok(data: Value) -> Value {
    json!({ "ok": true, "data": data })
}

fn error(code: &str, message: &str) -> Value {
    json!({ "ok": false, "error": message, "code": code })
}

fn string_field(payload: &Value, field: &str) -> Option<String> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn default_global_settings() -> Value {
    json!({
        "version": 1,
        "appearance": {
            "theme": "system",
            "language": "zh-CN",
            "uiFontFamily": "system-ui, -apple-system, \"Segoe UI\", sans-serif",
            "editorFontFamily": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            "uiFontSize": 14,
            "editorFontSize": 16
        },
        "updates": { "checkOnLaunch": true, "autoDownload": false, "channel": "stable" },
        "startup": { "behavior": "restore", "specificVaultPath": null },
        "git": { "useSystemGit": false },
        "network": {
            "mode": "system",
            "host": null,
            "port": null,
            "username": null,
            "password": null,
            "bypass": [],
            "applyToAi": true,
            "applyToGit": true,
            "aiProxy": null,
            "gitProxy": null
        },
        "shortcuts": [
            { "commandId": "app.palette", "key": "Mod+K", "disabled": false },
            { "commandId": "search.open", "key": "Mod+Shift+F", "disabled": false },
            { "commandId": "app.save", "key": "Mod+S", "disabled": false },
            { "commandId": "app.settings", "key": "Mod+,", "disabled": false },
            { "commandId": "document.print", "key": "Mod+P", "disabled": false }
        ]
    })
}

fn default_vault_settings() -> Value {
    json!({
        "editor": {
            "autoSaveMs": 1500,
            "defaultPageTemplate": "# {{title}}\n\n",
            "bindFileNameToTitle": true,
            "vimMode": false,
            "codeTheme": "github"
        },
        "git": {
            "autoCommit": true,
            "autoCommitIntervalMs": 30000,
            "commitMessageTemplate": "保存 {summary}",
            "defaultBranch": "main",
            "autoSyncIntervalSec": 300,
            "syncStrategy": "rebase"
        },
        "binary": { "maxConcurrentTabs": 3 }
    })
}

fn default_vault_config() -> Value {
    json!({
        "version": 1,
        "features": { "confidenceFrontmatter": false },
        "settings": default_vault_settings(),
        "layout": {
            "sidebarWidth": 260,
            "sidebarCollapsed": false,
            "activeSidebarPanelId": null,
            "dockVisible": false,
            "dockWidth": 320,
            "treeCollapsedDirs": [],
            "treeShowAllFiles": false,
            "treeShowExtensions": false,
            "guideCompleted": false,
            "tabOrder": []
        },
        "lastSession": { "tabs": [] }
    })
}

fn merge_object(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(target), Value::Object(source)) => {
            for (key, value) in source {
                match (target.get_mut(key), value) {
                    (Some(Value::Object(_)), Value::Object(_)) => {
                        if let Some(child) = target.get_mut(key) {
                            merge_object(child, value);
                        }
                    }
                    _ => {
                        target.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (target, source) => *target = source.clone(),
    }
}

fn vault_info_for_path(root: &Path) -> VaultInfo {
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Vault")
        .to_owned();
    VaultInfo {
        root: root.display().to_string(),
        name,
        config_path: root.join(".nexnote/config.json").display().to_string(),
    }
}

fn write_config(config_path: &Path, config: &Value) -> Result<(), std::io::Error> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let serialized = serde_json::to_vec_pretty(config)?;
    fs::write(config_path, serialized)
}

fn update_config_layout(vault: &VaultInfo, layout: &Value) -> Result<(), String> {
    let path = PathBuf::from(&vault.config_path);
    let mut config: Value = serde_json::from_str(
        &fs::read_to_string(&path).map_err(|e| format!("read vault config failed: {e}"))?,
    )
    .map_err(|e| format!("parse vault config failed: {e}"))?;
    if let Some(target) = config.get_mut("layout") {
        merge_object(target, layout);
    }
    write_config(&path, &config).map_err(|e| format!("write vault config failed: {e}"))
}

fn app_info(app: &AppHandle) -> Value {
    json!({
        "version": app.package_info().version.to_string(),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "isPackaged": !cfg!(debug_assertions),
        "runtimeName": "tauri",
        "runtimeVersion": tauri::VERSION,
    })
}

fn ping(namespace: &'static str, implemented_by: &'static str) -> Value {
    ok(json!({
        "pong": true,
        "namespace": namespace,
        "implementedBy": implemented_by
    }))
}

fn git_result(result: Result<Value, GitError>) -> Value {
    match result {
        Ok(value) => ok(value),
        Err(failure) => error(&failure.code, &failure.message),
    }
}

static AI_STORE: OnceLock<Mutex<AiStore>> = OnceLock::new();

fn ai_store(app: &AppHandle) -> std::sync::MutexGuard<'static, AiStore> {
    let store = AI_STORE.get_or_init(|| {
        let data_dir = app.path().app_data_dir().unwrap_or_default();
        Mutex::new(AiStore::new(data_dir.join("nexnote-ai.json")))
    });
    store
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn ai_state_value(state: ai_service::AiConfigState) -> Value {
    serde_json::to_value(state).unwrap_or(Value::Null)
}

fn ai_error(message: impl AsRef<str>) -> Value {
    error("AI_REQUEST_FAILED", message.as_ref())
}

fn ai_profile_input(payload: &Value) -> Result<ai_service::AiProfileInput, Value> {
    let profile = payload.get("profile").cloned().unwrap_or(Value::Null);
    let mut input: ai_service::AiProfileInput =
        serde_json::from_value(profile).map_err(|e| error("INVALID_AI_PROFILE", &e.to_string()))?;
    input.id = string_field(payload, "id").or(input.id);
    Ok(input)
}

fn ai_assignment(payload: &Value) -> Result<Option<ai_service::AiFeatureAssignment>, Value> {
    match payload.get("assignment") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|e| error("INVALID_AI_ASSIGNMENT", &e.to_string())),
    }
}

fn connection_target(store: &AiStore, payload: &Value) -> Result<(String, Option<String>), Value> {
    if let Some(id) = string_field(payload, "profileId") {
        let profile = store
            .get_state()
            .profiles
            .into_iter()
            .find(|profile| profile.id == id)
            .ok_or_else(|| {
                error(
                    "AI_PROFILE_NOT_FOUND",
                    &format!("AI profile not found: {id}"),
                )
            })?;
        // DEV-121 fail-closed credential boundary: saved profiles expose only
        // `has_api_key`; the OS credential vault is required to recover bytes.
        return Ok((profile.base_url, None));
    }
    let candidate = payload.get("candidate").cloned().unwrap_or(Value::Null);
    let base_url = candidate
        .get("baseUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            error(
                "INVALID_AI_CONNECTION",
                "profileId or candidate is required",
            )
        })?
        .to_owned();
    Ok((
        base_url,
        candidate
            .get("credentialToken")
            .and_then(Value::as_str)
            .map(str::to_owned),
    ))
}

fn embedding_source(store: &AiStore) -> Result<(ai_service::AiProfileView, String), Value> {
    let state = store.get_state();
    let assignment = state.features.embedding.clone().or_else(|| {
        state.default_profile_id.clone().map(|profile_id| {
            let profile = state
                .profiles
                .iter()
                .find(|profile| profile.id == profile_id);
            ai_service::AiFeatureAssignment {
                profile_id,
                model: profile
                    .map(|profile| profile.default_model.clone())
                    .unwrap_or_default(),
                dimensions: None,
                metric: None,
            }
        })
    });
    let assignment = assignment.ok_or_else(|| {
        error(
            "AI_EMBEDDING_NOT_CONFIGURED",
            "No embedding profile is configured",
        )
    })?;
    let profile = state
        .profiles
        .into_iter()
        .find(|profile| profile.id == assignment.profile_id)
        .ok_or_else(|| {
            error(
                "AI_PROFILE_NOT_FOUND",
                &format!("AI profile not found: {}", assignment.profile_id),
            )
        })?;
    Ok((profile, assignment.model))
}

fn ai_embed_with_metadata(
    store: &AiStore,
    texts: &[String],
) -> Result<ai_service::EmbedResult, Value> {
    let (profile, model) = embedding_source(store)?;
    if profile.kind == ai_service::AiProviderKind::LocalEmbedding {
        return Err(error(
            "LOCAL_EMBEDDING_NOT_READY",
            "The built-in embedding runtime is not available yet",
        ));
    }
    // Saved-profile keys remain fail-closed until the OS credential vault lands.
    let vectors = ai_service::embed(&profile.base_url, None, &model, texts).map_err(ai_error)?;
    let dimensions = vectors.first().map_or(0, Vec::len) as u32;
    Ok(ai_service::EmbedResult {
        vectors,
        dimensions,
        model,
        profile_id: profile.id,
    })
}

#[tauri::command]
pub async fn nexnote_invoke(
    app: AppHandle,
    state: State<'_, ProductState>,
    plugin_state: State<'_, PluginState>,
    vault_root: State<'_, VaultRoot>,
    channel: String,
    payload: Option<Value>,
) -> Result<Value, ()> {
    let payload = payload.unwrap_or(Value::Null);
    Ok(dispatch(
        &app,
        &state,
        &plugin_state,
        &vault_root,
        &channel,
        &payload,
    ))
}

fn dispatch(
    app: &AppHandle,
    state: &State<'_, ProductState>,
    plugin_state: &State<'_, PluginState>,
    vault_root: &State<'_, VaultRoot>,
    channel: &str,
    payload: &Value,
) -> Value {
    match channel {
        "app:getInfo" => ok(app_info(app)),
        "app:checkForUpdates" | "app:downloadUpdate" | "app:installUpdate" => error(
            "APP_UPDATE_NOT_PORTED",
            "Updater flows are not ported to Tauri yet",
        ),
        "app:getUpdateSettings" => {
            let settings = state.global_settings.lock().expect("settings lock");
            ok(settings
                .get("updates")
                .cloned()
                .unwrap_or_else(default_updates))
        }
        "app:setUpdateChannel" => {
            let requested = match string_field(payload, "channel") {
                Some(value) if ["stable", "beta", "alpha"].contains(&value.as_str()) => value,
                _ => return error("INVALID_UPDATE_CHANNEL", "Unsupported update channel"),
            };
            let mut settings = state.global_settings.lock().expect("settings lock");
            if let Some(updates) = settings.get_mut("updates") {
                merge_object(updates, &json!({ "channel": requested }));
            }
            ok(json!({ "status": "channel-switched", "channel": requested }))
        }
        "app:setUpdateSettings" => {
            let mut settings = state.global_settings.lock().expect("settings lock");
            merge_object(&mut settings, payload);
            ok(settings
                .get("updates")
                .cloned()
                .unwrap_or_else(default_updates))
        }
        "settings:getAll" => ok(state.global_settings.lock().expect("settings lock").clone()),
        "settings:setGlobal" => {
            let mut settings = state.global_settings.lock().expect("settings lock");
            merge_object(&mut settings, payload);
            ok(settings.clone())
        }
        "settings:getVault" => {
            let vault = state
                .current_vault
                .lock()
                .expect("vault state lock")
                .clone();
            match vault {
                Some(_) => ok(default_vault_settings()),
                None => ok(Value::Null),
            }
        }
        "settings:setVault" => {
            let vault = state
                .current_vault
                .lock()
                .expect("vault state lock")
                .clone();
            let Some(vault) = vault else {
                return error("NO_VAULT", "No vault is open");
            };
            let Some(patch) = payload.get("patch") else {
                return error("INVALID_VAULT_SETTINGS", "patch is required");
            };
            let mut config: Value = fs::read_to_string(&vault.config_path)
                .ok()
                .and_then(|raw| serde_json::from_str(&raw).ok())
                .unwrap_or_else(default_vault_config);
            let Some(settings) = config.as_object_mut() else {
                return error("VAULT_CONFIG_INVALID", "Vault config is invalid");
            };
            match settings.get_mut("settings") {
                Some(current) => merge_object(current, patch),
                None => {
                    settings.insert("settings".to_string(), default_vault_settings());
                    merge_object(
                        settings
                            .get_mut("settings")
                            .expect("settings just inserted"),
                        patch,
                    );
                }
            }
            let settings_value = settings.get("settings").cloned().unwrap_or(Value::Null);
            match write_config(Path::new(&vault.config_path), &config) {
                Ok(()) => ok(settings_value),
                Err(message) => error("VAULT_CONFIG_WRITE_FAILED", &message.to_string()),
            }
        }
        "settings:setShortcuts" => {
            let Some(shortcuts) = payload.get("shortcuts") else {
                return error("INVALID_SHORTCUTS", "shortcuts is required");
            };
            let mut settings = state.global_settings.lock().expect("settings lock");
            if let Some(current) = settings.as_object_mut() {
                current.insert("shortcuts".to_string(), shortcuts.clone());
            }
            ok(json!(shortcuts))
        }
        "settings:exportShortcuts" => {
            let settings = state.global_settings.lock().expect("settings lock");
            let shortcuts = settings.get("shortcuts").cloned().unwrap_or(Value::Null);
            let count = shortcuts.as_array().map(Vec::len).unwrap_or_default();
            match serde_json::to_string_pretty(&shortcuts) {
                Ok(json_string) => ok(json!({ "json": json_string, "count": count })),
                Err(e) => error("SERIALIZATION_FAILED", &e.to_string()),
            }
        }
        "settings:importShortcuts" => {
            let Some(json_string) = string_field(payload, "json") else {
                return error("INVALID_SHORTCUT_IMPORT", "json is required");
            };
            let shortcuts: Value = match serde_json::from_str(&json_string) {
                Ok(value) => value,
                Err(_) => {
                    return error("INVALID_SHORTCUT_IMPORT", "Invalid shortcut JSON");
                }
            };
            let imported = shortcuts.as_array().map(Vec::len).unwrap_or_default();
            let mut settings = state.global_settings.lock().expect("settings lock");
            if let Some(current) = settings.as_object_mut() {
                current.insert("shortcuts".to_string(), shortcuts.clone());
            }
            ok(json!({ "imported": imported, "shortcuts": shortcuts }))
        }
        "settings:search" => ok(json!([])),
        "settings:pickImportFile" | "settings:saveExportFile" => error(
            "SETTINGS_DIALOG_NOT_PORTED",
            "Native settings dialogs are not ported to Tauri yet",
        ),
        "vault:getState" => {
            let vault = state
                .current_vault
                .lock()
                .expect("vault state lock")
                .clone();
            match vault {
                Some(vault) => ok(json!({ "mode": "ready", "vault": vault, "showWelcome": true })),
                None => {
                    let recent = state
                        .recent_vaults
                        .lock()
                        .expect("recent vault lock")
                        .clone();
                    ok(json!({ "mode": "onboarding", "recent": recent }))
                }
            }
        }
        "vault:listRecent" => ok(json!(state
            .recent_vaults
            .lock()
            .expect("recent vault lock")
            .clone())),
        "vault:pickDirectory" => {
            let picked = app.dialog().file().blocking_pick_folder();
            match picked {
                Some(path) => ok(json!(path.to_string())),
                None => ok(Value::Null),
            }
        }
        "vault:create" => {
            let parent = match string_field(payload, "parentDir") {
                Some(value) => PathBuf::from(value),
                None => return error("INVALID_VAULT_PARENT", "parentDir is required"),
            };
            let name = match string_field(payload, "name") {
                Some(value) if !value.trim().is_empty() => value,
                _ => return error("NAME_EMPTY", "Vault name is required"),
            };
            if payload
                .get("initGit")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                return error(
                    "GIT_BACKEND_NOT_PORTED",
                    "Rust Git initialization is not implemented yet",
                );
            }
            let root = parent.join(&name);
            let config_path = root.join(".nexnote/config.json");
            if let Err(e) = write_config(&config_path, &default_vault_config()) {
                return error("VAULT_CREATE_FAILED", &e.to_string());
            }
            let info = vault_info_for_path(&root);
            if let Err(e) = sync_vault_root(&root, vault_root) {
                return e;
            }
            state.set_current_vault(info.clone());
            let _ = app.emit("vault:changed", &info);
            ok(serde_json::to_value(info).unwrap_or(Value::Null))
        }
        "vault:open" => {
            let root = match string_field(payload, "path") {
                Some(value) => PathBuf::from(value),
                None => return error("INVALID_VAULT_PATH", "path is required"),
            };
            if !root.join(".nexnote/config.json").is_file() {
                return error(
                    "NOT_A_VAULT",
                    "The selected directory has no NexNote config",
                );
            }
            if !root.join(".git").is_dir() {
                return error(
                    "GIT_INITIALIZATION_REQUIRED",
                    "Initialize Git before opening this vault",
                );
            }
            let info = vault_info_for_path(&root);
            if let Err(e) = sync_vault_root(&root, vault_root) {
                return e;
            }
            state.set_current_vault(info.clone());
            let _ = app.emit("vault:changed", &info);
            ok(serde_json::to_value(info).unwrap_or(Value::Null))
        }
        "vault:inspect" => {
            let path = match string_field(payload, "path") {
                Some(value) => PathBuf::from(value),
                None => return error("INVALID_VAULT_PATH", "path is required"),
            };
            let entry_count = fs::read_dir(&path)
                .map(|entries| entries.filter_map(Result::ok).count())
                .unwrap_or_default();
            ok(json!({
                "path": path.display().to_string(),
                "exists": path.exists(),
                "isDirectory": path.is_dir(),
                "hasNexnote": path.join(".nexnote").is_dir(),
                "isGitRepo": path.join(".git").is_dir(),
                "isObsidian": path.join(".obsidian").is_dir(),
                "entryCount": entry_count
            }))
        }
        "vault:getLayout" => {
            let vault = state
                .current_vault
                .lock()
                .expect("vault state lock")
                .clone();
            match vault {
                Some(vault) => {
                    let config: Value = fs::read_to_string(&vault.config_path)
                        .ok()
                        .and_then(|raw| serde_json::from_str(&raw).ok())
                        .unwrap_or_else(default_vault_config);
                    ok(config.get("layout").cloned().unwrap_or(Value::Null))
                }
                None => ok(Value::Null),
            }
        }
        "vault:removeRecent" => {
            let Some(path) = string_field(payload, "path") else {
                return error("INVALID_VAULT_PATH", "path is required");
            };
            let mut recent = state.recent_vaults.lock().expect("recent vault lock");
            recent.retain(|entry| entry.path != path);
            ok(Value::Null)
        }
        "vault:initGit" => {
            let Some(path) = string_field(payload, "path") else {
                return error("INVALID_VAULT_PATH", "path is required");
            };
            let root = PathBuf::from(path);
            if !root.join(".nexnote/config.json").is_file() {
                return error(
                    "NOT_A_VAULT",
                    "The selected directory has no NexNote config",
                );
            }
            match git_service::init(&root) {
                Ok(_) => {}
                Err(failure) => return error(&failure.code, &failure.message),
            }
            let info = vault_info_for_path(&root);
            if let Err(e) = sync_vault_root(&root, vault_root) {
                return e;
            }
            state.set_current_vault(info.clone());
            let _ = app.emit("vault:changed", &info);
            ok(serde_json::to_value(info).unwrap_or(Value::Null))
        }
        "vault:clone" | "vault:clonePreflight" | "vault:cancelOperation" => error(
            "VAULT_CLONE_NOT_PORTED",
            "Remote vault operations are not ported to Rust yet",
        ),
        "vault:reveal" => error(
            "VAULT_REVEAL_NOT_PORTED",
            "Reveal in Finder is not ported to Tauri yet",
        ),
        "vault:saveLayout" => {
            let vault = state
                .current_vault
                .lock()
                .expect("vault state lock")
                .clone();
            let Some(vault) = vault else {
                return error("NO_VAULT", "No vault is open");
            };
            let Some(layout) = payload.get("layout") else {
                return error("INVALID_LAYOUT", "layout is required");
            };
            match update_config_layout(&vault, layout) {
                Ok(()) => ok(Value::Null),
                Err(message) => error("VAULT_CONFIG_WRITE_FAILED", &message),
            }
        }
        "vault:close" => {
            *state.current_vault.lock().expect("vault state lock") = None;
            close_vault_root(vault_root);
            let _ = app.emit("vault:changed", Value::Null);
            ok(Value::Null)
        }
        "fs:listDir"
        | "fs:listTree"
        | "fs:readTextFile"
        | "fs:writeTextFile"
        | "fs:createTextFile"
        | "fs:createNote"
        | "fs:exists"
        | "fs:stat"
        | "fs:mkdir"
        | "fs:rename"
        | "fs:delete"
        | "fs:scanTags"
        | "fs:importBinaryFile"
        | "fs:revealInFinder" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            match channel {
                "fs:listDir" => vault_fs::list_dir(&root, payload),
                "fs:listTree" => vault_fs::list_tree(&root, payload),
                "fs:readTextFile" => vault_fs::read_text_file(&root, payload),
                "fs:writeTextFile" => vault_fs::write_text_file(&root, payload),
                "fs:createTextFile" => vault_fs::create_text_file(&root, payload),
                "fs:createNote" => vault_fs::create_note(&root, payload),
                "fs:exists" => vault_fs::exists(&root, payload),
                "fs:stat" => vault_fs::stat(&root, payload),
                "fs:mkdir" => vault_fs::mkdir(&root, payload),
                "fs:rename" => vault_fs::rename(&root, payload),
                "fs:delete" => vault_fs::delete(&root, payload),
                "fs:scanTags" => vault_fs::scan_tags(&root),
                "fs:importBinaryFile" => error(
                    "FS_BINARY_IMPORT_NOT_PORTED",
                    "Binary import is not ported to Rust yet",
                ),
                _ => error(
                    "FS_REVEAL_NOT_PORTED",
                    "Reveal in Finder is not ported to Rust yet",
                ),
            }
        }
        "fs:renameLinked" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            match (string_field(payload, "from"), string_field(payload, "to")) {
                (Some(from), Some(to)) => index_service::rename_linked(&root, &from, &to),
                _ => error("INVALID_RENAME", "from and to are required"),
            }
        }
        "index:status"
        | "index:rebuild"
        | "index:search"
        | "index:backlinks"
        | "index:graph"
        | "index:tagPages"
        | "index:tags"
        | "index:pageSummary"
        | "index:pageSummaries"
        | "index:jumpTo"
        | "index:confidence"
        | "index:confidenceSettings"
        | "index:setConfidenceFrontmatter" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            match channel {
                "index:status" => index_service::status(&root),
                "index:rebuild" => index_service::rebuild(&root),
                "index:search" => index_service::search(&root, payload),
                "index:backlinks" => index_service::backlinks(&root, payload),
                "index:graph" => index_service::graph(&root),
                "index:tagPages" => index_service::tag_pages(&root, payload),
                "index:tags" => index_service::tags(&root, payload),
                "index:pageSummary" => index_service::page_summary(&root, payload),
                "index:pageSummaries" => index_service::page_summaries(&root),
                "index:jumpTo" => index_service::jump_to(&root, payload),
                _ => error(
                    "INDEX_CONFIDENCE_NOT_PORTED",
                    "Confidence APIs are not ported to Rust yet",
                ),
            }
        }
        "git:ping" => ping("git", "DEV-120"),
        "git:getStatus"
        | "git:getTimeline"
        | "git:commit"
        | "git:recordAutoCommit"
        | "git:initGit"
        | "git:addRemote"
        | "git:listRemotes"
        | "git:pull"
        | "git:push"
        | "git:sync"
        | "git:previewRestore"
        | "git:restoreFile"
        | "git:setUseSystemGit"
        | "git:configureAutoSync"
        | "git:getAutoCommitDebounce"
        | "git:setAutoCommitDebounce"
        | "git:doctor:diagnose"
        | "git:doctor:repairPrepare"
        | "git:doctor:repairExecute"
        | "git:doctor:dismiss" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            match channel {
                "git:getStatus" => git_result(git_service::status(&root)),
                "git:getTimeline" => git_result(git_service::get_timeline(
                    &root,
                    string_field(payload, "path"),
                    payload.get("limit").and_then(Value::as_u64).unwrap_or(100) as usize,
                )),
                "git:commit" => match string_field(payload, "message") {
                    Some(message) => git_result(git_service::commit(&root, &message)),
                    None => error("INVALID_COMMIT_MESSAGE", "message is required"),
                },
                "git:recordAutoCommit" => git_result(git_service::record_auto_commit(
                    &root,
                    string_field(payload, "summary")
                        .unwrap_or_default()
                        .as_str(),
                    payload
                        .get("debounceMs")
                        .and_then(Value::as_u64)
                        .unwrap_or_default(),
                )),
                "git:initGit" => git_result(git_service::init(&root)),
                "git:addRemote" => {
                    match (string_field(payload, "name"), string_field(payload, "url")) {
                        (Some(name), Some(url)) => git_sync::add_remote(&root, &name, &url),
                        _ => error("INVALID_REMOTE", "name and url are required"),
                    }
                }
                "git:listRemotes" => {
                    let remotes = git_sync::list_remotes(&root);
                    match serde_json::to_value(remotes) {
                        Ok(value) => ok(value),
                        Err(e) => error("SERIALIZATION_FAILED", &e.to_string()),
                    }
                }
                "git:pull" => git_sync::pull(
                    &root,
                    payload
                        .get("force")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                ),
                "git:push" => git_sync::push(&root),
                "git:sync" => git_sync::sync(&root),
                "git:previewRestore" => {
                    match (
                        string_field(payload, "path"),
                        string_field(payload, "commit"),
                    ) {
                        (Some(path), Some(commit)) => {
                            git_result(git_service::preview_restore(&root, &path, &commit))
                        }
                        _ => error("INVALID_RESTORE", "path and commit are required"),
                    }
                }
                "git:restoreFile" => {
                    match (
                        string_field(payload, "path"),
                        string_field(payload, "commit"),
                    ) {
                        (Some(path), Some(commit)) => {
                            git_result(git_service::restore_file(&root, &path, &commit))
                        }
                        _ => error("INVALID_RESTORE", "path and commit are required"),
                    }
                }
                "git:setUseSystemGit" => match payload.get("enabled").and_then(Value::as_bool) {
                    Some(enabled) => git_result(git_service::set_use_system_git(&root, enabled)),
                    None => error("INVALID_USE_SYSTEM_GIT", "enabled is required"),
                },
                "git:configureAutoSync" => {
                    let enabled = payload.get("enabled").and_then(Value::as_bool);
                    let interval = payload
                        .get("intervalSec")
                        .or_else(|| payload.get("interval"))
                        .and_then(Value::as_u64);
                    match (
                        enabled,
                        interval,
                        string_field(payload, "strategy").as_deref(),
                    ) {
                        (Some(enabled), Some(interval), Some(strategy)) => {
                            git_sync::configure_auto_sync(&root, enabled, interval, strategy)
                        }
                        _ => error(
                            "INVALID_AUTO_SYNC",
                            "enabled, intervalSec and strategy are required",
                        ),
                    }
                }
                "git:getAutoCommitDebounce" => git_sync::get_auto_commit_debounce(&root),
                "git:setAutoCommitDebounce" => {
                    match payload.get("milliseconds").and_then(Value::as_u64) {
                        Some(milliseconds) => {
                            git_sync::set_auto_commit_debounce(&root, milliseconds)
                        }
                        None => error("INVALID_DEBOUNCE", "milliseconds is required"),
                    }
                }
                "git:doctor:repairPrepare" => match string_field(payload, "action") {
                    Some(action) => git_sync::repair_prepare(&root, &action),
                    None => error("INVALID_REPAIR_ACTION", "action is required"),
                },
                "git:doctor:repairExecute" => match string_field(payload, "ticket") {
                    Some(ticket) => git_sync::repair_execute(&root, &ticket),
                    None => error("INVALID_REPAIR_TICKET", "ticket is required"),
                },
                "git:doctor:dismiss" => git_sync::dismiss(&root),
                _ => git_sync::diagnose(&root),
            }
        }
        channel if channel.starts_with("git:") => error(
            "UNSUPPORTED_CHANNEL",
            "This Git command is not ported to Rust yet",
        ),
        "editor:ping" => ping("editor", "DEV-002"),
        "ai:ping" => ping("ai", "DEV-009"),
        "ai:credential:submit" => {
            let secret = string_field(payload, "secret").filter(|value| !value.is_empty());
            let base_url = string_field(payload, "baseUrl").filter(|value| !value.is_empty());
            match (secret, base_url) {
                (Some(_), Some(_)) => ok(json!({ "credentialToken": "submitted" })),
                _ => error("INVALID_AI_CREDENTIAL", "secret and baseUrl are required"),
            }
        }
        "ai:getState" => {
            let store = ai_store(app);
            ok(ai_state_value(store.get_state()))
        }
        "ai:profile:save" => {
            let store = ai_store(app);
            match ai_profile_input(payload).and_then(|input| {
                store
                    .save_profile(&input)
                    .map_err(|message| error("AI_PROFILE_SAVE_FAILED", &message))
            }) {
                Ok(id) => ok(json!({ "id": id, "state": ai_state_value(store.get_state()) })),
                Err(failure) => failure,
            }
        }
        "ai:profile:delete" => {
            let store = ai_store(app);
            match string_field(payload, "id") {
                Some(id) => match store.delete_profile(&id) {
                    Ok(state) => ok(json!({ "state": ai_state_value(state) })),
                    Err(message) => error("AI_PROFILE_DELETE_FAILED", &message),
                },
                None => error("INVALID_AI_PROFILE_ID", "id is required"),
            }
        }
        "ai:profile:setDefault" => {
            let store = ai_store(app);
            match string_field(payload, "id") {
                Some(id) => match store.set_default_profile(&id) {
                    Ok(state) => ok(json!({ "state": ai_state_value(state) })),
                    Err(message) => error("AI_DEFAULT_PROFILE_FAILED", &message),
                },
                None => error("INVALID_AI_PROFILE_ID", "id is required"),
            }
        }
        "ai:features:set" => {
            let store = ai_store(app);
            match (string_field(payload, "feature"), ai_assignment(payload)) {
                (Some(feature), Ok(assignment)) => match store.set_feature(&feature, assignment) {
                    Ok(state) => ok(json!({ "state": ai_state_value(state) })),
                    Err(message) => error("AI_FEATURE_SET_FAILED", &message),
                },
                (_, Err(failure)) => failure,
                (None, _) => error("INVALID_AI_FEATURE", "feature is required"),
            }
        }
        "ai:translation:setTargetLanguage" => {
            let store = ai_store(app);
            match string_field(payload, "targetLanguage") {
                Some(target_language) => {
                    match store.set_translation_target_language(&target_language) {
                        Ok(state) => ok(json!({ "state": ai_state_value(state) })),
                        Err(message) => error("AI_TRANSLATION_LANGUAGE_FAILED", &message),
                    }
                }
                None => error("INVALID_TRANSLATION_LANGUAGE", "targetLanguage is required"),
            }
        }
        "ai:setupPrompt:dismiss" => {
            let store = ai_store(app);
            match store.dismiss_setup_prompt() {
                Ok(state) => ok(json!({ "state": ai_state_value(state) })),
                Err(message) => error("AI_SETUP_PROMPT_FAILED", &message),
            }
        }
        "ai:testConnection" => {
            let store = ai_store(app);
            match connection_target(&store, payload) {
                Ok((base_url, api_key)) => ok(serde_json::to_value(ai_service::test_connection(
                    &base_url,
                    api_key.as_deref(),
                ))
                .unwrap_or(Value::Null)),
                Err(failure) => failure,
            }
        }
        "ai:listModels" => {
            let store = ai_store(app);
            match connection_target(&store, payload) {
                Ok((base_url, api_key)) => {
                    ok(json!({ "models": ai_service::list_models(&base_url, api_key.as_deref()) }))
                }
                Err(failure) => failure,
            }
        }
        "ai:embed" | "ai:embedWithMetadata" => {
            let store = ai_store(app);
            let texts: Result<Vec<String>, Value> =
                serde_json::from_value(payload.get("texts").cloned().unwrap_or(Value::Null))
                    .map_err(|e| error("INVALID_AI_EMBEDDING_INPUT", &e.to_string()));
            match texts.and_then(|texts| ai_embed_with_metadata(&store, &texts)) {
                Ok(result) if channel == "ai:embed" => {
                    ok(serde_json::to_value(result.vectors).unwrap_or(Value::Null))
                }
                Ok(result) => ok(serde_json::to_value(result).unwrap_or(Value::Null)),
                Err(failure) => failure,
            }
        }
        "ai:export" => {
            let store = ai_store(app);
            ok(store.export_profiles())
        }
        "ai:import" => {
            let store = ai_store(app);
            match string_field(payload, "json") {
                Some(json) => ok(store.import_profiles(&json)),
                None => error("INVALID_AI_IMPORT", "json is required"),
            }
        }
        "ai:retrieve" => error(
            "AI_RETRIEVAL_NOT_PORTED",
            "AI retrieval is implemented by the DEV-121 runtime slice",
        ),
        channel if channel.starts_with("ai:") => error(
            "UNSUPPORTED_CHANNEL",
            "This AI command is not ported to Rust yet",
        ),
        "plugins:ping" => ping("plugins", "DEV-013"),
        "plugins:list"
        | "plugins:listCommands"
        | "plugins:listContributions"
        | "plugins:pickSource"
        | "plugins:installPreview"
        | "plugins:confirmInstall"
        | "plugins:uninstall"
        | "plugins:setEnabled"
        | "plugins:listAuditLog"
        | "plugins:revokePermission"
        | "plugins:runCommand"
        | "plugins:beginSession"
        | "plugins:closeSession"
        | "plugins:getRuntimeSource"
        | "plugins:reportCrash"
        | "plugins:beginAuthChallenge"
        | "plugins:rejectAuthChallenge"
        | "plugins:grantPermission"
        | "plugins:rpc" => {
            let mut store = plugin_state.store.lock().expect("plugin store lock");
            match channel {
                "plugins:list" => {
                    let views = store.list();
                    match serde_json::to_value(views) {
                        Ok(value) => ok(value),
                        Err(e) => error("PLUGIN_SERIALIZE_FAILED", &e.to_string()),
                    }
                }
                "plugins:uninstall" => match string_field(payload, "pluginId") {
                    Some(id) => match store.uninstall(&id) {
                        Ok(()) => ok(Value::Null),
                        Err(e) => error("PLUGIN_UNINSTALL_FAILED", &e),
                    },
                    None => error("PLUGIN_ID_REQUIRED", "pluginId is required"),
                },
                "plugins:setEnabled" => {
                    match (
                        string_field(payload, "pluginId"),
                        payload.get("enabled").and_then(Value::as_bool),
                    ) {
                        (Some(id), Some(enabled)) => match store.set_enabled(&id, enabled) {
                            Ok(view) => match serde_json::to_value(view) {
                                Ok(value) => ok(value),
                                Err(e) => error("PLUGIN_SERIALIZE_FAILED", &e.to_string()),
                            },
                            Err(e) => error("PLUGIN_SET_ENABLED_FAILED", &e),
                        },
                        _ => error("PLUGIN_ID_REQUIRED", "pluginId and enabled are required"),
                    }
                }
                "plugins:listAuditLog" => {
                    let plugin_id = string_field(payload, "pluginId");
                    let limit =
                        payload.get("limit").and_then(Value::as_u64).unwrap_or(100) as usize;
                    let records = store.list_audit_log(plugin_id.as_deref(), limit);
                    match serde_json::to_value(records) {
                        Ok(value) => ok(value),
                        Err(e) => error("PLUGIN_SERIALIZE_FAILED", &e.to_string()),
                    }
                }
                "plugins:getRuntimeSource" => match string_field(payload, "pluginId") {
                    Some(id) => match store.get_runtime_source(&id) {
                        Ok(source) => ok(json!({ "source": source })),
                        Err(e) => error("PLUGIN_SOURCE_FAILED", &e),
                    },
                    None => error("PLUGIN_ID_REQUIRED", "pluginId is required"),
                },
                "plugins:beginSession" => match string_field(payload, "pluginId") {
                    Some(id) => match store.begin_session(&id) {
                        Ok(token) => match serde_json::to_value(token) {
                            Ok(value) => ok(value),
                            Err(e) => error("PLUGIN_SERIALIZE_FAILED", &e.to_string()),
                        },
                        Err(e) => error("PLUGIN_SESSION_FAILED", &e),
                    },
                    None => error("PLUGIN_ID_REQUIRED", "pluginId is required"),
                },
                "plugins:closeSession" => match string_field(payload, "token") {
                    Some(token) => match store.close_session(&token) {
                        Ok(()) => ok(Value::Null),
                        Err(e) => error("PLUGIN_SESSION_FAILED", &e),
                    },
                    None => error("TOKEN_REQUIRED", "token is required"),
                },
                _ => error(
                    "PLUGIN_NOT_PORTED",
                    "This plugin command is not ported to Rust yet",
                ),
            }
        }
        "skills:list" | "skills:retrieve" | "skills:setEnabled" | "skills:setOrder"
        | "skills:setParams" => error(
            "SKILL_SERVICE_NOT_PORTED",
            "Skill service is not ported to Rust yet",
        ),
        "skills:ping" => ping("skills", "DEV-014"),
        "chat:new" => {
            let title = string_field(payload, "title").unwrap_or_default();
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let path = format!(".nexnote/sessions/{id}.txt");
            ok(json!({
                "path": path,
                "meta": {
                    "id": id, "title": title, "profileId": null, "model": null,
                    "permissionMode": null, "createdAt": now, "updatedAt": now
                },
                "turns": []
            }))
        }
        "chat:list" => {
            let Some(root) = vault_root.get() else {
                return ok(json!([]));
            };
            let sessions_dir = root.join(".nexnote/sessions");
            let mut summaries = Vec::new();
            if let Ok(entries) = fs::read_dir(&sessions_dir) {
                for entry in entries.filter_map(Result::ok) {
                    let path = entry.path();
                    if path.extension().and_then(|v| v.to_str()) != Some("txt") {
                        continue;
                    }
                    let Ok(content) = fs::read_to_string(&path) else {
                        continue;
                    };
                    let mut meta = Value::Null;
                    let mut status = "complete".to_owned();
                    for line in content.lines() {
                        if let Ok(v) = serde_json::from_str::<Value>(line) {
                            if v.get("meta").is_some() {
                                meta = v["meta"].clone();
                            } else if v.get("status").is_some() {
                                status = v["status"].as_str().unwrap_or("complete").to_owned();
                            }
                        }
                    }
                    let rel = path
                        .strip_prefix(&root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .replace('\\', "/");
                    summaries.push(json!({
                        "path": rel,
                        "id": meta["id"],
                        "title": meta["title"],
                        "model": meta["model"],
                        "turnCount": content.lines().count().saturating_sub(2),
                        "updatedAt": meta["updatedAt"],
                        "status": status,
                    }));
                }
            }
            summaries.sort_by(|a, b| {
                b["updatedAt"]
                    .as_str()
                    .unwrap_or("")
                    .cmp(a["updatedAt"].as_str().unwrap_or(""))
            });
            ok(json!(summaries))
        }
        "chat:get" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            let Some(path) = string_field(payload, "path") else {
                return error("CHAT_PATH_REQUIRED", "path is required");
            };
            match fs::read_to_string(root.join(&path)) {
                Ok(content) => {
                    let mut meta = Value::Null;
                    let mut turns = Vec::new();
                    let mut status = "complete".to_owned();
                    let mut error_msg: Option<String> = None;
                    for line in content.lines() {
                        if let Ok(v) = serde_json::from_str::<Value>(line) {
                            if v.get("meta").is_some() {
                                meta = v["meta"].clone();
                            } else if v.get("status").is_some() {
                                status = v["status"].as_str().unwrap_or("complete").to_owned();
                                error_msg = v
                                    .get("error")
                                    .and_then(Value::as_str)
                                    .map(ToOwned::to_owned);
                            } else {
                                turns.push(v);
                            }
                        }
                    }
                    let mut result =
                        json!({ "path": path, "meta": meta, "turns": turns, "status": status });
                    if let Some(err) = error_msg {
                        result["error"] = json!(err);
                    }
                    ok(result)
                }
                Err(_) => error("CHAT_NOT_FOUND", "Chat session not found"),
            }
        }
        "chat:save" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            let Some(session) = payload.get("session") else {
                return error("CHAT_SESSION_REQUIRED", "session is required");
            };
            let path = session.get("path").and_then(Value::as_str).unwrap_or("");
            if path.is_empty() {
                return error("CHAT_PATH_REQUIRED", "session path is required");
            }
            let target = root.join(path);
            if let Some(parent) = target.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let mut lines = Vec::new();
            if let Some(meta) = session.get("meta") {
                lines.push(json!({ "meta": meta }).to_string());
            }
            if let Some(turns) = session.get("turns").and_then(Value::as_array) {
                for turn in turns {
                    lines.push(turn.to_string());
                }
            }
            let status = payload
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("complete");
            let mut status_line = json!({ "status": status });
            if let Some(err) = payload.get("error").and_then(Value::as_str) {
                status_line["error"] = json!(err);
            }
            lines.push(status_line.to_string());
            let content = lines.join("\n");
            match fs::write(&target, &content) {
                Ok(()) => ok(json!({
                    "path": path,
                    "name": "",
                    "kind": "file",
                    "size": content.len(),
                    "modifiedAt": chrono::Utc::now().to_rfc3339(),
                })),
                Err(e) => error("CHAT_SAVE_FAILED", &e.to_string()),
            }
        }
        "chat:saveAsDoc" => error(
            "CHAT_SAVE_AS_DOC_NOT_PORTED",
            "Chat save-as-doc is not ported to Rust yet",
        ),
        "agent:cancel" | "agent:approval:respond" => error(
            "AGENT_NOT_PORTED",
            "Agent gateway is not ported to Rust yet",
        ),
        "binary:ping" => ping("binary", "DEV-074"),
        "binary:import" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            match binary_service::import_binary(&root, payload) {
                Ok(value) => value,
                Err(e) => error(&e.code, &e.message),
            }
        }
        "binary:create" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            match binary_service::create_binary(&root, payload) {
                Ok(value) => value,
                Err(e) => error(&e.code, &e.message),
            }
        }
        "binary:read" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            match binary_service::read_binary(&root, payload) {
                Ok(value) => value,
                Err(e) => error(&e.code, &e.message),
            }
        }
        "binary:save" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            match binary_service::save_binary(&root, payload) {
                Ok(value) => value,
                Err(e) => error(&e.code, &e.message),
            }
        }
        "binary:gitignore:set" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            match binary_service::set_binary_ignore(&root, payload) {
                Ok(value) => value,
                Err(e) => error(&e.code, &e.message),
            }
        }
        "binary:gitignore:get" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            match binary_service::get_binary_ignore(&root) {
                Ok(value) => value,
                Err(e) => error(&e.code, &e.message),
            }
        }
        "print:document" => {
            let Some(title) = string_field(payload, "title") else {
                return error("PRINT_TITLE_REQUIRED", "title is required");
            };
            let Some(html) = string_field(payload, "html") else {
                return error("PRINT_HTML_REQUIRED", "html is required");
            };
            let request = print_service::PrintDocumentRequest { title, html };
            match print_service::print_document(&request) {
                Ok(result) => match serde_json::to_value(result) {
                    Ok(value) => ok(value),
                    Err(e) => error("PRINT_SERIALIZE_FAILED", &e.to_string()),
                },
                Err(e) => error("PRINT_VALIDATION_FAILED", &e.to_string()),
            }
        }
        "docx:import" | "docx:export" => error(
            "DOCX_NOT_PORTED",
            "DOCX import/export is not ported to Rust yet",
        ),
        channel if channel.starts_with("agent:run:") => error(
            "AGENT_NOT_PORTED",
            "Agent gateway is not ported to Rust yet",
        ),
        _ => error(
            "UNSUPPORTED_CHANNEL",
            "This product command is not ported to Rust yet",
        ),
    }
}

pub fn sync_vault_root(root: &Path, state: &VaultRoot) -> Result<(), Value> {
    if !root.join(".nexnote/config.json").is_file() {
        return Err(json!({
            "ok": false,
            "code": "NOT_A_VAULT",
            "error": "The selected directory has no NexNote config"
        }));
    }
    *state.root.lock().expect("vault root lock") = Some(root.to_path_buf());
    index_service::rebuild(root);
    Ok(())
}

pub fn close_vault_root(state: &VaultRoot) {
    *state.root.lock().expect("vault root lock") = None;
    index_service::close();
}

fn default_updates() -> Value {
    json!({ "channel": "stable", "autoDownload": false, "checkOnLaunch": true })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn temp_vault() -> PathBuf {
        let id = TEMP_SEQUENCE.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!("nexnote-dev119-{}-{id}", std::process::id()));
        fs::create_dir_all(root.join(".nexnote")).expect("create temp vault");
        root
    }

    #[test]
    fn creates_and_persists_default_vault_config() {
        let root = temp_vault();
        let config_path = root.join(".nexnote/config.json");
        write_config(&config_path, &default_vault_config()).expect("write config");
        let raw = fs::read_to_string(config_path).expect("read config");
        let config: Value = serde_json::from_str(&raw).expect("parse config");
        assert_eq!(config["version"], 1);
        assert_eq!(config["settings"]["editor"]["autoSaveMs"], 1500);
        assert_eq!(config["layout"]["sidebarWidth"], 260);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn sidecar_file_content_roundtrips_inside_vault() {
        let root = temp_vault();
        let note = "# My Note\n\nLinked to [[Other Note]].\n\n#project/next\n";
        let payload = json!({ "path": ".nexnote/sidecar/test.json", "content": note });
        assert_eq!(vault_fs::write_text_file(&root, &payload)["ok"], true);
        assert_eq!(vault_fs::read_text_file(&root, &payload)["ok"], true);
        assert!(vault_fs::read_text_file(&root, &payload)
            .pointer("/data/content")
            .and_then(Value::as_str)
            .is_some_and(|content| content.contains("[[Other Note]]")));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn index_commands_accept_a_document_and_return_a_stable_contract() {
        index_service::with_test_lock(|| {
            let root = temp_vault();
            let note = r#"---
title: Architecture
tags: [rust, tauri]
---

See [[Glossary]].
"#;
            fs::write(root.join("Architecture.md"), note).expect("write note");
            assert_eq!(index_service::rebuild(&root)["ok"], true);
            assert_eq!(
                index_service::search(&root, &json!({ "query": "Glossary" }))["ok"],
                true
            );
            assert_eq!(
                index_service::backlinks(&root, &json!({ "title": "Glossary" }))["ok"],
                true
            );
            fs::remove_dir_all(root).ok();
        });
    }
}
