//! DEV-121 AI service foundation.
//!
//! This module keeps the first Tauri-side slice intentionally small:
//!
//! * a durable [`AiStore`] for the renderer-visible AI configuration contract;
//! * an OpenAI-compatible JSON client for model discovery and embeddings;
//! * stable embedding generation identity.
//!
//! Credential handling is deliberately fail-closed in this slice.  A profile can
//! remember that a credential exists, but no key material is written to JSON or
//! included in exported bundles.  A later slice must replace the placeholder
//! with the OS credential vault before network profiles are advertised as
//! fully configured.

#![allow(dead_code)]

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// Default distance metric when an embedding assignment does not name one.
const DEFAULT_EMBEDDING_METRIC: &str = "cosine";
/// Marker used instead of an unknown embedding dimension in a fingerprint.
const AUTO_DIMENSION: &str = "auto";
/// Placeholder credential account stored until the OS credential vault lands.
/// Keyring service name; the account is the profile id.
const CREDENTIAL_SERVICE: &str = "NexNote AI";

/// Stores an opaque credential in the OS credential vault.
pub fn store_credential(profile_id: &str, secret: &str) -> Result<(), String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, profile_id)
        .and_then(|entry| entry.set_password(secret))
        .map_err(|error| format!("Failed to store the credential: {error}"))
}

/// Reads a stored credential; a missing entry is `None`, not an error, so
/// headless environments degrade instead of failing every call.
pub fn read_credential(profile_id: &str) -> Option<String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, profile_id)
        .ok()
        .and_then(|entry| entry.get_password().ok())
}

pub fn delete_credential(profile_id: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(CREDENTIAL_SERVICE, profile_id)
        .map_err(|error| format!("Failed to open the credential entry: {error}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to delete the credential: {error}")),
    }
}

/// Marker stored in `credential_account` once a keychain entry exists.
fn credential_marker(profile_id: &str) -> String {
    format!("{CREDENTIAL_SERVICE}:{profile_id}")
}

/// Extracts the profile id back from a credential marker.
pub fn profile_id_from_marker(marker: &str) -> Option<&str> {
    marker.strip_prefix(CREDENTIAL_SERVICE)?.strip_prefix(':')
}

/// Provider transport family, matching the shared TypeScript union.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiProviderKind {
    #[default]
    /// Any OpenAI-compatible HTTP endpoint using bearer authentication.
    OpenaiCompatible,
    /// Azure OpenAI deployment transport.
    AzureOpenai,
    /// Built-in local embedding provider.
    LocalEmbedding,
}

/// Supported distance metric for embedding vectors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EmbeddingMetric {
    Cosine,
    DotProduct,
    Euclidean,
}

/// Feature identifiers accepted by [`AiStore::set_feature`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiFeatureKey {
    Writing,
    Translation,
    Chat,
    Embedding,
}

impl AiFeatureKey {
    /// Parses the camelCase wire value used by IPC.
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "writing" => Ok(Self::Writing),
            "translation" => Ok(Self::Translation),
            "chat" => Ok(Self::Chat),
            "embedding" => Ok(Self::Embedding),
            _ => Err(format!("unknown AI feature: {value}")),
        }
    }
}

/// Provider-neutral sampling parameters.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
}

/// Renderer-visible profile. No credential bytes are serialized.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProfileView {
    pub id: String,
    pub name: String,
    pub kind: AiProviderKind,
    pub base_url: String,
    pub default_model: String,
    #[serde(default)]
    pub params: ChatParams,
    pub has_api_key: bool,
    pub key_storage: String,
    pub created_at: u64,
    pub updated_at: u64,

    /// In-memory only placeholder until native secret storage is wired.
    #[serde(skip)]
    pub credential_account: Option<String>,
}

/// Profile creation/update input. `credential_token` is an opaque one-shot
/// submission marker, not secret material.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProfileInput {
    /// Update target; absent means create. This is a Rust transport extension
    /// and is omitted when absent, so the TS input shape remains compatible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub kind: AiProviderKind,
    pub base_url: String,
    pub default_model: String,
    #[serde(default)]
    pub params: Option<ChatParams>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clear_credential: Option<bool>,
}

/// A profile/model pair assigned to one AI feature.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiFeatureAssignment {
    pub profile_id: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dimensions: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metric: Option<EmbeddingMetric>,
}

/// Per-feature assignments. Missing legacy translation state follows writing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiFeatureAssignments {
    pub writing: Option<AiFeatureAssignment>,
    #[serde(default)]
    pub translation: Option<Option<AiFeatureAssignment>>,
    pub chat: Option<AiFeatureAssignment>,
    pub embedding: Option<AiFeatureAssignment>,
}

impl Default for AiFeatureAssignments {
    fn default() -> Self {
        Self {
            writing: None,
            // `None` at the outer layer means legacy state: follow writing.
            translation: Some(None),
            chat: None,
            embedding: None,
        }
    }
}

impl AiFeatureAssignments {
    /// Effective translation assignment, following writing for legacy state.
    fn effective_translation(&self) -> Option<&AiFeatureAssignment> {
        match &self.translation {
            Some(assignment) => assignment.as_ref(),
            None => self.writing.as_ref(),
        }
    }

    /// Returns a serializable clone where legacy translation is normalized.
    fn normalized(&self) -> Self {
        let translation = Some(self.effective_translation().cloned());
        Self {
            writing: self.writing.clone(),
            translation,
            chat: self.chat.clone(),
            embedding: self.embedding.clone(),
        }
    }
}

/// Full renderer-visible AI state. This is also the persisted JSON shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigState {
    pub profiles: Vec<AiProfileView>,
    pub default_profile_id: Option<String>,
    pub features: AiFeatureAssignments,
    #[serde(default)]
    pub translation_target_language: String,
    pub needs_onboarding: bool,
    pub setup_prompt_dismissed: bool,
    pub embedding_fingerprint: Option<String>,
    pub embedding_generation: u64,
}

impl Default for AiConfigState {
    fn default() -> Self {
        Self {
            profiles: Vec::new(),
            default_profile_id: None,
            features: AiFeatureAssignments::default(),
            translation_target_language: String::new(),
            needs_onboarding: true,
            setup_prompt_dismissed: false,
            embedding_fingerprint: None,
            embedding_generation: 0,
        }
    }
}

/// Capability probe result, matching the shared TS contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub chat: bool,
    pub streaming: bool,
    pub embeddings: bool,
    pub tools: bool,
}

/// Connection probe result. Provider response bodies are never copied into
/// `error`, preventing accidental credential or prompt leakage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub reachable: bool,
    pub capabilities: ProviderCapabilities,
    pub models: Vec<String>,
    pub latency_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Embedding request result; vectors remain in input order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedResult {
    pub vectors: Vec<Vec<f64>>,
    pub dimensions: u32,
    pub model: String,
    pub profile_id: String,
}

/// A minimal HTTP response with the status code and decoded body.
#[derive(Debug, Clone, PartialEq, Eq)]
struct HttpResponse {
    status: u16,
    body: Vec<u8>,
}

/// Parsed `http://` origin used by the local-only HTTP client.
#[derive(Debug, Clone, PartialEq, Eq)]
struct HttpOrigin {
    host: String,
    port: u16,
    path_prefix: String,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

/// Formats a current UTC timestamp as RFC 3339 without an extra dependency.
fn now_rfc3339() -> String {
    let milliseconds = now_millis();
    let seconds = (milliseconds / 1000) as i64;
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    };
    if month <= 2 {
        year += 1;
    }
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{}Z",
        milliseconds % 1000
    )
}

/// Generates a process-unique identifier without adding a UUID dependency.
fn new_profile_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let random = RandomState::new().build_hasher().finish();
    format!("ai-{}-{}-{:016x}", now_millis(), counter, random)
}

/// Builds the embedding generation identity.
///
/// The four fields are identity-bearing: changing any one of them invalidates
/// previously produced vectors and therefore requires an index rebuild.
pub fn embedding_fingerprint(
    profile_id: &str,
    model: &str,
    dimensions: u64,
    metric: &str,
) -> String {
    format!("{profile_id}:{model}:{dimensions}:{metric}")
}

/// Computes a fingerprint from an assignment, using `auto` for unprobed
/// dimensions and `cosine` when the assignment omits a metric.
fn assignment_fingerprint(assignment: &AiFeatureAssignment) -> String {
    let dimensions = assignment
        .dimensions
        .map_or_else(|| AUTO_DIMENSION.to_string(), |value| value.to_string());
    let metric = assignment
        .metric
        .map_or_else(|| DEFAULT_EMBEDDING_METRIC.to_string(), serde_plain);
    format!(
        "{}:{}:{}:{}",
        assignment.profile_id, assignment.model, dimensions, metric
    )
}

/// Converts the metric enum to its camelCase wire representation.
fn serde_plain(metric: EmbeddingMetric) -> String {
    match metric {
        EmbeddingMetric::Cosine => "cosine".to_string(),
        EmbeddingMetric::DotProduct => "dotProduct".to_string(),
        EmbeddingMetric::Euclidean => "euclidean".to_string(),
    }
}

/// Durable AI configuration store with atomic JSON persistence.
///
/// The file is the source of truth. Mutations update the guarded state, persist
/// it before returning, and return errors rather than leaving memory and disk
/// intentionally divergent.
pub struct AiStore {
    data: Mutex<AiConfigState>,
    path: PathBuf,
}

impl AiStore {
    /// Loads an existing store, or creates and saves default state.
    ///
    /// Corrupt, partial, or unreadable files fail closed to default state; the
    /// next mutation atomically replaces the bad file. This mirrors the
    /// Electron store and avoids blocking first launch on one bad JSON file.
    pub fn new(path: PathBuf) -> Self {
        let state = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<AiConfigState>(&raw).ok())
            .map(normalize_state)
            .unwrap_or_default();
        let store = Self {
            data: Mutex::new(state),
            path,
        };
        if let Err(error) = store.persist() {
            // A read-only app data directory should surface on the first write
            // rather than being hidden behind a constructor panic.
            eprintln!("[ai-store] initial persistence failed: {error}");
        }
        store
    }

    /// Returns a snapshot of renderer-visible configuration state.
    pub fn get_state(&self) -> AiConfigState {
        let mut state = self.lock().clone();
        state.features = state.features.normalized();
        state.needs_onboarding = state.profiles.is_empty();
        state
    }

    /// Creates or updates a profile and returns its stable ID.
    pub fn save_profile(&self, profile: &AiProfileInput) -> Result<String, String> {
        let mut state = self.lock();
        let update_id = profile.id.as_deref();
        let existing_index = update_id.map_or_else(
            || None,
            |id| state.profiles.iter().position(|item| item.id == id),
        );
        if let Some(id) = update_id {
            if existing_index.is_none() {
                return Err(format!("AI profile not found: {id}"));
            }
        }

        let name = profile.name.trim();
        let default_model = profile.default_model.trim();
        let base_url = profile.base_url.trim();
        if name.is_empty() {
            return Err("AI profile name must not be empty".to_string());
        }
        if default_model.is_empty() {
            return Err("AI default model must not be empty".to_string());
        }
        validate_profile_base_url(profile.kind, base_url)?;
        let has_credential_input = profile.credential_token.is_some();
        if profile.kind == AiProviderKind::LocalEmbedding && has_credential_input {
            return Err("local embedding profiles must not have an API key".to_string());
        }

        let now = now_millis();
        let params = profile.params.clone().unwrap_or_default();
        let (id, created_at, old_credential) = match existing_index {
            Some(index) => {
                let old = &state.profiles[index];
                (
                    old.id.clone(),
                    old.created_at,
                    old.credential_account.clone(),
                )
            }
            None => (new_profile_id(), now, None),
        };

        let credential_account = if profile.kind == AiProviderKind::LocalEmbedding {
            None
        } else if profile.clear_credential == Some(true) {
            // Remove the OS-vault entry; already-gone is fine (idempotent).
            let _ = delete_credential(&id);
            None
        } else if let Some(secret) = profile.credential_token.as_deref() {
            // Store first; failure aborts the whole save so the config file
            // and the OS vault can never disagree about a credential.
            store_credential(&id, secret)?;
            Some(credential_marker(&id))
        } else {
            old_credential
        };

        let normalized_base_url = if profile.kind == AiProviderKind::LocalEmbedding {
            base_url.to_string()
        } else {
            base_url.trim_end_matches('/').to_string()
        };
        let saved = AiProfileView {
            id: id.clone(),
            name: name.to_string(),
            kind: profile.kind,
            base_url: normalized_base_url,
            default_model: default_model.to_string(),
            params,
            has_api_key: credential_account.is_some(),
            key_storage: "system-credential".to_string(),
            created_at,
            updated_at: now,
            credential_account,
        };

        let default_was_empty_or_invalid = state
            .default_profile_id
            .as_ref()
            .and_then(|default_id| {
                state
                    .profiles
                    .iter()
                    .find(|profile| profile.id == *default_id)
            })
            .is_none_or(|profile| profile.kind == AiProviderKind::LocalEmbedding);
        let first_chat_capable = !state
            .profiles
            .iter()
            .any(|profile| profile.kind != AiProviderKind::LocalEmbedding);
        match existing_index {
            Some(index) => state.profiles[index] = saved,
            None => state.profiles.push(saved),
        }

        if profile.kind != AiProviderKind::LocalEmbedding
            && (first_chat_capable || default_was_empty_or_invalid)
        {
            state.default_profile_id = Some(id.clone());
        } else {
            let default_valid = state
                .default_profile_id
                .as_ref()
                .and_then(|default_id| {
                    state
                        .profiles
                        .iter()
                        .find(|profile| profile.id == *default_id)
                })
                .is_some_and(|profile| profile.kind != AiProviderKind::LocalEmbedding);
            if !default_valid {
                state.default_profile_id = state
                    .profiles
                    .iter()
                    .find(|profile| profile.kind != AiProviderKind::LocalEmbedding)
                    .map(|profile| profile.id.clone());
            }
        }
        refresh_embedding_fingerprint(&mut state);
        persist_state(&self.path, &state)?;
        Ok(id)
    }

    /// Deletes a profile and clears assignments/default references.
    pub fn delete_profile(&self, id: &str) -> Result<AiConfigState, String> {
        let mut state = self.lock();
        let stored_credential = state
            .profiles
            .iter()
            .find(|profile| profile.id == id)
            .is_some_and(|profile| profile.has_api_key);
        let before = state.profiles.len();
        state.profiles.retain(|profile| profile.id != id);
        if state.profiles.len() == before {
            return Err(format!("AI profile not found: {id}"));
        }
        clear_feature_references(&mut state, id);
        if state.default_profile_id.as_deref() == Some(id) {
            state.default_profile_id = state
                .profiles
                .iter()
                .find(|profile| profile.kind != AiProviderKind::LocalEmbedding)
                .map(|profile| profile.id.clone());
        }
        refresh_embedding_fingerprint(&mut state);
        persist_state(&self.path, &state)?;
        // Delete the OS-vault entry only after the config write succeeded;
        // an unreachable leftover key is harmless, a missing one is not.
        if stored_credential {
            delete_credential(id)?;
        }
        Ok(self.get_state_unlocked(&state))
    }

    /// Sets the global default profile. Built-in embedding is chat-incapable.
    pub fn set_default_profile(&self, id: &str) -> Result<AiConfigState, String> {
        let mut state = self.lock();
        let profile = state
            .profiles
            .iter()
            .find(|profile| profile.id == id)
            .ok_or_else(|| format!("AI profile not found: {id}"))?;
        if profile.kind == AiProviderKind::LocalEmbedding {
            return Err("local embedding profile cannot be the default chat profile".to_string());
        }
        state.default_profile_id = Some(id.to_string());
        refresh_embedding_fingerprint(&mut state);
        persist_state(&self.path, &state)?;
        Ok(self.get_state_unlocked(&state))
    }

    /// Sets or clears a feature assignment.
    pub fn set_feature(
        &self,
        feature: &str,
        assignment: Option<AiFeatureAssignment>,
    ) -> Result<AiConfigState, String> {
        let key = AiFeatureKey::parse(feature)?;
        let mut state = self.lock();
        if let Some(assignment) = &assignment {
            if !state
                .profiles
                .iter()
                .any(|profile| profile.id == assignment.profile_id)
            {
                return Err(format!("AI profile not found: {}", assignment.profile_id));
            }
            if assignment.model.trim().is_empty() {
                return Err("AI feature model must not be empty".to_string());
            }
        }
        match key {
            AiFeatureKey::Writing => state.features.writing = assignment,
            AiFeatureKey::Translation => state.features.translation = Some(assignment),
            AiFeatureKey::Chat => state.features.chat = assignment,
            AiFeatureKey::Embedding => state.features.embedding = assignment,
        }
        refresh_embedding_fingerprint(&mut state);
        persist_state(&self.path, &state)?;
        Ok(self.get_state_unlocked(&state))
    }

    /// Sets the global translation target language.
    pub fn set_translation_target_language(&self, lang: &str) -> Result<AiConfigState, String> {
        let mut state = self.lock();
        state.translation_target_language = lang.trim().to_string();
        persist_state(&self.path, &state)?;
        Ok(self.get_state_unlocked(&state))
    }

    /// Marks first-launch setup as dismissed without affecting empty-state UI.
    pub fn dismiss_setup_prompt(&self) -> Result<AiConfigState, String> {
        let mut state = self.lock();
        state.setup_prompt_dismissed = true;
        persist_state(&self.path, &state)?;
        Ok(self.get_state_unlocked(&state))
    }

    /// Exports a key-free profile bundle as pretty JSON.
    pub fn export_profiles(&self) -> Value {
        let state = self.get_state();
        let feature_ref = |assignment: &Option<AiFeatureAssignment>| {
            assignment.as_ref().map(|item| {
                let mut value = json!({
                    "profileRef": item.profile_id,
                    "name": state.profiles.iter()
                        .find(|profile| profile.id == item.profile_id)
                        .map_or(String::new(), |profile| profile.name.clone()),
                    "model": item.model,
                });
                if let Some(metric) = item.metric {
                    value["metric"] = Value::String(serde_plain(metric));
                }
                value
            })
        };
        json!({
            "app": "nexnote",
            "kind": "ai-profiles",
            "version": 1,
            "exportedAt": now_rfc3339(),
            "profiles": state.profiles.iter().map(|profile| json!({
                "id": profile.id,
                "name": profile.name,
                "providerKind": profile.kind,
                "baseUrl": profile.base_url,
                "defaultModel": profile.default_model,
                "params": profile.params,
            })).collect::<Vec<_>>(),
            "features": {
                "writing": feature_ref(&state.features.writing),
                "translation": feature_ref(&state.features.effective_translation().cloned()),
                "chat": feature_ref(&state.features.chat),
                "embedding": feature_ref(&state.features.embedding),
            },
            "defaultProfileRef": state.default_profile_id,
            "defaultProfileName": state.default_profile_id.as_ref().and_then(|id| {
                state.profiles.iter().find(|profile| profile.id == *id)
                    .map(|profile| profile.name.clone())
            }),
            "translationTargetLanguage": state.translation_target_language,
        })
    }

    /// Imports a key-free bundle. Same-name profiles are updated, other names
    /// create new profiles. Missing or invalid assignments are skipped.
    pub fn import_profiles(&self, json: &str) -> Value {
        let parsed: Value = match serde_json::from_str(json) {
            Ok(value) => value,
            Err(_) => return json!({"imported": 0, "skipped": ["(invalid JSON)"]}),
        };
        if parsed.get("app").and_then(Value::as_str) != Some("nexnote")
            || parsed.get("kind").and_then(Value::as_str) != Some("ai-profiles")
        {
            return json!({"imported": 0, "skipped": ["(unexpected format)"]});
        }

        let mut imported = 0usize;
        let mut skipped = Vec::new();
        let mut id_by_ref = Map::new();
        let profiles = parsed
            .get("profiles")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for profile in profiles {
            let name = profile
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let base_url = profile
                .get("baseUrl")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if name.is_empty() || base_url.is_empty() {
                skipped.push(if name.is_empty() {
                    "(unnamed)".to_string()
                } else {
                    name.to_string()
                });
                continue;
            }
            let kind = profile
                .get("providerKind")
                .cloned()
                .map(serde_json::from_value::<AiProviderKind>)
                .transpose()
                .ok()
                .flatten()
                .unwrap_or(AiProviderKind::OpenaiCompatible);
            let params = profile
                .get("params")
                .cloned()
                .and_then(|value| serde_json::from_value::<ChatParams>(value).ok());
            let existing_id = self
                .get_state()
                .profiles
                .iter()
                .find(|candidate| candidate.name == name)
                .map(|candidate| candidate.id.clone());
            let input = AiProfileInput {
                id: existing_id,
                name: name.to_string(),
                kind,
                base_url: base_url.to_string(),
                default_model: profile
                    .get("defaultModel")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                params,
                credential_token: None,
                clear_credential: Some(true),
            };
            match self.save_profile(&input) {
                Ok(id) => {
                    if let Some(original_ref) = profile.get("id").and_then(Value::as_str) {
                        id_by_ref.insert(original_ref.to_string(), Value::String(id));
                    }
                    imported += 1;
                }
                Err(_) => skipped.push(name.to_string()),
            }
        }

        let resolve_ref = |value: &Value| -> Option<AiFeatureAssignment> {
            let profile_ref = value.get("profileRef").and_then(Value::as_str);
            let name = value.get("name").and_then(Value::as_str);
            let resolved_id = profile_ref
                .and_then(|reference| id_by_ref.get(reference))
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    let current_state = self.get_state();
                    let matches: Vec<_> = current_state
                        .profiles
                        .iter()
                        .filter(|profile| Some(profile.name.as_str()) == name)
                        .collect();
                    (matches.len() == 1).then(|| matches[0].id.clone())
                })?;
            let model = value.get("model").and_then(Value::as_str)?;
            let metric = value
                .get("metric")
                .cloned()
                .and_then(|value| serde_json::from_value::<EmbeddingMetric>(value).ok());
            Some(AiFeatureAssignment {
                profile_id: resolved_id,
                model: model.to_string(),
                dimensions: None,
                metric,
            })
        };
        let features = parsed.get("features").cloned().unwrap_or(Value::Null);
        for (feature, value) in [
            ("writing", features.get("writing")),
            ("translation", features.get("translation")),
            ("chat", features.get("chat")),
            ("embedding", features.get("embedding")),
        ] {
            let assignment = match value {
                Some(Value::Null) | None => None,
                Some(value) => resolve_ref(value),
            };
            if value.is_some() {
                let _ = self.set_feature(feature, assignment);
            }
        }

        let default_ref = parsed
            .get("defaultProfileRef")
            .and_then(Value::as_str)
            .and_then(|reference| id_by_ref.get(reference))
            .and_then(Value::as_str);
        if let Some(id) = default_ref {
            let _ = self.set_default_profile(id);
        }
        if let Some(language) = parsed
            .get("translationTargetLanguage")
            .and_then(Value::as_str)
        {
            let _ = self.set_translation_target_language(language);
        }
        json!({
            "imported": imported,
            "skipped": skipped,
            "state": self.get_state(),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, AiConfigState> {
        self.data
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn get_state_unlocked(&self, state: &AiConfigState) -> AiConfigState {
        let mut view = state.clone();
        view.features = view.features.normalized();
        view.needs_onboarding = view.profiles.is_empty();
        view
    }

    fn persist(&self) -> Result<(), String> {
        persist_state(&self.path, &self.lock())
    }
}

/// Fails closed to normalized defaults for partial legacy JSON.
fn normalize_state(mut state: AiConfigState) -> AiConfigState {
    state
        .profiles
        .retain(|profile| !profile.id.is_empty() && !profile.name.is_empty());
    let default_exists = state
        .default_profile_id
        .as_ref()
        .is_some_and(|id| state.profiles.iter().any(|profile| profile.id == *id));
    if !default_exists {
        state.default_profile_id = None;
    }
    for profile in &mut state.profiles {
        profile.key_storage = "system-credential".to_string();
        // The OS vault is the secret store; this marker only signals which
        // profile id the entry belongs to so later calls can read it back.
        profile.credential_account = profile.has_api_key.then(|| credential_marker(&profile.id));
    }
    if state.embedding_generation == 0 && state.embedding_fingerprint.is_none() {
        state.features = state.features.normalized();
    }
    state.needs_onboarding = state.profiles.is_empty();
    state
}

/// Validates transport constraints before any state mutation.
fn validate_profile_base_url(kind: AiProviderKind, base_url: &str) -> Result<(), String> {
    if kind == AiProviderKind::LocalEmbedding {
        if base_url != "local://embedding" {
            return Err("local embedding base URL must be local://embedding".to_string());
        }
        return Ok(());
    }
    let origin =
        parse_http_origin(base_url).map_err(|error| format!("invalid AI base URL: {error}"))?;
    if origin.host.is_empty() {
        return Err("invalid AI base URL: host is empty".to_string());
    }
    Ok(())
}

/// Clears all feature assignments pointing at a deleted profile.
fn clear_feature_references(state: &mut AiConfigState, profile_id: &str) {
    let matches = |assignment: &Option<AiFeatureAssignment>| {
        assignment
            .as_ref()
            .is_some_and(|item| item.profile_id == profile_id)
    };
    if matches(&state.features.writing) {
        state.features.writing = None;
    }
    if matches(&state.features.effective_translation().cloned()) {
        state.features.translation = Some(None);
    }
    if matches(&state.features.chat) {
        state.features.chat = None;
    }
    if matches(&state.features.embedding) {
        state.features.embedding = None;
    }
}

/// Refreshes the embedding identity and bumps its generation on any change.
fn refresh_embedding_fingerprint(state: &mut AiConfigState) {
    let next = state
        .features
        .embedding
        .as_ref()
        .map(assignment_fingerprint)
        .or_else(|| {
            // Mirror Electron: a chat-capable default is an implicit embedding
            // source until an explicit assignment exists.
            state.default_profile_id.as_ref().and_then(|id| {
                state
                    .profiles
                    .iter()
                    .find(|profile| {
                        profile.id == *id && profile.kind != AiProviderKind::LocalEmbedding
                    })
                    .map(|profile| {
                        format!(
                            "{}:{}:{}:{}",
                            profile.id,
                            profile.default_model,
                            AUTO_DIMENSION,
                            DEFAULT_EMBEDDING_METRIC
                        )
                    })
            })
        });
    if next != state.embedding_fingerprint {
        state.embedding_fingerprint = next;
        state.embedding_generation += 1;
    }
}

/// Atomically replaces the JSON file via `<path>.tmp` plus rename.
fn persist_state(path: &Path, state: &AiConfigState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create AI config directory: {error}"))?;
        }
    }
    let mut serialized = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("failed to serialize AI config: {error}"))?;
    serialized.push(b'\n');
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serialized)
        .map_err(|error| format!("failed to write AI config: {error}"))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("failed to replace AI config: {error}"))?;
    Ok(())
}

/// Parses an `http://` origin and rejects userinfo, TLS, and empty hosts.
fn parse_http_origin(base_url: &str) -> Result<HttpOrigin, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let rest = trimmed
        .strip_prefix("http://")
        .ok_or_else(|| "only local http:// base URLs are supported".to_string())?;
    if rest.is_empty() {
        return Err("host is empty".to_string());
    }
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    let path_part = &rest[authority_end..];
    if authority.contains('@') {
        return Err("URL credentials are not allowed".to_string());
    }
    let (host, port) = if authority.starts_with('[') {
        let closing = authority
            .find(']')
            .ok_or_else(|| "invalid IPv6 host".to_string())?;
        let host = authority[1..closing].to_string();
        let port = authority[closing + 1..]
            .strip_prefix(':')
            .map(str::parse::<u16>)
            .transpose()
            .map_err(|_| "invalid port".to_string())?;
        (host, port.unwrap_or(80))
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) => (
                host.to_string(),
                port.parse::<u16>()
                    .map_err(|_| "invalid port".to_string())?,
            ),
            None => (authority.to_string(), 80),
        }
    };
    if host.is_empty() {
        return Err("host is empty".to_string());
    }
    let path_prefix = if path_part.is_empty() || path_part == "/" {
        String::new()
    } else {
        path_part
            .split(['?', '#'])
            .next()
            .unwrap_or("")
            .trim_end_matches('/')
            .to_string()
    };
    Ok(HttpOrigin {
        host,
        port,
        path_prefix,
    })
}

/// Builds an OpenAI-compatible URL, always under the caller-requested `/v1`.
fn request_url(origin: &HttpOrigin, path: &str) -> String {
    let host = if origin.host.contains(':') {
        format!("[{}]", origin.host)
    } else {
        origin.host.clone()
    };
    let prefix = origin.path_prefix.trim_matches('/');
    if prefix.is_empty() {
        format!("http://{host}:{}{path}", origin.port)
    } else {
        format!("http://{host}:{}/{prefix}{path}", origin.port)
    }
}

/// Performs one HTTP/1.1 JSON request over `TcpStream` with `Connection: close`.
fn http_json_request(
    base_url: &str,
    path: &str,
    method: &str,
    api_key: Option<&str>,
    body: Option<&Value>,
) -> Result<HttpResponse, String> {
    let origin = parse_http_origin(base_url)?;
    let full_url = request_url(&origin, path);
    let request_target = full_url
        .trim_start_matches("http://")
        .split_once('/')
        .map_or("/".to_string(), |(_, suffix)| format!("/{suffix}"));
    let mut request = format!(
        "{method} {request_target} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\nAccept: application/json\r\n",
        origin.host,
        origin.port,
    );
    if let Some(key) = api_key.map(str::trim).filter(|key| !key.is_empty()) {
        request.push_str(&format!("Authorization: Bearer {key}\r\n"));
    }
    let body_bytes = body.map(|value| {
        serde_json::to_vec(value).map_err(|error| format!("failed to encode request: {error}"))
    });
    if let Some(bytes) = &body_bytes {
        let bytes = bytes.as_ref().map_err(Clone::clone)?;
        request.push_str("Content-Type: application/json\r\n");
        request.push_str(&format!("Content-Length: {}\r\n", bytes.len()));
    }
    request.push_str("\r\n");

    let stream = TcpStream::connect((origin.host.as_str(), origin.port))
        .map_err(|error| format!("failed to connect to AI provider: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(15)))
        .and_then(|()| stream.set_write_timeout(Some(Duration::from_secs(15))))
        .map_err(|error| format!("failed to configure provider connection: {error}"))?;
    let mut stream = stream;
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("failed to send provider request: {error}"))?;
    stream
        .flush()
        .map_err(|error| format!("failed to send provider request: {error}"))?;
    read_http_response(&mut stream)
}

/// Reads an HTTP/1.1 response, honoring Content-Length or chunked encoding.
fn read_http_response(stream: &mut TcpStream) -> Result<HttpResponse, String> {
    let mut raw = Vec::new();
    let mut chunk = [0_u8; 8192];
    let header_end;
    loop {
        if let Some(position) = find_subslice(&raw, b"\r\n\r\n") {
            header_end = position;
            break;
        }
        let read = stream
            .read(&mut chunk)
            .map_err(|error| format!("failed to read provider response: {error}"))?;
        if read == 0 {
            return Err("provider closed before sending response headers".to_string());
        }
        raw.extend_from_slice(&chunk[..read]);
    }
    let headers = String::from_utf8_lossy(&raw[..header_end]).to_string();
    let mut lines = headers.split("\r\n");
    let status_line = lines.next().unwrap_or_default();
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| "invalid provider response status".to_string())?;
    let mut content_length = None;
    let mut chunked = false;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        if name == "content-length" {
            content_length = value.parse::<usize>().ok();
        } else if name == "transfer-encoding" && value.eq_ignore_ascii_case("chunked") {
            chunked = true;
        }
    }

    let mut body = raw[header_end + 4..].to_vec();
    if let Some(length) = content_length {
        while body.len() < length {
            let read = stream
                .read(&mut chunk)
                .map_err(|error| format!("failed to read provider response: {error}"))?;
            if read == 0 {
                return Err("provider closed before sending the complete response".to_string());
            }
            body.extend_from_slice(&chunk[..read]);
        }
        body.truncate(length);
    } else {
        loop {
            let read = stream
                .read(&mut chunk)
                .map_err(|error| format!("failed to read provider response: {error}"))?;
            if read == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..read]);
        }
        if chunked {
            body = decode_chunked(&body)
                .ok_or_else(|| "invalid chunked provider response".to_string())?;
        }
    }
    Ok(HttpResponse { status, body })
}

/// Finds a byte subslice without allocating a search copy.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Decodes a complete chunked body. Returns `None` on malformed framing.
fn decode_chunked(mut input: &[u8]) -> Option<Vec<u8>> {
    let mut output = Vec::new();
    loop {
        let line_end = find_subslice(input, b"\r\n")?;
        let size_text = std::str::from_utf8(&input[..line_end]).ok()?;
        let size = usize::from_str_radix(size_text.split(';').next()?.trim(), 16).ok()?;
        input = &input[line_end + 2..];
        if size == 0 {
            return Some(output);
        }
        if input.len() < size + 2 {
            return None;
        }
        output.extend_from_slice(&input[..size]);
        if &input[size..size + 2] != b"\r\n" {
            return None;
        }
        input = &input[size + 2..];
    }
}

/// Lists model IDs from `/v1/models`, sorted for deterministic UI display.
fn list_models_result(base_url: &str, api_key: Option<&str>) -> Result<Vec<String>, String> {
    let response = http_json_request(base_url, "/v1/models", "GET", api_key, None)?;
    if response.status < 200 || response.status >= 300 {
        return Err(format!(
            "model list request failed with HTTP {}",
            response.status
        ));
    }
    let parsed: Value = serde_json::from_slice(&response.body)
        .map_err(|error| format!("invalid model list JSON: {error}"))?;
    let mut models = parsed
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .filter(|id| !id.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    models.sort();
    Ok(models)
}

/// Lists model IDs from `/v1/models`; errors yield an empty list.
///
/// This keeps the simple foundation API for callers that only need choices.
/// [`test_connection`] uses [`list_models_result`] when it must also explain
/// why an endpoint was unreachable.
pub fn list_models(base_url: &str, api_key: Option<&str>) -> Vec<String> {
    list_models_result(base_url, api_key).unwrap_or_default()
}

/// Probes `/v1/models` and infers the capabilities covered by this slice.
///
/// `chat` means a non-embedding model is discoverable. `streaming` and `tools`
/// remain `false` because SSE and tool calls are explicitly out of scope here;
/// the next slice must probe them rather than claiming support.
pub fn test_connection(base_url: &str, api_key: Option<&str>) -> ConnectionTestResult {
    let started = Instant::now();
    let mut models = Vec::new();
    let mut reachable = false;
    let mut error = None;
    match list_models_result(base_url, api_key) {
        Ok(loaded) => {
            reachable = true;
            models = loaded;
        }
        Err(probe_error) => error = Some(probe_error),
    }
    let chat = models
        .iter()
        .any(|model| !model.to_ascii_lowercase().contains("embed"));
    let embeddings = models
        .iter()
        .any(|model| model.to_ascii_lowercase().contains("embed"));
    ConnectionTestResult {
        reachable,
        capabilities: ProviderCapabilities {
            chat,
            streaming: false,
            embeddings,
            tools: false,
        },
        models,
        latency_ms: started.elapsed().as_millis() as u64,
        error,
    }
}

/// Requests embeddings from `/v1/embeddings`, preserving input order.
pub fn embed(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    inputs: &[String],
) -> Result<Vec<Vec<f64>>, String> {
    if model.trim().is_empty() {
        return Err("embedding model must not be empty".to_string());
    }
    if inputs.is_empty() {
        return Err("embedding input must not be empty".to_string());
    }
    let body = json!({
        "model": model,
        "input": inputs,
    });
    let response = http_json_request(base_url, "/v1/embeddings", "POST", api_key, Some(&body))?;
    if response.status < 200 || response.status >= 300 {
        return Err(format!(
            "embedding request failed with HTTP {}",
            response.status
        ));
    }
    let parsed: Value = serde_json::from_slice(&response.body)
        .map_err(|error| format!("invalid embedding JSON: {error}"))?;
    let data = parsed
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "embedding response is missing data".to_string())?;
    if data.len() != inputs.len() {
        return Err(format!(
            "embedding response count mismatch: expected {}, got {}",
            inputs.len(),
            data.len()
        ));
    }
    let mut vectors = Vec::with_capacity(data.len());
    for item in data {
        let vector = item
            .get("embedding")
            .and_then(Value::as_array)
            .ok_or_else(|| "embedding item is missing a vector".to_string())?
            .iter()
            .map(|value| {
                value
                    .as_f64()
                    .ok_or_else(|| "embedding vector is not numeric".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        if vector.is_empty() {
            return Err("embedding vector is empty".to_string());
        }
        vectors.push(vector);
    }
    let dimensions = vectors[0].len();
    if vectors.iter().any(|vector| vector.len() != dimensions) {
        return Err("embedding vectors have inconsistent dimensions".to_string());
    }
    Ok(vectors)
}

/// SSE event emitted during a streaming chat completion.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatSseEvent {
    Start { model: String },
    Delta { text: String },
    Done,
    Error { message: String, code: String },
}

/// Streams `/v1/chat/completions` using SSE and calls `on_event` for each delta.
/// Returns the full assembled text on success.
pub fn stream_chat(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages: &[Value],
    mut on_event: impl FnMut(ChatSseEvent),
) -> Result<String, String> {
    let never_cancel = || false;
    match stream_chat_inner(
        base_url,
        api_key,
        model,
        messages,
        &mut on_event,
        &never_cancel,
    )? {
        ChatStreamOutcome::Completed(text) => Ok(text),
        // The never-cancel flag means this arm is unreachable; the type system
        // forces us to handle the shared return type exhaustively.
        ChatStreamOutcome::Cancelled => unreachable!("the never-cancel flag cannot cancel"),
    }
}

/// Cancellable variant: `is_cancelled` is polled between stream chunks so an
/// agent run can abort mid-response. Cancellation surfaces as
/// `ChatStreamOutcome::Cancelled` rather than an error, because the user asked
/// for it — it is not a provider failure.
pub fn stream_chat_cancellable(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages: &[Value],
    on_event: &mut dyn FnMut(ChatSseEvent),
    is_cancelled: &dyn Fn() -> bool,
) -> Result<ChatStreamOutcome, String> {
    stream_chat_inner(base_url, api_key, model, messages, on_event, is_cancelled)
}

/// Terminal state of a chat stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatStreamOutcome {
    /// Provider finished normally; carries the assembled text.
    Completed(String),
    /// The run was cancelled before the stream ended.
    Cancelled,
}

/// Read timeout for the cancellable loop. Short enough that a cancel lands
/// within ~100ms of the flag flipping, long enough for slow providers.
const CANCEL_POLL_READ_TIMEOUT: Duration = Duration::from_millis(100);

fn stream_chat_inner(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages: &[Value],
    on_event: &mut dyn FnMut(ChatSseEvent),
    is_cancelled: &dyn Fn() -> bool,
) -> Result<ChatStreamOutcome, String> {
    let origin = parse_http_origin(base_url)?;
    let request_target = format!(
        "{}/v1/chat/completions",
        origin.path_prefix.trim_end_matches('/')
    );
    let body = json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });
    let body_bytes =
        serde_json::to_vec(&body).map_err(|e| format!("failed to encode stream request: {e}"))?;
    let mut request = format!(
        "POST {request_target} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\nAccept: text/event-stream\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
        origin.host, origin.port, body_bytes.len(),
    );
    if let Some(key) = api_key.map(str::trim).filter(|k| !k.is_empty()) {
        request.push_str(&format!("Authorization: Bearer {key}\r\n"));
    }
    request.push_str("\r\n");

    let mut stream = TcpStream::connect((origin.host.as_str(), origin.port))
        .map_err(|e| format!("failed to connect to AI provider: {e}"))?;
    stream
        .set_read_timeout(Some(CANCEL_POLL_READ_TIMEOUT))
        .map_err(|error| format!("failed to configure provider connection: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(15)))
        .map_err(|error| format!("failed to configure provider connection: {error}"))?;
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("failed to send provider request: {error}"))?;
    stream
        .flush()
        .map_err(|error| format!("failed to send provider request: {error}"))?;

    on_event(ChatSseEvent::Start {
        model: model.to_owned(),
    });

    let mut reader = BufReader::new(stream);
    let mut full_text = String::new();
    let mut line = String::new();
    loop {
        line.clear();
        // Cancel is checked before every blocking read so a stop request lands
        // within one poll interval instead of at the end of the response.
        if is_cancelled() {
            return Ok(ChatStreamOutcome::Cancelled);
        }
        let bytes_read = match reader.read_line(&mut line) {
            Ok(read) => read,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                // Idle provider: loop back so the cancel flag is re-checked.
                continue;
            }
            Err(error) => return Err(format!("failed to read provider stream: {error}")),
        };
        if bytes_read == 0 {
            break;
        }
        let trimmed = line.trim();
        if !trimmed.starts_with("data: ") {
            continue;
        }
        let data = &trimmed[6..];
        if data == "[DONE]" {
            break;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        if let Some(delta) = chunk
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
        {
            if !delta.is_empty() {
                full_text.push_str(delta);
                on_event(ChatSseEvent::Delta {
                    text: delta.to_owned(),
                });
            }
        }
    }
    on_event(ChatSseEvent::Done);
    Ok(ChatStreamOutcome::Completed(full_text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::thread;

    fn temp_path(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "nexnote-ai-service-{}-{}",
            now_millis(),
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("create temp directory");
        directory.join(name)
    }

    #[test]
    fn credential_marker_round_trips_the_profile_id() {
        let marker = credential_marker("prof_abc123");
        assert_eq!(profile_id_from_marker(&marker), Some("prof_abc123"));
        assert_eq!(profile_id_from_marker("legacy:placeholder"), None);
        assert_eq!(profile_id_from_marker("nonsense"), None);
    }

    /// Exercises the real OS credential vault. Environments without a keychain
    /// (headless CI) report the platform error instead of failing unrelated
    /// suites, while macOS/Linux desktops assert the full round trip.
    #[test]
    fn keychain_round_trips_stores_reads_and_deletes() {
        let profile_id = format!("test-keychain-{}", now_millis());
        if let Err(error) = store_credential(&profile_id, "secret-value") {
            eprintln!("[keychain-test] skipped, no usable credential vault: {error}");
            return;
        }
        assert_eq!(
            read_credential(&profile_id).as_deref(),
            Some("secret-value")
        );
        // Overwrite is how re-saving a profile rotates its key.
        store_credential(&profile_id, "rotated").expect("rotate credential");
        assert_eq!(read_credential(&profile_id).as_deref(), Some("rotated"));
        delete_credential(&profile_id).expect("delete credential");
        assert_eq!(read_credential(&profile_id), None);
        // Deleting twice is idempotent so profile removal never hard-fails.
        delete_credential(&profile_id).expect("delete is idempotent");
    }

    fn profile_input(name: &str, base_url: &str) -> AiProfileInput {
        AiProfileInput {
            id: None,
            name: name.to_string(),
            kind: AiProviderKind::OpenaiCompatible,
            base_url: base_url.to_string(),
            default_model: "gpt-test".to_string(),
            params: Some(ChatParams {
                temperature: Some(0.2),
                max_tokens: Some(64),
                reasoning_effort: None,
            }),
            credential_token: Some("one-shot-token".to_string()),
            clear_credential: None,
        }
    }

    #[test]
    fn default_state_matches_shared_contract() {
        let path = temp_path("default.json");
        let store = AiStore::new(path);
        let state = store.get_state();
        assert!(state.profiles.is_empty());
        assert_eq!(state.default_profile_id, None);
        assert!(state.needs_onboarding);
        assert!(!state.setup_prompt_dismissed);
        assert_eq!(state.features.writing, None);
        assert_eq!(state.features.effective_translation(), None);
        assert_eq!(state.features.chat, None);
        assert_eq!(state.features.embedding, None);
        assert_eq!(state.embedding_fingerprint, None);
        assert_eq!(state.embedding_generation, 0);
    }

    #[test]
    fn saves_updates_and_deletes_profiles() {
        let path = temp_path("profiles.json");
        let store = AiStore::new(path);
        let first_id = store
            .save_profile(&profile_input("Local", "http://127.0.0.1:1234"))
            .unwrap();
        let state = store.get_state();
        assert_eq!(state.default_profile_id.as_deref(), Some(first_id.as_str()));
        assert!(state.profiles[0].has_api_key);
        assert_eq!(state.profiles[0].key_storage, "system-credential");

        let update = AiProfileInput {
            id: Some(first_id.clone()),
            credential_token: None,
            ..profile_input("Local renamed", "http://127.0.0.1:1234/")
        };
        let updated_id = store.save_profile(&update).unwrap();
        assert_eq!(updated_id, first_id);
        let state = store.get_state();
        assert_eq!(state.profiles[0].name, "Local renamed");
        assert_eq!(state.profiles[0].base_url, "http://127.0.0.1:1234");
        assert!(
            state.profiles[0].has_api_key,
            "omitted credential must be retained"
        );

        let mut clear = update.clone();
        clear.clear_credential = Some(true);
        store.save_profile(&clear).unwrap();
        assert!(!store.get_state().profiles[0].has_api_key);

        let state = store.delete_profile(&first_id).unwrap();
        assert!(state.profiles.is_empty());
        assert!(state.needs_onboarding);
        assert_eq!(state.default_profile_id, None);
    }

    #[test]
    fn assigns_features_and_refreshes_embedding_generation() {
        let path = temp_path("features.json");
        let store = AiStore::new(path);
        let id = store
            .save_profile(&profile_input("Provider", "http://127.0.0.1:1234"))
            .unwrap();
        let assignment = AiFeatureAssignment {
            profile_id: id.clone(),
            model: "text-embedding-test".to_string(),
            dimensions: None,
            metric: Some(EmbeddingMetric::DotProduct),
        };
        let before = store.get_state().embedding_generation;
        let state = store
            .set_feature("embedding", Some(assignment.clone()))
            .unwrap();
        assert_eq!(state.features.embedding, Some(assignment.clone()));
        assert!(state.embedding_generation > before);
        assert_eq!(
            state.embedding_fingerprint.as_deref(),
            Some(format!("{id}:text-embedding-test:auto:dotProduct").as_str())
        );
        let state = store.set_feature("embedding", None).unwrap();
        assert_eq!(state.features.embedding, None);
        assert!(store.set_feature("unknown", None).is_err());
    }

    #[test]
    fn fingerprint_contains_all_identity_fields() {
        assert_eq!(
            embedding_fingerprint("profile", "model", 384, "cosine"),
            "profile:model:384:cosine"
        );
    }

    #[test]
    fn persists_atomically_and_leaves_no_temporary_file() {
        let path = temp_path("atomic.json");
        let store = AiStore::new(path.clone());
        store
            .save_profile(&profile_input("Atomic", "http://127.0.0.1:1234"))
            .unwrap();
        assert!(path.exists());
        let temporary = path.with_extension("json.tmp");
        assert!(!temporary.exists());
        let raw = fs::read_to_string(&path).unwrap();
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            parsed
                .get("profiles")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        let exported = store.export_profiles();
        assert_eq!(exported["app"], "nexnote");
        assert!(serde_json::to_string(&exported)
            .unwrap()
            .find("credential")
            .is_none());
        let result = store.import_profiles(&serde_json::to_string(&exported).unwrap());
        assert_eq!(result["imported"], 1);
        assert!(result["skipped"].as_array().unwrap().is_empty());
    }

    #[test]
    fn http_client_parses_models_and_embeddings() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            // list_models, test_connection, and embed each use one connection.
            for _ in 0..3 {
                let (stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream);
                let mut request_line = String::new();
                reader.read_line(&mut request_line).unwrap();
                let mut header = String::new();
                loop {
                    header.clear();
                    reader.read_line(&mut header).unwrap();
                    if header == "\r\n" {
                        break;
                    }
                }
                if request_line.contains("/v1/models") {
                    let body = br#"{"data":[{"id":"embed-x"},{"id":"chat-x"}]}"#;
                    write_response(reader.get_mut(), 200, body);
                } else {
                    let body =
                        br#"{"data":[{"index":1,"embedding":[1,2]},{"index":0,"embedding":[3,4]}]}"#;
                    write_response(reader.get_mut(), 200, body);
                }
            }
        });

        let base_url = format!("http://{address}/api");
        let models = list_models(&base_url, Some("secret"));
        assert_eq!(models, vec!["chat-x", "embed-x"]);
        let result = test_connection(&base_url, Some("secret"));
        assert!(result.reachable);
        assert!(result.capabilities.chat);
        assert!(result.capabilities.embeddings);
        assert!(!result.capabilities.streaming);
        assert!(!result.capabilities.tools);

        let vectors = embed(
            &base_url,
            Some("secret"),
            "embed-x",
            &["first".to_string(), "second".to_string()],
        )
        .unwrap();
        assert_eq!(vectors, vec![vec![1.0, 2.0], vec![3.0, 4.0]]);
    }

    fn write_response(mut stream: impl Write, status: u16, body: &[u8]) {
        let response = format!(
            "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(response.as_bytes()).unwrap();
        stream.write_all(body).unwrap();
        stream.flush().unwrap();
    }

    /// A real SSE server that sends two chunks then stalls; a cancellation
    /// must land before the stream finishes, proving the poll works.
    #[test]
    fn cancellable_stream_aborts_mid_response() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            let stream = listener.accept().unwrap().0;
            let mut reader = BufReader::new(stream);
            let mut request_line = String::new();
            reader.read_line(&mut request_line).unwrap();
            let mut header = String::new();
            loop {
                header.clear();
                reader.read_line(&mut header).unwrap();
                if header == "\r\n" {
                    break;
                }
            }
            // Streaming-style SSE: no Content-Length (the connection stays
            // open) and newline-terminated events so the client's read_line
            // can complete. Real providers terminate data lines with \n.
            let sink = reader.get_mut();
            sink.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
            // Avoid raw-string syntax here: the JSON's trailing quotes make
            // the `"#` terminator ambiguous and silently add bad bytes.
            sink.write_all(br#"data: {"choices":[{"delta":{"content":"first"}}]}"#.as_slice())
                .unwrap();
            sink.write_all(b"\n\n").unwrap();
            sink.flush().unwrap();
            // Stall forever after the chunks; only cancellation ends the read.
            loop {
                thread::sleep(Duration::from_secs(10));
            }
        });

        let base_url = format!("http://{address}/api");
        let flag = std::sync::atomic::AtomicBool::new(false);
        let cancel_after_first = || flag.load(std::sync::atomic::Ordering::SeqCst);
        let mut deltas = 0;
        let outcome = stream_chat_cancellable(
            &base_url,
            None,
            "test-model",
            &[json!({ "role": "user", "content": "hello" })],
            &mut |event| {
                if matches!(event, ChatSseEvent::Delta { .. }) {
                    deltas += 1;
                    // Cancel after the first chunk so the second is never read.
                    flag.store(true, std::sync::atomic::Ordering::SeqCst);
                }
            },
            &cancel_after_first,
        )
        .expect("stream must not error");

        assert_eq!(
            outcome,
            ChatStreamOutcome::Cancelled,
            "cancellation must be distinguishable from provider failure"
        );
        assert_eq!(deltas, 1, "exactly one delta before the cancel lands");
    }
}
