use crate::{
    agent_scenario, agent_service, agent_tools,
    ai_service::{self, AiStore},
    binary_host_service, binary_service, confidence_service, embedding_service,
    git_service::{self, GitError},
    git_sync, index_service, plugin_service, print_service, retrieval_service, skill_service,
    updater_service, vault_fs, watcher_service,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
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
    /// Active binary-editor host theme; hosts read this on creation until
    /// the multi-WebView runtime can push live updates (DEV-123).
    editor_theme: Mutex<&'static str>,
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
            editor_theme: Mutex::new("light"),
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

/// Agent-run skill retrieval budget. Below the channel default so a long
/// conversation cannot crowd out the system prompt.
const AGENT_SKILL_BUDGET_CHARS: u64 = 2000;

/// Retrieves the skill context for one agent run, or `None` when the run has
/// no skills and no user text to search with.
///
/// Returns a failure envelope so the caller can fail the run with the stable
/// code (a requested-but-missing skill must not silently drop).
fn agent_skill_context<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    embedding: &State<'_, std::sync::Arc<embedding_service::EmbeddingState>>,
    vault_root: &State<'_, VaultRoot>,
    payload: &Value,
) -> Result<Option<Value>, Value> {
    let last_user = payload
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages
                .iter()
                .rev()
                .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        })
        .or_else(|| payload.get("target"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let skill_ids = payload.get("skillIds").and_then(Value::as_array);
    if last_user.trim().is_empty() && skill_ids.is_none() {
        return Ok(None);
    }
    let Some(root) = vault_root.get() else {
        return Err(error("NO_VAULT", "No vault is open"));
    };
    let mut request = json!({
        "query": last_user,
        "budgetChars": AGENT_SKILL_BUDGET_CHARS,
    });
    if let Some(skill_ids) = skill_ids {
        request["skillIds"] = Value::Array(skill_ids.clone());
    }
    match skill_retrieve(app, embedding, &root, &request) {
        Ok(response) => Ok(Some(response)),
        Err(failure) => Err(error(
            failure
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("SKILL_RETRIEVE_FAILED"),
            failure
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Skill retrieval failed"),
        )),
    }
}

/// Runs multi-skill retrieval and returns the merged payload. Shared by the
/// `skills:retrieve` channel and agent runs (DEV-121), so both paths use the
/// same per-skill params, cross-skill merge, and context packing.
fn skill_retrieve<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    embedding: &State<'_, std::sync::Arc<embedding_service::EmbeddingState>>,
    root: &Path,
    payload: &Value,
) -> Result<Value, Value> {
    let query = string_field(payload, "query").unwrap_or_default();
    if query.trim().is_empty() {
        return Err(error("QUERY_REQUIRED", "query is required"));
    }
    // Resolve the embedding profile once for all skills (they share the same
    // vector runtime; only their retrieval params differ).
    index_service::ensure_open(root)?;
    let store = ai_store(app);
    let embedder = match embedding_source(&store) {
        Ok((profile, _)) if profile.kind == ai_service::AiProviderKind::LocalEmbedding => {
            Some(retrieval_service::Embedder::BuiltIn {
                state: embedding.inner().clone(),
                profile_id: profile.id,
            })
        }
        Ok((profile, model)) => Some(retrieval_service::Embedder::Remote {
            base_url: profile.base_url,
            model,
            profile_id: profile.id,
        }),
        Err(_) => None,
    };

    // Select the enabled skills (or the explicit subset).
    let requested_ids: Option<Vec<String>> =
        payload
            .get("skillIds")
            .and_then(Value::as_array)
            .map(|ids| {
                ids.iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect()
            });
    let skill_store_handle = skill_store(app);
    let active_skills: Vec<skill_service::SkillView> = skill_store_handle
        .list()
        .into_iter()
        .filter(|view| {
            view.enabled
                && view.available
                && requested_ids
                    .as_ref()
                    .is_none_or(|ids| ids.iter().any(|id| id == &view.id))
        })
        .collect();

    let default_top_k = payload.get("topK").and_then(Value::as_u64).unwrap_or(8) as usize;
    let default_budget = payload
        .get("budgetChars")
        .and_then(Value::as_u64)
        .unwrap_or(4000) as usize;

    if active_skills.is_empty() {
        return Ok(json!({
            "query": query,
            "usedSkillIds": Vec::<String>::new(),
            "sources": Vec::<Value>::new(),
            "degraded": false,
            "contextText": "",
        }));
    }

    // Per-skill retrieval with that skill's params; sources carry a skillId
    // tag for cross-skill provenance.
    let request_overrides = payload.get("confidenceWeight").and_then(Value::as_f64);
    let disable_vector_override = payload.get("disableVector").and_then(Value::as_bool);
    let mut runs: Vec<(String, Vec<Value>, bool)> = Vec::new();
    let mut retrieval_model: Option<String> = None;
    for skill in &active_skills {
        let top_k = skill
            .params
            .get("topK")
            .and_then(Value::as_u64)
            .unwrap_or(default_top_k as u64) as usize;
        let budget = skill
            .params
            .get("budgetChars")
            .and_then(Value::as_u64)
            .unwrap_or(default_budget as u64) as usize;
        let confidence = skill
            .params
            .get("confidenceWeight")
            .and_then(Value::as_f64)
            .or(request_overrides)
            .unwrap_or(0.3);
        let disable_vector = skill
            .params
            .get("disableVector")
            .and_then(Value::as_bool)
            .or(disable_vector_override)
            .unwrap_or(false);

        let request = retrieval_service::RetrievalRequest {
            query: query.clone(),
            top_k,
            fts_limit: 20,
            budget_chars: budget,
            confidence_weight: confidence,
            disable_vector,
        };
        let response = retrieval_service::retrieve(root, &request, embedder.as_ref());
        let degraded = response
            .get("degraded")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        // Skills share one vector runtime, so the first model identity is the
        // run's retrieval model; it labels the turn's sources in the UI.
        if retrieval_model.is_none() {
            retrieval_model = response
                .get("model")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
        }
        let sources: Vec<Value> = response
            .get("sources")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        runs.push((skill.id.clone(), sources, degraded));
    }

    // Cross-skill merge: min-max normalize per skill, dedup by path+blockId,
    // keep the highest normalized score, tag all matching skills, then sort.
    let merged = merge_skill_results(&runs);
    let any_degraded = runs.iter().any(|(_, _, degraded)| *degraded);
    let used_ids: Vec<&str> = active_skills.iter().map(|s| s.id.as_str()).collect();

    // Pack context from the merged sources within the budget.
    let context = pack_skill_context(&merged, default_budget);
    Ok(json!({
        "query": query,
        "usedSkillIds": used_ids,
        "sources": merged,
        "degraded": any_degraded,
        "retrievalModel": retrieval_model,
        "contextText": context,
    }))
}

/// Cross-skill merge + rerank (DEV-014, mirrors `merge-rerank.ts`).
///
/// Raw scores from different skills (or the same retriever with different
/// params) are not directly comparable: normalize per skill with min-max,
/// dedup by `path::blockId`, keep the highest normalized score when a source
/// is hit by multiple skills, then sort by normalized score descending (fall
/// back to raw score, then path, for stability).
fn merge_skill_results(runs: &[(String, Vec<Value>, bool)]) -> Vec<Value> {
    let mut merged: Vec<(Value, f64, f64, String)> = Vec::new();

    for (skill_id, sources, _) in runs {
        let scores: Vec<f64> = sources
            .iter()
            .map(|s| s.get("score").and_then(Value::as_f64).unwrap_or(0.0))
            .collect();
        let max = scores.iter().cloned().fold(0.0, f64::max);
        let min = scores.iter().cloned().fold(0.0, f64::min);
        let range = max - min;

        for source in sources {
            let raw = source.get("score").and_then(Value::as_f64).unwrap_or(0.0);
            let norm = if range > 0.0 {
                (raw - min) / range
            } else if raw > 0.0 {
                1.0
            } else {
                0.0
            };
            let path = source.get("path").and_then(Value::as_str).unwrap_or("");
            let block = source.get("blockId").and_then(Value::as_str).unwrap_or("");
            let key = format!("{path}::{block}");

            // Tag this source with the skill that retrieved it.
            let mut tagged = source.clone();
            tagged["skillId"] = json!(skill_id);

            match merged
                .iter_mut()
                .find(|(_, _, _, existing_key)| *existing_key == key)
            {
                None => {
                    merged.push((tagged, norm, raw, key));
                }
                Some((existing_source, existing_norm, existing_raw, _)) => {
                    // Multi-skill hit: keep the highest normalized score.
                    if norm > *existing_norm {
                        *existing_source = tagged;
                    }
                    *existing_norm = existing_norm.max(norm);
                    *existing_raw = existing_raw.max(raw);
                    // Provenance: a source hit by several skills records
                    // every matcher, not just the highest-scoring one.
                    let mut hits: Vec<String> = existing_source["skillIds"]
                        .as_array()
                        .map(|ids| {
                            ids.iter()
                                .filter_map(Value::as_str)
                                .map(ToOwned::to_owned)
                                .collect()
                        })
                        .unwrap_or_else(|| {
                            existing_source["skillId"]
                                .as_str()
                                .map(|id| vec![id.to_owned()])
                                .unwrap_or_default()
                        });
                    if !hits.iter().any(|id| id == skill_id) {
                        hits.push(skill_id.clone());
                    }
                    existing_source["skillIds"] = json!(hits);
                }
            }
        }
    }

    // Sort by normalized score (primary), then raw score, then path — the
    // exact ordering contract from Electron's merge-rerank.ts.
    merged.sort_by(|(_, a_norm, a_raw, a_key), (_, b_norm, b_raw, b_key)| {
        b_norm
            .partial_cmp(a_norm)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                b_raw
                    .partial_cmp(a_raw)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| a_key.cmp(b_key))
    });

    merged
        .into_iter()
        .map(|(mut source, norm, raw, _)| {
            source["score"] = json!(raw);
            // `skillIds` is the complete match set; `skillId` stays the
            // single primary matcher for back-compat with older callers.
            if let Some(ids) = source["skillIds"].as_array().cloned() {
                if !ids.is_empty() {
                    source["skillId"] = ids[0].clone();
                }
            }
            let _ = norm;
            source
        })
        .collect::<Vec<_>>()
        .into_iter()
        .collect()
}

/// Packs merged sources into a context string within the budget.
fn pack_skill_context(sources: &[Value], budget_chars: usize) -> String {
    let mut parts = Vec::new();
    let mut used = 0usize;
    for source in sources {
        let title = source.get("title").and_then(Value::as_str).unwrap_or("");
        let skill = source.get("skillId").and_then(Value::as_str).unwrap_or("");
        let snippet = source.get("snippet").and_then(Value::as_str).unwrap_or("");
        let block = format!("{title}（{skill}）\n{snippet}");
        if used + block.chars().count() > budget_chars {
            break;
        }
        used += block.chars().count() + 2;
        parts.push(block);
    }
    parts.join("\n\n")
}

/// Emits the renderer-visible event that follows a successful command.
///
/// The renderer subscribes to these events to refresh stores; without them the
/// UI silently goes stale even though every command call succeeds. Payloads
/// reuse the same values the command returned, so an event can never disagree
/// with the response that triggered it.
fn emit_channel_event<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    channel: &str,
    vault_root: &VaultRoot,
) {
    let state = app.state::<ProductState>();
    match channel {
        // AI config changes invalidate the wizard, the model list and the
        // embedding generation in every open surface.
        "ai:profile:save"
        | "ai:profile:delete"
        | "ai:profile:setDefault"
        | "ai:features:set"
        | "ai:translation:setTargetLanguage"
        | "ai:import" => {
            let store = ai_store(app);
            let _ = app.emit("ai:configChanged", json!({ "state": store.get_state() }));
        }
        "settings:setGlobal"
        | "settings:setVault"
        | "settings:setShortcuts"
        | "settings:importShortcuts" => {
            let global = state.global_settings.lock().expect("settings lock").clone();
            // Read the persisted vault settings so the event payload equals
            // what `settings:getVault` would return, never a defaulted guess.
            let vault = vault_root.get().map(|_| current_vault_settings(&state));
            let _ = app.emit(
                "settings:changed",
                json!({ "global": global, "vault": vault }),
            );
        }
        // Any git mutation can change status, ahead/behind or conflicts.
        "git:commit"
        | "git:initGit"
        | "git:addRemote"
        | "git:removeRemote"
        | "git:setBranch"
        | "git:fetch"
        | "git:pull"
        | "git:push"
        | "git:sync"
        | "git:rebase"
        | "git:abort"
        | "git:doctor:repairExecute" => {
            if let Some(root) = vault_root.get() {
                if let Ok(status) = git_service::status(&root) {
                    let _ = app.emit("git:statusChanged", status);
                }
            }
        }
        "plugins:confirmInstall" | "plugins:uninstall" | "plugins:setEnabled" => {
            let _ = app.emit("plugins:changed", json!({ "reason": channel }));
        }
        "skills:setEnabled" | "skills:setOrder" | "skills:setParams" => {
            // Reasons match the Electron handler byte-for-byte.
            let reason = match channel {
                "skills:setEnabled" => "enabled",
                "skills:setOrder" => "order",
                _ => "params",
            };
            let _ = app.emit("skills:changed", json!({ "reason": reason }));
        }
        "index:rebuild" => {
            if let Some(root) = vault_root.get() {
                let status = index_service::status(&root);
                let _ = app.emit("index:statusChanged", status["data"].clone());
                // Confidence depends on the fully indexed pages and links.
                if index_service::ensure_open(&root).is_ok() {
                    let guard = index_service::db_handle();
                    if let Some(conn) = guard.as_ref() {
                        if let Ok(paths) = confidence_service::refresh(conn, &root, None) {
                            let affected: Option<Vec<String>> =
                                (!paths.is_empty()).then_some(paths);
                            let _ =
                                app.emit("index:confidenceChanged", json!({ "paths": affected }));
                        }
                    }
                }
            }
        }
        _ => {}
    }
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

/// Persisted vault settings for the `settings:changed` event payload.
fn current_vault_settings(state: &State<'_, ProductState>) -> Value {
    state
        .current_vault
        .lock()
        .expect("vault state lock")
        .as_ref()
        .and_then(|vault| {
            fs::read_to_string(&vault.config_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        })
        .and_then(|config| config.get("settings").cloned())
        .unwrap_or_else(default_vault_settings)
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

fn app_info<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Value {
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

fn ai_store<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> std::sync::MutexGuard<'static, AiStore> {
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

static SKILL_STORE: OnceLock<Mutex<skill_service::SkillStore>> = OnceLock::new();

fn skill_store<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> std::sync::MutexGuard<'static, skill_service::SkillStore> {
    let store = SKILL_STORE.get_or_init(|| {
        let data_dir = app.path().app_data_dir().unwrap_or_default();
        Mutex::new(skill_service::SkillStore::new(
            data_dir.join("nexnote-skills.json"),
        ))
    });
    store
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
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
        // Secret bytes live only in the OS credential vault; the renderer
        // never sees them and the config file never stores them.
        return Ok((profile.base_url, ai_service::read_credential(&profile.id)));
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
    embedding_state: &embedding_service::EmbeddingState,
    texts: &[String],
    role: embedding_service::InputRole,
) -> Result<ai_service::EmbedResult, Value> {
    let (profile, model) = embedding_source(store)?;
    if profile.kind == ai_service::AiProviderKind::LocalEmbedding {
        // Built-in vectors stay on device; the prefix depends on the semantic
        // role and must never be supplied by the caller.
        let vectors = embedding_state
            .embed(role, texts)
            .map_err(ai_error)?
            .into_iter()
            .map(|vector| vector.into_iter().map(f64::from).collect())
            .collect();
        return Ok(ai_service::EmbedResult {
            dimensions: embedding_service::MODEL_DIMENSIONS,
            vectors,
            model: embedding_service::model_identity(),
            profile_id: profile.id,
        });
    }
    let api_key = ai_service::read_credential(&profile.id);
    let vectors = ai_service::embed(&profile.base_url, api_key.as_deref(), &model, texts)
        .map_err(ai_error)?;
    let dimensions = vectors.first().map_or(0, Vec::len) as u32;
    Ok(ai_service::EmbedResult {
        vectors,
        dimensions,
        model,
        profile_id: profile.id,
    })
}

#[tauri::command]
// Tauri injects one parameter per managed state plus the window that invoked
// the command; the count is fixed by the framework, not by this file.
#[allow(clippy::too_many_arguments)]
pub async fn nexnote_invoke(
    app: AppHandle,
    webview: WebviewWindow,
    state: State<'_, ProductState>,
    embedding: State<'_, std::sync::Arc<embedding_service::EmbeddingState>>,
    plugin_state: State<'_, PluginState>,
    vault_root: State<'_, VaultRoot>,
    channel: String,
    payload: Option<Value>,
) -> Result<Value, ()> {
    let payload = payload.unwrap_or(Value::Null);
    let response = dispatch(
        &app,
        Some(webview.label()),
        &state,
        &embedding,
        &plugin_state,
        &vault_root,
        &channel,
        &payload,
    );
    // Renderer stores refresh from events, not from call sites: only a
    // successful command may announce a change.
    if response.get("ok") == Some(&Value::Bool(true)) {
        emit_channel_event(&app, &channel, &vault_root);
    }
    Ok(response)
}

#[allow(clippy::too_many_arguments)]
fn dispatch<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    sender: Option<&str>,
    state: &State<'_, ProductState>,
    embedding: &State<'_, std::sync::Arc<embedding_service::EmbeddingState>>,
    plugin_state: &State<'_, PluginState>,
    vault_root: &State<'_, VaultRoot>,
    channel: &str,
    payload: &Value,
) -> Value {
    match channel {
        "app:getInfo" => ok(app_info(app)),
        "app:checkForUpdates" => updater_service::check(app),
        "app:downloadUpdate" | "app:installUpdate" => updater_service::download_and_install(app),
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
        "settings:pickImportFile" => {
            let picked = app.dialog().file().blocking_pick_file();
            ok(picked.map(|p| json!(p.to_string())).unwrap_or(Value::Null))
        }
        "settings:saveExportFile" => {
            let contents = string_field(payload, "contents").unwrap_or_default();
            let suggested =
                string_field(payload, "suggestedName").unwrap_or_else(|| "export.json".into());
            let picked = app
                .dialog()
                .file()
                .set_file_name(&suggested)
                .blocking_save_file();
            match picked {
                Some(path) => match fs::write(path.to_string(), &contents) {
                    Ok(()) => ok(json!(path.to_string())),
                    Err(e) => error("SETTINGS_SAVE_FAILED", &e.to_string()),
                },
                None => ok(Value::Null),
            }
        }
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
            let root = parent.join(&name);
            let config_path = root.join(".nexnote/config.json");
            if let Err(e) = write_config(&config_path, &default_vault_config()) {
                return error("VAULT_CREATE_FAILED", &e.to_string());
            }
            let info = vault_info_for_path(&root);
            if payload
                .get("initGit")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                let _ = fs::create_dir_all(&root);
                let init_result = git_service::init(&root);
                if init_result.is_err() {
                    let _ = fs::remove_dir_all(&root);
                    return match init_result {
                        Err(e) => error("GIT_INIT_FAILED", &e.to_string()),
                        Ok(_) => unreachable!(),
                    };
                }
            }
            if let Err(e) = sync_vault_root(app, &root, vault_root) {
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
            if let Err(e) = sync_vault_root(app, &root, vault_root) {
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
            if let Err(e) = sync_vault_root(app, &root, vault_root) {
                return e;
            }
            state.set_current_vault(info.clone());
            let _ = app.emit("vault:changed", &info);
            ok(serde_json::to_value(info).unwrap_or(Value::Null))
        }
        "vault:clonePreflight" => {
            let Some(url) = string_field(payload, "url") else {
                return error("CLONE_URL_REQUIRED", "url is required");
            };
            let reachable = url.starts_with("https://") || url.starts_with("git@");
            ok(json!({
                "reachable": reachable,
                "error": if reachable { Value::Null } else { json!("URL must start with https:// or git@") },
            }))
        }
        "vault:clone" => {
            let Some(url) = string_field(payload, "url") else {
                return error("CLONE_URL_REQUIRED", "url is required");
            };
            let Some(parent) = string_field(payload, "parentDir") else {
                return error("CLONE_PARENT_REQUIRED", "parentDir is required");
            };
            let name = string_field(payload, "name").unwrap_or_else(|| {
                url.rsplit('/')
                    .next()
                    .unwrap_or("vault")
                    .trim_end_matches(".git")
                    .to_owned()
            });
            let target = Path::new(&parent).join(&name);
            let output = std::process::Command::new("git")
                .args(["clone", &url])
                .arg(&target)
                .output();
            match output {
                Ok(result) if result.status.success() => {
                    let info = vault_info_for_path(&target);
                    if let Err(e) = sync_vault_root(app, &target, vault_root) {
                        return e;
                    }
                    state.set_current_vault(info.clone());
                    let _ = app.emit("vault:changed", &info);
                    ok(serde_json::to_value(info).unwrap_or(Value::Null))
                }
                Ok(result) => error("CLONE_FAILED", &String::from_utf8_lossy(&result.stderr)),
                Err(e) => error("GIT_NOT_AVAILABLE", &e.to_string()),
            }
        }
        "vault:cancelOperation" => ok(Value::Null),
        "vault:reveal" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            let target = if cfg!(target_os = "macos") {
                std::process::Command::new("open").arg(&root).output()
            } else if cfg!(target_os = "windows") {
                std::process::Command::new("explorer").arg(&root).output()
            } else {
                std::process::Command::new("xdg-open").arg(&root).output()
            };
            match target {
                Ok(_) => ok(Value::Null),
                Err(e) => error("REVEAL_FAILED", &e.to_string()),
            }
        }
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
        | "document:getMetadata"
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
                "document:getMetadata" => {
                    // Sidecar metadata for native-block documents; non-document
                    // paths read as null exactly like the reference handler.
                    match string_field(payload, "path") {
                        Some(path) if vault_fs::is_document_path(&path) => {
                            ok(vault_fs::read_metadata(&root, &path).unwrap_or(Value::Null))
                        }
                        Some(_) => ok(Value::Null),
                        None => error("INVALID_PATH", "path is required"),
                    }
                }
                "fs:writeTextFile" => vault_fs::write_text_file(&root, payload),
                "fs:createTextFile" => vault_fs::create_text_file(&root, payload),
                "fs:createNote" => vault_fs::create_note(&root, payload),
                "fs:exists" => vault_fs::exists(&root, payload),
                "fs:stat" => vault_fs::stat(&root, payload),
                "fs:mkdir" => vault_fs::mkdir(&root, payload),
                "fs:rename" => vault_fs::rename(&root, payload),
                "fs:delete" => vault_fs::delete(&root, payload),
                "fs:scanTags" => vault_fs::scan_tags(&root),
                "fs:importBinaryFile" => {
                    let Some(path) = string_field(payload, "path") else {
                        return error("FS_PATH_REQUIRED", "path is required");
                    };
                    let Some(data_base64) = string_field(payload, "data") else {
                        return error("FS_DATA_REQUIRED", "data is required");
                    };
                    match base64::Engine::decode(
                        &base64::engine::general_purpose::STANDARD,
                        &data_base64,
                    ) {
                        Ok(bytes) => {
                            let target = root.join(&path);
                            if let Some(parent) = target.parent() {
                                let _ = fs::create_dir_all(parent);
                            }
                            match fs::write(&target, &bytes) {
                                Ok(()) => ok(json!({ "path": path })),
                                Err(e) => error("FS_BINARY_IMPORT_FAILED", &e.to_string()),
                            }
                        }
                        Err(e) => error("FS_BINARY_DECODE_FAILED", &e.to_string()),
                    }
                }
                "fs:revealInFinder" => {
                    let Some(path) = string_field(payload, "path") else {
                        return error("FS_PATH_REQUIRED", "path is required");
                    };
                    let target = root.join(&path);
                    let result = if cfg!(target_os = "macos") {
                        std::process::Command::new("open").arg(&target).output()
                    } else if cfg!(target_os = "windows") {
                        std::process::Command::new("explorer").arg(&target).output()
                    } else {
                        std::process::Command::new("xdg-open").arg(&target).output()
                    };
                    match result {
                        Ok(_) => ok(Value::Null),
                        Err(e) => error("REVEAL_FAILED", &e.to_string()),
                    }
                }
                _ => error("FS_UNKNOWN", "Unknown FS command"),
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
                "index:confidence" => {
                    let Some(page_id) = payload.get("pageId").and_then(Value::as_i64) else {
                        return error("PAGE_ID_REQUIRED", "pageId is required");
                    };
                    if let Err(e) = index_service::ensure_open(&root) {
                        return e;
                    }
                    let db_guard = index_service::db_handle();
                    let Some(conn) = db_guard.as_ref() else {
                        return error("INDEX_NOT_OPEN", "Index database is not open");
                    };
                    let row = conn.query_row(
                        "SELECT score, factors_json, computed_at FROM confidence WHERE page_id = ?1",
                        rusqlite::params![page_id],
                        |row| {
                            Ok(json!({
                                "score": row.get::<_, f64>(0)?,
                                "factors": serde_json::from_str::<Value>(&row.get::<_, String>(1)?).unwrap_or(Value::Null),
                                "computedAt": row.get::<_, String>(2)?,
                            }))
                        },
                    );
                    match row {
                        Ok(result) => ok(result),
                        Err(rusqlite::Error::QueryReturnedNoRows) => ok(Value::Null),
                        Err(e) => error("CONFIDENCE_QUERY_FAILED", &e.to_string()),
                    }
                }
                "index:confidenceSettings" => {
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
                            ok(json!({
                                "writeFrontmatter": config
                                    .pointer("/features/confidenceFrontmatter")
                                    .and_then(Value::as_bool)
                                    .unwrap_or(false),
                            }))
                        }
                        None => ok(json!({ "writeFrontmatter": false })),
                    }
                }
                "index:setConfidenceFrontmatter" => {
                    let vault = state
                        .current_vault
                        .lock()
                        .expect("vault state lock")
                        .clone();
                    let Some(vault) = vault else {
                        return error("NO_VAULT", "No vault is open");
                    };
                    let enabled = payload
                        .get("enabled")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let mut config: Value = match fs::read_to_string(&vault.config_path)
                        .ok()
                        .and_then(|raw| serde_json::from_str(&raw).ok())
                    {
                        Some(config) => config,
                        None => default_vault_config(),
                    };
                    if !config.get("features").is_some_and(Value::is_object) {
                        config["features"] = json!({});
                    }
                    config["features"]["confidenceFrontmatter"] = json!(enabled);
                    match write_config(Path::new(&vault.config_path), &config) {
                        Ok(()) => ok(json!({ "writeFrontmatter": enabled })),
                        Err(message) => error("VAULT_CONFIG_WRITE_FAILED", &message.to_string()),
                    }
                }
                _ => error("INDEX_UNKNOWN", "Unknown index command"),
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
                "git:pull" => {
                    let progress_app = app.clone();
                    git_sync::pull(
                        &root,
                        payload
                            .get("force")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        Some(&|phase, message| {
                            let _ = progress_app.emit(
                                "git:syncProgress",
                                json!({ "phase": phase, "message": message }),
                            );
                        }),
                    )
                }
                "git:push" => {
                    let progress_app = app.clone();
                    git_sync::push(
                        &root,
                        Some(&|phase, message| {
                            let _ = progress_app.emit(
                                "git:syncProgress",
                                json!({ "phase": phase, "message": message }),
                            );
                        }),
                    )
                }
                "git:sync" => {
                    let progress_app = app.clone();
                    git_sync::sync(
                        &root,
                        Some(&|phase, message| {
                            let _ = progress_app.emit(
                                "git:syncProgress",
                                json!({ "phase": phase, "message": message }),
                            );
                        }),
                    )
                }
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
            let embedding_state = embedding.inner().clone();
            match texts.and_then(|texts| {
                ai_embed_with_metadata(
                    &store,
                    embedding_state.as_ref(),
                    &texts,
                    embedding_service::InputRole::Passage,
                )
            }) {
                Ok(result) if channel == "ai:embed" => {
                    ok(serde_json::to_value(result.vectors).unwrap_or(Value::Null))
                }
                Ok(result) => ok(serde_json::to_value(result).unwrap_or(Value::Null)),
                Err(failure) => failure,
            }
        }
        "ai:builtInEmbedding:status" => ok(embedding.status()),
        "ai:builtInEmbedding:download" => {
            // Downloads are single-flight and emit progress events so the
            // renderer never blocks an IPC call for a 100MB+ artifact.
            if let Err(message) = embedding.begin_download() {
                return error("BUILTIN_EMBEDDING_DOWNLOAD_IN_FLIGHT", &message);
            }
            let app_handle = app.clone();
            let embedding_state = embedding.inner().clone();
            std::thread::spawn(move || {
                let result = embedding_state.ensure_downloaded(|progress| {
                    let _ = app_handle.emit(
                        "ai:builtInEmbeddingStatus",
                        json!({
                            "phase": "downloading",
                            "file": progress.file,
                            "downloadedBytes": progress.downloaded_bytes,
                            "totalBytes": progress.total_bytes,
                            "done": progress.done,
                        }),
                    );
                });
                embedding_state.end_download();
                let _ = app_handle.emit(
                    "ai:builtInEmbeddingStatus",
                    match &result {
                        Ok(()) => json!({
                            "phase": "ready",
                            "identity": embedding_service::model_identity(),
                        }),
                        Err(message) => json!({
                            "phase": "error",
                            "error": message,
                        }),
                    },
                );
            });
            ok(json!({ "started": true }))
        }
        "ai:builtInEmbedding:delete" => match embedding.delete() {
            Ok(()) => ok(json!({ "deleted": true })),
            Err(message) => error("BUILTIN_EMBEDDING_DELETE_FAILED", &message),
        },
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
        "ai:retrieve" => {
            let Some(root) = vault_root.get() else {
                return error("VAULT_NOT_OPEN", "Open a vault before retrieving context");
            };
            if let Err(failure) = index_service::ensure_open(&root) {
                return failure;
            }
            // Install the vector-build progress hook once; the handle outlives
            // every retrieval run and the callback is process-wide by design.
            retrieval_service::BUILD_PROGRESS_CALLBACK.get_or_init(|| {
                let progress_app = app.clone();
                Box::new(move |blocks_done: u64, blocks_total: u64, note: &str| {
                    let failed = note.starts_with("error:");
                    let phase = if failed {
                        "error"
                    } else if blocks_done >= blocks_total {
                        "ready"
                    } else {
                        "building"
                    };
                    let _ = progress_app.emit(
                        "ai:retrievalStatus",
                        json!({
                            "phase": phase,
                            "mode": "full",
                            "blocksTotal": blocks_total,
                            "blocksDone": blocks_done,
                            "model": if failed { Value::Null } else { json!(note) },
                            "error": if failed { note.strip_prefix("error:") } else { None },
                        }),
                    );
                }) as retrieval_service::BuildProgressHook
            });
            let store = ai_store(app);
            let request = retrieval_service::RetrievalRequest::from_payload(payload);
            let embedder = match embedding_source(&store) {
                Ok((profile, _)) if profile.kind == ai_service::AiProviderKind::LocalEmbedding => {
                    Some(retrieval_service::Embedder::BuiltIn {
                        state: embedding.inner().clone(),
                        profile_id: profile.id,
                    })
                }
                Ok((profile, model)) => Some(retrieval_service::Embedder::Remote {
                    base_url: profile.base_url,
                    model,
                    profile_id: profile.id,
                }),
                // No embedding configuration degrades retrieval; it is not an error.
                Err(_) => None,
            };
            ok(retrieval_service::retrieve(
                &root,
                &request,
                embedder.as_ref(),
            ))
        }
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
                "plugins:listCommands" => ok(json!(store.list_commands())),
                "plugins:listContributions" => ok(json!(store.list_contributions())),
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
                "plugins:pickSource" => match string_field(payload, "source") {
                    Some(source) => ok(json!({ "source": source, "path": null })),
                    None => error("PLUGIN_SOURCE_REQUIRED", "source is required"),
                },
                "plugins:installPreview" => {
                    match (
                        string_field(payload, "source"),
                        string_field(payload, "path"),
                    ) {
                        (Some(_source), Some(path)) => {
                            match store.install_preview(Path::new(&path)) {
                                Ok(ticket) => match serde_json::to_value(ticket) {
                                    Ok(value) => ok(value),
                                    Err(e) => error("PLUGIN_SERIALIZE_FAILED", &e.to_string()),
                                },
                                Err(e) => error("PLUGIN_PREVIEW_FAILED", &e),
                            }
                        }
                        _ => error("PLUGIN_SOURCE_REQUIRED", "source and path are required"),
                    }
                }
                "plugins:confirmInstall" => {
                    match (
                        string_field(payload, "ticket"),
                        payload.get("accept").and_then(Value::as_bool),
                    ) {
                        (Some(ticket), Some(accept)) => {
                            match store.confirm_install(&ticket, accept) {
                                Ok(view) => match serde_json::to_value(view) {
                                    Ok(value) => ok(value),
                                    Err(e) => error("PLUGIN_SERIALIZE_FAILED", &e.to_string()),
                                },
                                Err(e) => error("PLUGIN_CONFIRM_FAILED", &e),
                            }
                        }
                        _ => error("PLUGIN_CONFIRM_REQUIRED", "ticket and accept are required"),
                    }
                }
                "plugins:revokePermission" => {
                    match (
                        string_field(payload, "pluginId"),
                        string_field(payload, "permission"),
                    ) {
                        (Some(id), Some(perm)) => match store.revoke_permission(&id, &perm) {
                            Ok(view) => match serde_json::to_value(view) {
                                Ok(value) => ok(value),
                                Err(e) => error("PLUGIN_SERIALIZE_FAILED", &e.to_string()),
                            },
                            Err(e) => error("PLUGIN_REVOKE_FAILED", &e),
                        },
                        _ => error(
                            "PLUGIN_PARAMS_REQUIRED",
                            "pluginId and permission are required",
                        ),
                    }
                }
                "plugins:grantPermission" => {
                    match (
                        string_field(payload, "pluginId"),
                        string_field(payload, "permission"),
                    ) {
                        (Some(id), Some(perm)) => match store.grant_permission(&id, &perm) {
                            Ok(view) => match serde_json::to_value(view) {
                                Ok(value) => ok(value),
                                Err(e) => error("PLUGIN_SERIALIZE_FAILED", &e.to_string()),
                            },
                            Err(e) => error("PLUGIN_GRANT_FAILED", &e),
                        },
                        _ => error(
                            "PLUGIN_PARAMS_REQUIRED",
                            "pluginId and permission are required",
                        ),
                    }
                }
                "plugins:beginAuthChallenge" => {
                    match (
                        string_field(payload, "pluginId"),
                        string_field(payload, "permission"),
                    ) {
                        (Some(id), Some(perm)) => match store.begin_auth_challenge(&id, &perm) {
                            Ok(challenge) => match serde_json::to_value(challenge) {
                                Ok(value) => ok(value),
                                Err(e) => error("PLUGIN_SERIALIZE_FAILED", &e.to_string()),
                            },
                            Err(e) => error("PLUGIN_CHALLENGE_FAILED", &e),
                        },
                        _ => error(
                            "PLUGIN_PARAMS_REQUIRED",
                            "pluginId and permission are required",
                        ),
                    }
                }
                "plugins:rejectAuthChallenge" => match string_field(payload, "challenge") {
                    Some(challenge) => match store.reject_auth_challenge(&challenge) {
                        Ok(()) => ok(Value::Null),
                        Err(e) => error("PLUGIN_REJECT_CHALLENGE_FAILED", &e),
                    },
                    None => error("CHALLENGE_REQUIRED", "challenge is required"),
                },
                "plugins:runCommand" => {
                    match (
                        string_field(payload, "pluginId"),
                        string_field(payload, "commandId"),
                    ) {
                        (Some(id), Some(cmd_id)) => {
                            let cmd_payload =
                                payload.get("payload").cloned().unwrap_or(Value::Null);
                            match store.run_command(&id, &cmd_id, cmd_payload) {
                                Ok(ack) => match serde_json::to_value(ack) {
                                    Ok(value) => ok(value),
                                    Err(e) => error("PLUGIN_SERIALIZE_FAILED", &e.to_string()),
                                },
                                Err(e) => error("PLUGIN_COMMAND_FAILED", &e),
                            }
                        }
                        _ => error(
                            "PLUGIN_PARAMS_REQUIRED",
                            "pluginId and commandId are required",
                        ),
                    }
                }
                _ => error(
                    "PLUGIN_NOT_PORTED",
                    "This plugin command is not ported to Rust yet",
                ),
            }
        }
        "skills:ping" => ping("skills", "DEV-014"),
        "skills:list" => {
            let store = skill_store(app);
            ok(serde_json::to_value(store.list()).unwrap_or(Value::Null))
        }
        "skills:retrieve" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            match skill_retrieve(app, embedding, &root, payload) {
                Ok(response) => ok(response),
                Err(failure) => failure,
            }
        }
        "skills:setEnabled" => {
            let store = skill_store(app);
            match (
                string_field(payload, "id"),
                payload.get("enabled").and_then(Value::as_bool),
            ) {
                (Some(id), Some(enabled)) => match store.set_enabled(&id, enabled) {
                    Ok(view) => ok(serde_json::to_value(view).unwrap_or(Value::Null)),
                    Err(message) => error("SKILL_NOT_FOUND", &message),
                },
                _ => error("SKILL_ENABLE_INPUT", "id and enabled are required"),
            }
        }
        "skills:setOrder" => {
            let store = skill_store(app);
            match payload.get("order").and_then(Value::as_array) {
                Some(items) => {
                    let ids: Vec<String> = items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToOwned::to_owned)
                        .collect();
                    match store.set_order(&ids) {
                        Ok(views) => ok(serde_json::to_value(views).unwrap_or(Value::Null)),
                        Err(message) => error("SKILL_ORDER_FAILED", &message),
                    }
                }
                None => error("SKILL_ORDER_INPUT", "order array is required"),
            }
        }
        "skills:setParams" => {
            let store = skill_store(app);
            match (string_field(payload, "id"), payload.get("params").cloned()) {
                (Some(id), Some(params)) => match store.set_params(&id, params) {
                    Ok(view) => ok(serde_json::to_value(view).unwrap_or(Value::Null)),
                    Err(message) => error("SKILL_NOT_FOUND", &message),
                },
                _ => error("SKILL_PARAMS_INPUT", "id and params are required"),
            }
        }
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
        "chat:saveAsDoc" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            let Some(path) = string_field(payload, "path") else {
                return error("CHAT_PATH_REQUIRED", "path is required");
            };
            let session_file = root.join(&path);
            let Ok(content) = fs::read_to_string(&session_file) else {
                return error("CHAT_NOT_FOUND", "Chat session not found");
            };
            let mut doc = String::new();
            for line in content.lines() {
                if let Ok(v) = serde_json::from_str::<Value>(line) {
                    if v.get("meta").is_some() {
                        if let Some(title) = v["meta"]["title"].as_str() {
                            doc.push_str(&format!("# {title}\n\n"));
                        }
                    } else if let Some(role) = v.get("role").and_then(Value::as_str) {
                        let content = v.get("content").and_then(Value::as_str).unwrap_or("");
                        match role {
                            "user" => doc.push_str(&format!("> {content}\n\n")),
                            "assistant" => doc.push_str(&format!("{content}\n\n")),
                            _ => {}
                        }
                    }
                }
            }
            let target_rel = format!("{}.md", path.trim_end_matches(".txt"));
            let target_abs = root.join(&target_rel);
            match fs::write(&target_abs, &doc) {
                Ok(()) => ok(json!({ "path": target_rel })),
                Err(e) => error("CHAT_SAVE_AS_DOC_FAILED", &e.to_string()),
            }
        }
        "agent:cancel" => {
            let Some(run_id) = string_field(payload, "runId") else {
                return error("AGENT_RUN_ID_REQUIRED", "runId is required");
            };
            // Cancel flips the flag; the streaming thread observes it within
            // one poll interval and emits the terminal error event itself.
            match agent_service::cancel_run(&run_id) {
                Some(scenario) => {
                    let _ = app.emit(
                        "agent:runEvent",
                        json!({
                            "runId": run_id,
                            "scenario": scenario,
                            "event": {
                                "type": "error",
                                "message": "Agent run cancelled by user",
                                "code": "CANCELLED",
                            },
                        }),
                    );
                    ok(json!({ "cancelled": true }))
                }
                None => ok(json!({ "cancelled": false })),
            }
        }
        // DEV-121: hands the user's decision to the parked run thread. A
        // rejected response (unknown id, already decided, expired) returns
        // `accepted: false` so the renderer can surface the stale banner
        // instead of leaving the run waiting.
        "agent:approval:respond" => {
            let Some(approval_id) = string_field(payload, "approvalId") else {
                return error("AGENT_APPROVAL_ID_REQUIRED", "approvalId is required");
            };
            let Some(decision) = string_field(payload, "decision") else {
                return error("AGENT_APPROVAL_DECISION_REQUIRED", "decision is required");
            };
            let decision = match decision.as_str() {
                "approved" => agent_service::ApprovalDecision::Approved,
                "denied" => agent_service::ApprovalDecision::Denied,
                _ => {
                    return error(
                        "AGENT_APPROVAL_DECISION_INVALID",
                        "decision must be approved or denied",
                    )
                }
            };
            ok(json!({
                "accepted": agent_service::respond_approval(&approval_id, decision),
            }))
        }
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
        // DEV-099 / DEV-102：xmind 主题与布局结构持久化到 sidecar
        // （read-merge-write），xmind 字节保持规范纯净。
        "binary:mindmapTheme:set" | "binary:mindmapStructure:set" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            let Some(path) = string_field(payload, "path") else {
                return error("BINARY_PATH_REQUIRED", "path is required");
            };
            let (field, value) = if channel == "binary:mindmapTheme:set" {
                ("mindmapTheme", payload.get("theme").cloned())
            } else {
                ("mindmapStructure", payload.get("structure").cloned())
            };
            let Some(value) = value else {
                return error(
                    "BINARY_META_VALUE_REQUIRED",
                    &format!("{field} is required"),
                );
            };
            let mut metadata = vault_fs::read_metadata(&root, &path).unwrap_or_else(|| json!({}));
            if !metadata.is_object() {
                metadata = json!({});
            }
            metadata[field] = value;
            if let Err(io_error) = vault_fs::write_metadata(&root, &path, &metadata) {
                return error("BINARY_METADATA_WRITE_FAILED", &io_error.to_string());
            }
            // Sidecar writes must trigger auto-commit, otherwise untracked
            // metadata JSON blocks every future sync with WORKTREE_DIRTY.
            // Best-effort: a vault without git still persists the setting.
            if root.join(".git").exists() {
                let _ = git_service::record_auto_commit(&root, &format!("save mindmap {path}"), 0);
            }
            ok(json!({ "saved": true }))
        }
        "binary:editorTheme" => {
            let theme = match string_field(payload, "theme").as_deref() {
                Some("light") => "light",
                Some("dark") => "dark",
                _ => return error("BINARY_THEME_INVALID", "theme must be 'light' or 'dark'"),
            };
            *state.editor_theme.lock().expect("editor theme lock") = theme;
            // Editor windows are separate processes; broadcast so each host
            // page receives the theme without sharing renderer memory.
            binary_host_service::apply_theme(app, theme);
            ok(json!({ "applied": true }))
        }
        // DEV-123 二进制编辑器宿主：每文档一个 borderless 子窗口，覆盖主窗口
        // 内容区的占位矩形，激活才显示。
        "binary:host:open" | "binary:host:close" | "binary:host:flush" => {
            let (Some(kind), Some(path)) =
                (string_field(payload, "kind"), string_field(payload, "path"))
            else {
                return error("BINARY_HOST_INPUT", "kind and path are required");
            };
            match channel {
                "binary:host:open" => binary_host_service::open(app, &kind, &path),
                "binary:host:close" => binary_host_service::close(app, &kind, &path),
                _ => binary_host_service::flush(app, &kind, &path),
            }
        }
        "binary:host:flushAck" => {
            // The editor page confirms a flush token; the parked flush call
            // resolves from the ack instead of assuming success.
            let Some(token) = string_field(payload, "token") else {
                return error("BINARY_HOST_FLUSH_TOKEN", "token is required");
            };
            binary_host_service::flush_ack(
                app,
                sender,
                &token,
                payload.get("ok").and_then(Value::as_bool) == Some(true),
                string_field(payload, "message").as_deref(),
            )
        }
        "binary:host:setActive" => {
            // 缺省 payload = 切到非二进制 tab，收回全部宿主。
            binary_host_service::set_active(
                app,
                string_field(payload, "kind").as_deref(),
                string_field(payload, "path").as_deref(),
            )
        }
        "binary:host:setBounds" => {
            let (Some(kind), Some(path)) =
                (string_field(payload, "kind"), string_field(payload, "path"))
            else {
                return error("BINARY_HOST_INPUT", "kind and path are required");
            };
            let bounds = match payload.get("bounds") {
                None | Some(Value::Null) => None,
                Some(value) => {
                    let read = |key: &str| value.get(key).and_then(Value::as_f64);
                    match (read("x"), read("y"), read("width"), read("height")) {
                        (Some(x), Some(y), Some(width), Some(height)) => {
                            Some(binary_host_service::HostBounds {
                                x,
                                y,
                                width,
                                height,
                            })
                        }
                        _ => {
                            return error(
                                "BINARY_HOST_BOUNDS_INVALID",
                                "bounds must carry numeric x/y/width/height",
                            )
                        }
                    }
                }
            };
            binary_host_service::set_bounds(app, &kind, &path, bounds)
        }
        "binary:host:ready" => {
            // Editor windows do not share renderer memory, so the ready
            // response re-syncs the current UI language as its first command.
            let language = state
                .global_settings
                .lock()
                .expect("settings lock")
                .pointer("/appearance/language")
                .and_then(Value::as_str)
                .unwrap_or("zh-CN")
                .to_owned();
            // The ack carries no payload by contract, so the sending window
            // identifies the host — the Tauri equivalent of Electron's
            // senderId = webContents.id. Guessing "the first not-ready host"
            // mis-attributes commands when several editors boot at once.
            binary_host_service::ready(app, sender, &language)
        }
        "print:document" => {
            let Some(title) = string_field(payload, "title") else {
                return error("PRINT_TITLE_REQUIRED", "title is required");
            };
            let Some(html) = string_field(payload, "html") else {
                return error("PRINT_HTML_REQUIRED", "html is required");
            };
            let request = print_service::PrintDocumentRequest { title, html };
            match print_service::print_document(app, &request) {
                Ok(result) => match serde_json::to_value(result) {
                    Ok(value) => ok(value),
                    Err(e) => error("PRINT_SERIALIZE_FAILED", &e.to_string()),
                },
                Err(e) => error("PRINT_VALIDATION_FAILED", &e.to_string()),
            }
        }
        "docx:import" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            let Some(data_base64) = string_field(payload, "data") else {
                return error("DOCX_DATA_REQUIRED", "data (base64) is required");
            };
            let bytes = match base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                &data_base64,
            ) {
                Ok(b) => b,
                Err(e) => return error("DOCX_DECODE_FAILED", &e.to_string()),
            };
            let cursor = std::io::Cursor::new(&bytes[..]);
            let mut archive = match zip::ZipArchive::new(cursor) {
                Ok(a) => a,
                Err(e) => return error("DOCX_PARSE_FAILED", &e.to_string()),
            };
            let mut document_xml = String::new();
            match archive.by_name("word/document.xml") {
                Ok(mut entry) => {
                    use std::io::Read;
                    let _ = entry.read_to_string(&mut document_xml);
                }
                Err(e) => return error("DOCX_PARSE_FAILED", &format!("no word/document.xml: {e}")),
            }
            // Extract text between <w:t> tags
            let mut markdown = String::new();
            let mut remaining = document_xml.as_str();
            while let Some(start) = remaining.find("<w:t") {
                let text_start = match remaining[start..].find('>') {
                    Some(pos) => start + pos + 1,
                    None => break,
                };
                let text_end = match remaining[text_start..].find("</w:t>") {
                    Some(pos) => text_start + pos,
                    None => break,
                };
                let text = &remaining[text_start..text_end];
                if !text.is_empty() {
                    markdown.push_str(text);
                }
                remaining = &remaining[text_end + 6..];
            }
            let name = string_field(payload, "name")
                .map(|n| n.trim_end_matches(".docx").to_owned())
                .unwrap_or_else(|| "Imported".to_owned());
            let target_dir = string_field(payload, "targetDir").unwrap_or_default();
            let rel = if target_dir.is_empty() {
                format!("{name}.md")
            } else {
                format!("{target_dir}/{name}.md")
            };
            let target = root.join(&rel);
            if let Some(parent) = target.parent() {
                let _ = fs::create_dir_all(parent);
            }
            match fs::write(&target, &markdown) {
                Ok(()) => ok(json!({ "path": rel })),
                Err(e) => error("DOCX_IMPORT_FAILED", &e.to_string()),
            }
        }
        "docx:export" => {
            let Some(root) = vault_root.get() else {
                return error("NO_VAULT", "No vault is open");
            };
            let Some(path) = string_field(payload, "path") else {
                return error("DOCX_PATH_REQUIRED", "path is required");
            };
            let Ok(content) = fs::read_to_string(root.join(&path)) else {
                return error("DOCX_SOURCE_NOT_FOUND", "Source markdown not found");
            };
            let target_path = string_field(payload, "targetPath")
                .unwrap_or_else(|| path.trim_end_matches(".md").to_owned() + ".docx");
            let target = root.join(&target_path);
            if target.exists() {
                return error("DOCX_TARGET_EXISTS", "Target docx already exists");
            }
            let body_xml = content
                .lines()
                .map(|line| {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        return String::new();
                    }
                    if let Some(heading) = trimmed.strip_prefix("# ") {
                        format!("<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>{heading}</w:t></w:r></w:p>")
                    } else {
                        format!("<w:p><w:r><w:t>{line}</w:t></w:r></w:p>")
                    }
                })
                .collect::<String>();
            let document_xml = format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{body_xml}</w:body></w:document>"
            );
            use std::io::Write;
            let mut buf = Vec::new();
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let options = zip::write::SimpleFileOptions::default();
            let _ = zip.start_file("[Content_Types].xml", options);
            let _ = zip.write_all(br#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#);
            let _ = zip.start_file("_rels/.rels", options);
            let _ = zip.write_all(br#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#);
            let _ = zip.start_file("word/document.xml", options);
            let _ = zip.write_all(document_xml.as_bytes());
            let _ = zip.finish();
            match fs::write(&target, &buf) {
                Ok(()) => ok(json!({ "path": target_path })),
                Err(e) => error("DOCX_EXPORT_FAILED", &e.to_string()),
            }
        }
        channel if channel.starts_with("agent:run:") => {
            let scenario = channel.trim_start_matches("agent:run:").to_string();
            let run_id = uuid::Uuid::new_v4().to_string();
            // Skill retrieval runs before the run starts so the `context`
            // event carries exactly the sources the model will see (DEV-121).
            let skill_context_event = match agent_skill_context(app, embedding, vault_root, payload)
            {
                Ok(context) => context,
                Err(failure) => return failure,
            };
            if let Some(requested) = payload.get("skillIds").and_then(Value::as_array) {
                let used = skill_context_event
                    .as_ref()
                    .and_then(|response| response.get("usedSkillIds"))
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0);
                if !requested.is_empty() && used != requested.len() {
                    // An explicitly requested skill must never silently drop.
                    return error("SKILL_NOT_ALLOWED", "A requested skill is not available");
                }
            }
            let skill_context = skill_context_event
                .as_ref()
                .and_then(|response| response.get("contextText"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let context_text = [
                payload
                    .get("contextText")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                skill_context.as_str(),
            ]
            .into_iter()
            .filter(|part| !part.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
            // Scenario prompts are main-process owned: the renderer may send
            // context but never the model-facing instructions.
            let messages = match agent_scenario::build_messages(&scenario, payload, &context_text) {
                Ok(messages) => messages,
                Err(failure) => return error(failure.code, &failure.message),
            };

            // Resolve the chat-capable profile the same way ai:chat would:
            // the writing feature assignment wins over the default profile.
            let store = ai_store(app);
            let ai_state = store.get_state();
            let chat_profile_id = ai_state
                .features
                .writing
                .as_ref()
                .map(|assignment| assignment.profile_id.clone())
                .or_else(|| ai_state.default_profile_id.clone());
            let Some(chat_profile_id) = chat_profile_id else {
                return error(
                    "AI_CHAT_NOT_CONFIGURED",
                    "No AI profile is configured for agent runs",
                );
            };
            let Some(profile) = ai_state
                .profiles
                .iter()
                .find(|profile| profile.id == chat_profile_id)
            else {
                return error(
                    "AI_PROFILE_NOT_FOUND",
                    &format!("AI profile not found: {chat_profile_id}"),
                );
            };
            if profile.kind == ai_service::AiProviderKind::LocalEmbedding {
                return error(
                    "AI_PROFILE_CHAT_INCAPABLE",
                    "A local embedding profile cannot run agent scenarios",
                );
            }
            let model = ai_state
                .features
                .writing
                .as_ref()
                .map(|assignment| assignment.model.clone())
                .unwrap_or_else(|| profile.default_model.clone());
            let base_url = profile.base_url.clone();
            drop(store);

            // Agent runs stream through events; the IPC call itself returns as
            // soon as the run id exists, matching the Electron contract.
            let app_handle = app.clone();
            let run_id_for_response = run_id.clone();
            let api_key = ai_service::read_credential(&profile.id);
            // DEV-121: the chat dock owns tool permission; non-chat scenarios
            // are pinned to conversation mode by the registry itself.
            let permission_mode = payload
                .get("permissionMode")
                .and_then(Value::as_str)
                .and_then(|mode| agent_service::PermissionMode::parse(mode, &scenario));
            let context_paths = payload
                .get("contextPaths")
                .and_then(Value::as_array)
                .map(|paths| {
                    paths
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToOwned::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            let run_handle = agent_service::register_run_with_options(
                &run_id,
                &scenario,
                agent_service::RunOptions {
                    permission_mode,
                    context_paths,
                },
            );
            // Announce the retrieval provenance before streaming so the chat
            // dock can label the turn's sources while the model is still
            // producing text.
            if let Some(context) = &skill_context_event {
                emit_agent_event(
                    app,
                    &run_id,
                    &scenario,
                    json!({
                        "type": "context",
                        "sources": context.get("sources").cloned().unwrap_or(json!([])),
                        "degraded": context
                            .get("degraded")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        "retrievalModel": context
                            .get("retrievalModel")
                            .cloned()
                            .unwrap_or(Value::Null),
                    }),
                );
            }
            std::thread::spawn(move || {
                let vault_state = app_handle.state::<VaultRoot>();
                let embedding_state = app_handle
                    .state::<std::sync::Arc<embedding_service::EmbeddingState>>()
                    .inner()
                    .clone();
                let mut conversation = messages;
                let result = run_agent_turn(
                    &AgentRunContext {
                        app: &app_handle,
                        embedding: &embedding_state,
                        vault_root: &vault_state,
                        scenario: &scenario,
                        run_id: &run_id,
                        run_handle: &run_handle,
                    },
                    &base_url,
                    api_key.as_deref(),
                    &model,
                    &mut conversation,
                );
                agent_service::finish_run(&run_id);
                // On cancellation `agent:cancel` already emitted the terminal
                // error event, so only provider failures need reporting here.
                if let Err(error) = result {
                    emit_agent_event(
                        &app_handle,
                        &run_id,
                        &scenario,
                        json!({
                            "type": "error",
                            "message": error.as_str(),
                            "code": if error == "TOOL_ROUND_LIMIT_EXCEEDED" {
                                "TOOL_ROUND_LIMIT_EXCEEDED"
                            } else {
                                "AGENT_STREAM_FAILED"
                            },
                        }),
                    );
                }
            });
            ok(json!({ "runId": run_id_for_response }))
        }
        _ => error(
            "UNSUPPORTED_CHANNEL",
            "This product command is not ported to Rust yet",
        ),
    }
}

/// DEV-121: one provider turn that may call agent tools. Drives the
/// approve → execute → replay loop so the model sees tool results and
/// continues in the same run.
struct AgentToolCall {
    id: String,
    tool: String,
    input: Value,
    arguments: String,
}

/// Full mode still refuses shell/delete/rename/config-style writes; the same
/// word list the Electron gateway matches against `name + JSON(input)`.
fn tool_input_forbidden(tool: &str, input: &Value) -> bool {
    let haystack = format!("{tool} {input}").to_lowercase();
    [
        "shell", "command", "delete", "remove", "rename", "config", "setting", "vault",
    ]
    .iter()
    .any(|needle| haystack.contains(needle))
}

fn emit_agent_event<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    run_id: &str,
    scenario: &str,
    event: Value,
) {
    let _ = app.emit(
        "agent:runEvent",
        json!({ "runId": run_id, "scenario": scenario, "event": event }),
    );
}

/// Desensitized tool result summary: structure counts only, never content.
fn summarize_tool_result(result: &Value) -> Option<String> {
    for key in ["sources", "pages", "items", "results"] {
        if let Some(count) = result.get(key).and_then(Value::as_array).map(Vec::len) {
            return Some(format!("{count} {key}"));
        }
    }
    None
}

/// Resolves the active embedder for agent-triggered retrieval (ADR-0027).
fn agent_embedder<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    embedding: &std::sync::Arc<embedding_service::EmbeddingState>,
) -> Option<retrieval_service::Embedder> {
    let store = ai_store(app);
    match embedding_source(&store) {
        Ok((profile, _)) if profile.kind == ai_service::AiProviderKind::LocalEmbedding => {
            Some(retrieval_service::Embedder::BuiltIn {
                state: embedding.clone(),
                profile_id: profile.id,
            })
        }
        Ok((profile, model)) => Some(retrieval_service::Embedder::Remote {
            base_url: profile.base_url,
            model,
            profile_id: profile.id,
        }),
        // No embedding configuration degrades retrieval; it is not an error.
        Err(_) => None,
    }
}

/// Everything one agent run needs to stream, gate, and execute tools. Bundled
/// into a struct so the tool-loop helpers stay readable.
struct AgentRunContext<'a, R: tauri::Runtime> {
    app: &'a tauri::AppHandle<R>,
    embedding: &'a std::sync::Arc<embedding_service::EmbeddingState>,
    vault_root: &'a tauri::State<'a, VaultRoot>,
    scenario: &'a str,
    run_id: &'a str,
    run_handle: &'a agent_service::RunHandle,
}

/// Runs one agent turn to completion, including up to `MAX_TOOL_ROUNDS`
/// tool rounds. Returns `Err` only for provider/transport failures; a denied
/// or failed tool call becomes a tool message so the model can recover.
fn run_agent_turn<R: tauri::Runtime>(
    context: &AgentRunContext<'_, R>,
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages: &mut Vec<Value>,
) -> Result<(), String> {
    let AgentRunContext {
        app,
        scenario,
        run_id,
        run_handle,
        ..
    } = context;
    /// Provider tool rounds are bounded so a misbehaving model cannot loop.
    const MAX_TOOL_ROUNDS: usize = 5;
    let tools = agent_tools::provider_tools(scenario);
    let is_cancelled = || run_handle.is_cancelled();
    for _ in 0..MAX_TOOL_ROUNDS {
        let mut tool_calls: Vec<AgentToolCall> = Vec::new();
        let mut on_event = |event: ai_service::ChatSseEvent| match event {
            ai_service::ChatSseEvent::Start { model } => {
                emit_agent_event(
                    app,
                    run_id,
                    scenario,
                    json!({ "type": "start", "model": model }),
                );
            }
            ai_service::ChatSseEvent::Delta { text } => {
                emit_agent_event(
                    app,
                    run_id,
                    scenario,
                    json!({ "type": "delta", "text": text }),
                );
            }
            ai_service::ChatSseEvent::ToolCall {
                id,
                tool,
                input,
                arguments,
            } => tool_calls.push(AgentToolCall {
                id,
                tool,
                input,
                arguments,
            }),
            // `done` is emitted once the whole run finishes, after the final
            // tool round; emitting per turn would end the stream early.
            ai_service::ChatSseEvent::Done => {}
            ai_service::ChatSseEvent::Error { message, code } => {
                emit_agent_event(
                    app,
                    run_id,
                    scenario,
                    json!({ "type": "error", "message": message, "code": code }),
                );
            }
        };
        let outcome = ai_service::stream_chat_cancellable_with_tools(
            base_url,
            api_key,
            model,
            messages,
            &tools,
            &mut on_event,
            &is_cancelled,
        );
        let assistant_text = match outcome {
            Ok(ai_service::ChatStreamOutcome::Cancelled) => {
                // `agent:cancel` already emitted the terminal error event.
                return Ok(());
            }
            Ok(ai_service::ChatStreamOutcome::Completed(text)) => text,
            Err(error) => return Err(error),
        };
        if tool_calls.is_empty() {
            emit_agent_event(app, run_id, scenario, json!({ "type": "done" }));
            return Ok(());
        }
        // Replay the assistant turn verbatim so providers can match the tool
        // results to the calls that produced them.
        messages.push(json!({
            "role": "assistant",
            "content": if assistant_text.is_empty() { Value::Null } else { json!(assistant_text) },
            "tool_calls": tool_calls
                .iter()
                .map(|call| json!({
                    "id": call.id,
                    "type": "function",
                    "function": { "name": call.tool, "arguments": call.arguments },
                }))
                .collect::<Vec<Value>>(),
        }));
        for call in tool_calls {
            if run_handle.is_cancelled() {
                return Ok(());
            }
            let outcome = execute_agent_tool(context, &call);
            let (content, summary, status) = match outcome {
                Ok(value) => (
                    serde_json::to_string(&value).unwrap_or_else(|_| "null".to_owned()),
                    summarize_tool_result(&value),
                    "completed",
                ),
                Err(error) => (
                    json!({ "error": { "code": error.code, "message": error.message } })
                        .to_string(),
                    None,
                    "failed",
                ),
            };
            emit_agent_event(
                app,
                run_id,
                scenario,
                json!({
                    "type": "tool",
                    "tool": call.tool.as_str(),
                    "status": status,
                    "summary": summary,
                }),
            );
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call.id,
                "name": call.tool,
                "content": content,
            }));
        }
    }
    Err("TOOL_ROUND_LIMIT_EXCEEDED".to_owned())
}

/// One tool call: policy gate → optional approval → execution.
fn execute_agent_tool<R: tauri::Runtime>(
    context: &AgentRunContext<'_, R>,
    call: &AgentToolCall,
) -> Result<Value, agent_tools::ToolError> {
    let AgentRunContext {
        app,
        embedding,
        vault_root,
        scenario,
        run_id,
        ..
    } = context;
    let approved = authorize_agent_tool(context, call)?;
    let Some(root) = vault_root.get() else {
        return Err(agent_tools::ToolError::new("NO_VAULT", "No vault is open"));
    };
    emit_agent_event(
        app,
        run_id,
        scenario,
        json!({ "type": "tool", "tool": call.tool.as_str(), "status": "started" }),
    );
    let retrieve = |query: &str, top_k: Option<usize>| {
        let embedder = agent_embedder(app, embedding);
        let request = retrieval_service::RetrievalRequest {
            query: query.to_owned(),
            top_k: top_k.unwrap_or(8),
            fts_limit: 20,
            budget_chars: 4000,
            confidence_weight: 0.3,
            disable_vector: false,
        };
        retrieval_service::retrieve(&root, &request, embedder.as_ref())
    };
    let deps = agent_tools::ToolDeps {
        root: &root,
        retrieve: &retrieve,
    };
    agent_tools::execute(&deps, &call.tool, &call.input, approved)
}

/// Decides whether one tool call may execute, parking an approval banner when
/// the policy requires it (DEV-121).
fn authorize_agent_tool<R: tauri::Runtime>(
    context: &AgentRunContext<'_, R>,
    call: &AgentToolCall,
) -> Result<bool, agent_tools::ToolError> {
    let AgentRunContext {
        app,
        scenario,
        run_id,
        run_handle,
        ..
    } = context;
    let allowed = agent_tools::allowed_tools(scenario);
    let Some(definition) = allowed.iter().find(|def| def.name == call.tool) else {
        return Err(agent_tools::ToolError::new(
            "TOOL_NOT_ALLOWED",
            format!("Tool not allowed in {scenario}: {}", call.tool),
        ));
    };
    let policy = agent_service::run_policy(run_id);
    let permission_mode = policy
        .as_ref()
        .map(|policy| policy.permission_mode)
        .unwrap_or(agent_service::PermissionMode::Conversation);
    let context_paths = policy
        .as_ref()
        .map(|policy| policy.context_paths.clone())
        .unwrap_or_default();
    // Read tools never need a banner; write tools do unless full mode applies.
    if definition.access != agent_tools::ToolAccess::Write && !definition.requires_approval {
        return Ok(false);
    }
    // git_doctor_repair runs even in conversation mode but always needs an
    // explicit approval: the user must see which repair action is about to run.
    let doctor_repair = call.tool == "git_doctor_repair";
    if !doctor_repair && permission_mode == agent_service::PermissionMode::Conversation {
        emit_agent_event(
            app,
            run_id,
            scenario,
            json!({
                "type": "tool",
                "tool": call.tool.as_str(),
                "status": "denied",
                "summary": "Write requires edit mode",
            }),
        );
        return Err(agent_tools::ToolError::new(
            "WRITE_REQUIRES_EDIT_MODE",
            "Writes require edit or full permission mode",
        ));
    }
    if !definition.requires_approval && !doctor_repair {
        // A write-capable tool that declares no approval requirement still has
        // to respect conversation mode.
        return Ok(false);
    }
    if permission_mode == agent_service::PermissionMode::Full && !doctor_repair {
        // Full mode skips approval but not the five guardrails.
        let target = call.input.get("path").and_then(Value::as_str);
        let in_scope = target.is_none_or(|target| {
            !context_paths.is_empty()
                && context_paths
                    .iter()
                    .any(|path| target == path || target.starts_with(&format!("{path}/")))
        });
        if tool_input_forbidden(&call.tool, &call.input) || !in_scope {
            emit_agent_event(
                app,
                run_id,
                scenario,
                json!({
                    "type": "tool",
                    "tool": call.tool.as_str(),
                    "status": "denied",
                    "summary": "Out of scope for full mode",
                }),
            );
            return Err(agent_tools::ToolError::new(
                "FULL_MODE_SCOPE_DENIED",
                "Full mode only allows writes inside the active document scope",
            ));
        }
        return Ok(false);
    }
    let Some(ticket) = agent_service::request_approval(run_id, &call.tool) else {
        return Err(agent_tools::ToolError::new(
            "RUN_NOT_ACTIVE",
            "Agent run is no longer active",
        ));
    };
    let mut event = json!({
        "type": "approvalRequired",
        "approvalId": ticket.approval_id,
        "tool": call.tool.as_str(),
        "expiresAt": ticket.expires_at,
    });
    if doctor_repair {
        if let Some(action) = call.input.get("action").and_then(Value::as_str) {
            event["summary"] = json!(format!("Git Doctor 修复：{action}"));
        }
    }
    emit_agent_event(app, run_id, scenario, event);
    let _ = run_handle;
    match agent_service::wait_approval(&ticket.approval_id, &call.tool, run_id) {
        Ok(agent_service::ApprovalDecision::Approved) => Ok(true),
        Ok(agent_service::ApprovalDecision::Denied) => {
            emit_agent_event(
                app,
                run_id,
                scenario,
                json!({ "type": "tool", "tool": call.tool.as_str(), "status": "denied" }),
            );
            Err(agent_tools::ToolError::new(
                "APPROVAL_DENIED",
                "User denied the tool approval",
            ))
        }
        Err(_) => Err(agent_tools::ToolError::new(
            "APPROVAL_EXPIRED",
            "Approval expired before the user responded",
        )),
    }
}

pub fn sync_vault_root<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    root: &Path,
    state: &VaultRoot,
) -> Result<(), Value> {
    if !root.join(".nexnote/config.json").is_file() {
        return Err(json!({
            "ok": false,
            "code": "NOT_A_VAULT",
            "error": "The selected directory has no NexNote config"
        }));
    }
    *state.root.lock().expect("vault root lock") = Some(root.to_path_buf());
    index_service::rebuild(root);
    // DEV-119: external and app writes now stream to the renderer as
    // `fs:changed` and drive incremental indexing.
    watcher_service::start(app, root);
    Ok(())
}

pub fn close_vault_root(state: &VaultRoot) {
    watcher_service::stop();
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
    fn cross_skill_merge_normalizes_dedups_and_sorts() {
        let run_a = (
            "skill-a".to_owned(),
            vec![
                json!({ "path": "doc.md", "blockId": null, "title": "Doc", "snippet": "text", "score": 4.0, "via": "fts" }),
                json!({ "path": "other.md", "blockId": null, "title": "Other", "snippet": "text", "score": 2.0, "via": "fts" }),
            ],
            false,
        );
        // Same scale range but higher absolute; the overlap doc hits both.
        let run_b = (
            "skill-b".to_owned(),
            vec![
                json!({ "path": "doc.md", "blockId": null, "title": "Doc", "snippet": "text", "score": 400.0, "via": "fts" }),
                json!({ "path": "third.md", "blockId": null, "title": "Third", "snippet": "text", "score": 200.0, "via": "fts" }),
            ],
            false,
        );
        let merged = merge_skill_results(&[run_a, run_b]);

        // Three unique sources (doc, other, third) after dedup.
        assert_eq!(merged.len(), 3, "overlapping sources dedup: {merged:?}");

        // doc.md is hit by both skills with normalized score 1.0 and carries
        // provenance for every matcher.
        assert_eq!(merged[0]["path"], "doc.md");
        let skill_ids: Vec<&str> = merged[0]["skillIds"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .collect();
        assert!(skill_ids.contains(&"skill-a"));
        assert!(skill_ids.contains(&"skill-b"));
        assert_eq!(
            merged[0]["score"],
            json!(400.0),
            "raw score is the max across skills"
        );
    }

    /// Builds a mock app with every state type `dispatch` needs, so tests can
    /// drive the real match without a window.
    fn dispatch_harness() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        let data = std::env::temp_dir().join(format!(
            "nexnote-dispatch-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::create_dir_all(&data);
        app.manage(ProductState::default());
        app.manage(std::sync::Arc::new(embedding_service::EmbeddingState::new(
            &data,
        )));
        app.manage(PluginState::new(data.join("plugins"), "0.0.37"));
        app.manage(VaultRoot::default());
        app
    }

    /// Locks dispatch reachability: these channels must match a real arm, not
    /// fall into the catch-all. An inner arm without an outer-list entry (the
    /// `document:getMetadata` bug) silently degrades to UNSUPPORTED_CHANNEL —
    /// this test catches exactly that class.
    #[test]
    fn wired_channels_are_reachable_through_dispatch() {
        let app = dispatch_harness();
        let handle = app.handle();
        let state = app.state::<ProductState>();
        let embedding = app.state::<std::sync::Arc<embedding_service::EmbeddingState>>();
        let plugins = app.state::<PluginState>();
        let vault = app.state::<VaultRoot>();

        for channel in [
            // The regression: inner arm existed, outer list entry was missing.
            "document:getMetadata",
            // Sampling each namespace that requires a vault (error = NO_VAULT).
            "fs:readTextFile",
            "fs:stat",
            "git:getStatus",
            // State-only channels that work without a vault.
            "settings:getAll",
            "ai:getState",
        ] {
            let response = dispatch(
                handle,
                None,
                &state,
                &embedding,
                &plugins,
                &vault,
                channel,
                &json!({}),
            );
            assert_ne!(
                response.get("code").and_then(Value::as_str),
                Some("UNSUPPORTED_CHANNEL"),
                "{channel} is wired in an inner arm but missing from the outer match list"
            );
        }
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
