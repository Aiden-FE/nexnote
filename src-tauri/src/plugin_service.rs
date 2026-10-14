//! DEV-122 plugin store and service foundation.
//!
//! This module intentionally does not touch Tauri's IPC layer.  It provides
//! the durable plugin store, manifest validation, install intake, permission
//! state and audit trail.  A later slice must mount these operations in the
//! product command dispatcher and add the sandbox runtime.

#![allow(dead_code)]

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

const MANIFEST_FILE: &str = "manifest.json";
const MANIFEST_LIMIT: usize = 1024 * 1024;
const ARTIFACT_LIMIT: usize = 64 * 1024 * 1024;
const ZIP_ENTRY_LIMIT: usize = 2000;
const ZIP_ENTRY_LIMIT_BYTES: usize = 4 * 1024 * 1024;
const MAX_AUDIT: usize = 300;
const SESSION_TTL_MS: u64 = 10 * 60 * 1000;
const CHALLENGE_TTL_MS: u64 = 60 * 1000;
const IDEMPOTENCY_TTL_MS: u64 = 5 * 60 * 1000;
const DEFAULT_GRANTS: [&str; 2] = ["read", "edit"];

/// Plugin permissions, matching the shared TypeScript union.
const PERMISSIONS: [&str; 6] = [
    "read",
    "edit",
    "filesystem",
    "network",
    "external-command",
    "desktop-privileged",
];

const CONTRIBUTION_KINDS: [&str; 4] = ["commands", "menus", "views", "blockTypes"];

#[derive(Debug, Clone, PartialEq, Eq)]
struct ValidationError(pub String);

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ValidationError {}

/// A validated manifest; raw JSON is retained to avoid lossy contracts.
#[derive(Debug, Clone)]
struct ValidManifest {
    manifest: Value,
    raw: Vec<u8>,
    permissions: Vec<String>,
    main: String,
    id: String,
    name: String,
    version: String,
}

/// Manifest types are validated against the TS contract and re-serialized with
/// camelCase keys on all service-owned fields.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifest {
    id: String,
    name: String,
    version: String,
    min_app_version: String,
    main: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    capabilities: Vec<String>,
    permissions: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    contributions: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    skills: Option<Vec<Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    builtin: Option<bool>,
}

impl<'de> Deserialize<'de> for PluginManifest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        validate_manifest(&value)
            .map_err(serde::de::Error::custom)?;
        Ok(PluginManifest::from_validated(&value))
    Deserialize for PluginManifest... (abridged in this hand-edit)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum PluginRuntimeState {
    Loaded,
    Active,
    Disabled,
    Crashed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct GrantState {
    granted: bool,
    always_allow: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedPlugin {
    source: SourceRef,
    enabled: bool,
    #[serde(default)]
    grants: HashMap<String, GrantState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceRef {
    kind: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    version: u8,
    plugins: Vec<PersistedPlugin>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginView {
    id: String,
    name: String,
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    builtin: Option<bool>,
    state: PluginRuntimeState,
    permissions: Vec<String>,
    grants: Vec<PluginPermissionGrant>,
    contribution_counts: HashMap<String, usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginPermissionGrant {
    permission: String,
    granted: bool,
    always_allow: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginInstallTicket {
    ticket: String,
    artifact_hash: String,
    source: String,
    manifest: PluginManifest,
    requested_permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginSessionToken {
    token: String,
    plugin_id: String,
    session_id: String,
    issued_at: u64,
    expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginAuthChallenge {
    challenge: String,
    plugin_id: String,
    permission: String,
    request: Value,
    session_id: String,
    request_id: String,
    issued_at: u64,
    expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginAuditRecord {
    id: String,
    plugin_id: String,
    operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    permission: Option<String>,
    allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    at: u64,
}

#[derive(Debug)]
struct Stage {
    ticket: String,
    artifact_hash: String,
    staging_path: PathBuf,
    source: String,
    manifest: PluginManifest,
    main_rel: String,
    requested_permissions: Vec<String>,
    created_at: u64,
}

#[derive(Debug, Clone)]
struct Session {
    plugin_id: String,
    token: String,
    expires_at: u64,
}

#[derive(Debug, Clone)]
struct PendingChallenge {
    record: PluginAuthChallenge,
}

#[derive(Debug, Clone)]
struct IdempotencyRecord {
    result: Value,
    created_at: u64,
}

#[derive(Debug, Default)]
struct PluginStore {
    state_file: Option<PathBuf>,
    plugins_root: Option<PathBuf>,
    host_version: String,
    plugins: HashMap<String, InstalledPlugin>,
    audit: Vec<PluginAuditRecord>,
    tickets: HashMap<String, Stage>,
    sessions: HashMap<String, Session>,
    challenges: HashMap<String, PendingChallenge>,
    idempotency: HashMap<String, IdempotencyRecord>,
    seq: u64,
}

#[derive(Debug, Clone)]
struct InstalledPlugin {
    manifest: PluginManifest,
    source: SourceRef,
    enabled: bool,
    grants: HashMap<String, GrantState>,
    state: PluginRuntimeState,
    last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandAck {
    command_id: String,
    plugin_id: String,
    payload: Value,
    registered: bool,
}

impl PluginStore {
    fn new(state_file: Option<PathBuf>, plugins_root: Option<PathBuf>, host_version: impl Into<String>) -> Self {
        let mut store = Self {
            state_file,
            plugins_root,
            host_version: host_version.into(),
            ..Self::default()
        };
        store.restore();
        store
    }

    fn now_ms() -> u64 { ... }
    fn new_secret(prefix: &str, len: usize) -> String { ... }
    ...
}
