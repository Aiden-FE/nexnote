//! DEV-122 plugin store and service foundation.
//!
//! This slice deliberately keeps Tauri IPC and the sandbox runtime out of
//! scope. It provides manifest validation, durable install and permission
//! state, safe directory/ZIP intake, session/challenge tokens and audit
//! records. The command dispatcher can mount these APIs without changing their
//! wire contracts.

#![allow(dead_code)]

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MANIFEST_FILE: &str = "manifest.json";
const MANIFEST_LIMIT: usize = 1024 * 1024;
const ARTIFACT_LIMIT: usize = 64 * 1024 * 1024;
const ZIP_ENTRY_LIMIT: usize = 2000;
const ZIP_ENTRY_LIMIT_BYTES: usize = 4 * 1024 * 1024;
const MAX_AUDIT: usize = 300;
const SESSION_TTL_MS: u64 = 10 * 60 * 1000;
const CHALLENGE_TTL_MS: u64 = 60 * 1000;
const TICKET_TTL_MS: u64 = 15 * 60 * 1000;
const STATE_VERSION: u8 = 1;
const PLUGIN_API_VERSION: &str = "1.0.0";
const DEFAULT_GRANTS: [&str; 2] = ["read", "edit"];

/// Permissions accepted by the host, matching the shared TypeScript union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginPermission {
    Read,
    Edit,
    Filesystem,
    Network,
    #[serde(rename = "external-command")]
    ExternalCommand,
    #[serde(rename = "desktop-privileged")]
    DesktopPrivileged,
}

impl PluginPermission {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "read" => Ok(Self::Read),
            "edit" => Ok(Self::Edit),
            "filesystem" => Ok(Self::Filesystem),
            "network" => Ok(Self::Network),
            "external-command" => Ok(Self::ExternalCommand),
            "desktop-privileged" => Ok(Self::DesktopPrivileged),
            _ => Err(format!("unknown plugin permission: {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginContributionKind {
    Commands,
    Menus,
    Views,
    BlockTypes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginViewPlacement {
    Sidebar,
    Main,
    Settings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PluginMenuAnchor {
    #[serde(rename = "editor/context")]
    EditorContext,
    #[serde(rename = "block/handle")]
    BlockHandle,
    App,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginContributionWhen {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_selection: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginContribution {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keywords: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placement: Option<PluginViewPlacement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<PluginMenuAnchor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<PluginContributionWhen>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSkillContribution {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<HashMap<String, Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub min_app_version: String,
    pub main: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub capabilities: Vec<PluginPermission>,
    pub permissions: Vec<PluginPermission>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contributions: Option<HashMap<PluginContributionKind, Vec<PluginContribution>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<PluginSkillContribution>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builtin: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginSource {
    Directory,
    Zip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginRuntimeState {
    Loaded,
    Active,
    Disabled,
    Crashed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPermissionGrant {
    pub permission: PluginPermission,
    pub granted: bool,
    pub always_allow: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginView {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub builtin: Option<bool>,
    pub state: PluginRuntimeState,
    pub permissions: Vec<PluginPermission>,
    pub grants: Vec<PluginPermissionGrant>,
    pub contribution_counts: HashMap<PluginContributionKind, usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallTicket {
    pub ticket: String,
    pub artifact_hash: String,
    pub source: PluginSource,
    pub manifest: PluginManifest,
    pub requested_permissions: Vec<PluginPermission>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSessionToken {
    pub token: String,
    pub plugin_id: String,
    pub session_id: String,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAuthChallenge {
    pub challenge: String,
    pub plugin_id: String,
    pub permission: PluginPermission,
    pub request: Value,
    pub session_id: String,
    pub request_id: String,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAuditRecord {
    pub id: String,
    pub plugin_id: String,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission: Option<PluginPermission>,
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandAck {
    pub command_id: String,
    pub plugin_id: String,
    pub payload: Value,
    pub registered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceRef {
    kind: PluginSource,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrantState {
    granted: bool,
    always_allow: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedPlugin {
    id: String,
    source: SourceRef,
    enabled: bool,
    #[serde(default)]
    grants: HashMap<PluginPermission, GrantState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    version: u8,
    plugins: Vec<PersistedPlugin>,
}

#[derive(Debug, Clone)]
struct Stage {
    ticket: String,
    artifact_hash: String,
    staging_path: PathBuf,
    source: PluginSource,
    manifest: PluginManifest,
    main_rel: String,
    requested_permissions: Vec<PluginPermission>,
    created_at: u64,
}

#[derive(Debug, Clone)]
struct AuthSession {
    session_id: String,
    plugin_id: String,
    token: String,
    expires_at: u64,
}

#[derive(Debug, Clone)]
struct PluginRecord {
    manifest: PluginManifest,
    source: SourceRef,
    enabled: bool,
    grants: HashMap<PluginPermission, GrantState>,
    state: PluginRuntimeState,
    last_error: Option<String>,
}

#[derive(Debug, Default)]
pub struct PluginStore {
    state_file: Option<PathBuf>,
    plugins_root: Option<PathBuf>,
    host_version: String,
    plugins: HashMap<String, PluginRecord>,
    audit: Vec<PluginAuditRecord>,
    tickets: HashMap<String, Stage>,
    sessions: HashMap<String, AuthSession>,
    challenges: HashMap<String, PluginAuthChallenge>,
    seq: u64,
}

static SECRET_COUNTER: AtomicU64 = AtomicU64::new(1);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

fn new_secret() -> String {
    let counter = SECRET_COUNTER.fetch_add(1, Ordering::Relaxed);
    let time = now_ms();
    let entropy = time.rotate_left(17)
        ^ counter.rotate_left(3).wrapping_mul(0x9e37_79b9_7f4a_7c15)
        ^ counter.rotate_left(29);
    format!("{entropy:016x}{counter:016x}")
}

fn is_semver(value: &str) -> bool {
    let (core, rest) = match value.split_once('-') {
        Some((core, rest)) => (core, Some(rest)),
        None => (value, None),
    };
    if rest.is_some_and(|rest| rest.is_empty() || rest.split('.').any(str::is_empty)) {
        return false;
    }
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.len() <= 10
                && part.chars().all(|c| c.is_ascii_digit())
                && part.parse::<u64>().is_ok()
        })
}

fn is_plugin_id(value: &str) -> bool {
    let segments: Vec<&str> = value.split(['.', '-']).collect();
    segments.len() >= 2
        && segments.iter().all(|segment| {
            !segment.is_empty() && segment.chars().all(|c| c.is_ascii_alphanumeric())
        })
}

fn normalized_path(value: &str) -> String {
    value.replace('\\', "/")
}

fn unsafe_relative_path(value: &str) -> bool {
    let normalized = normalized_path(value);
    Path::new(&normalized).is_absolute() || normalized.split('/').any(|part| part == "..")
}

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let normalized = normalized_path(relative);
    let relative_path = Path::new(&normalized);
    if relative_path.is_absolute() {
        return Err("plugin path must be relative".to_owned());
    }
    if relative_path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("plugin path contains an unsafe component".to_owned());
    }
    Ok(root.join(relative_path))
}

fn validate_permission_list(value: &Value, field: &str) -> Result<(), String> {
    let items = value
        .as_array()
        .ok_or_else(|| format!("{field} must be an array"))?;
    for item in items {
        let text = item
            .as_str()
            .ok_or_else(|| format!("{field} contains a non-string permission"))?;
        PluginPermission::parse(text)?;
    }
    Ok(())
}

fn validate_contribution(item: &Value, kind: PluginContributionKind) -> Result<(), String> {
    let object = item
        .as_object()
        .ok_or_else(|| "contribution must be an object".to_owned())?;
    for field in ["id", "title"] {
        let value = object
            .get(field)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("contribution {field} must be a string"))?;
        if value.trim().is_empty() {
            return Err(format!("contribution {field} cannot be empty"));
        }
    }
    if let Some(keywords) = object.get("keywords") {
        let keywords = keywords
            .as_array()
            .ok_or_else(|| "contribution keywords must be an array".to_owned())?;
        if keywords.iter().any(|keyword| !keyword.is_string()) {
            return Err("contribution keywords must be strings".to_owned());
        }
    }
    if let Some(placement) = object.get("placement") {
        if !matches!(
            placement.as_str(),
            Some("sidebar") | Some("main") | Some("settings")
        ) {
            return Err("invalid view placement".to_owned());
        }
    }
    if let Some(anchor) = object.get("anchor") {
        if !matches!(
            anchor.as_str(),
            Some("editor/context") | Some("block/handle") | Some("app")
        ) {
            return Err("invalid menu anchor".to_owned());
        }
    }
    if let Some(when) = object.get("when") {
        if !when.is_object() {
            return Err("contribution when must be an object".to_owned());
        }
        if let Some(block_type) = when.get("blockType") {
            if !block_type.is_string() {
                return Err("contribution when blockType must be a string".to_owned());
            }
        }
        if let Some(requires) = when.get("requiresSelection") {
            if !requires.is_boolean() {
                return Err("contribution when requiresSelection must be a boolean".to_owned());
            }
        }
    }
    if kind == PluginContributionKind::BlockTypes {
        let block_type = object
            .get("blockType")
            .and_then(Value::as_str)
            .ok_or_else(|| "blockType contribution requires blockType".to_owned())?;
        if block_type.is_empty() {
            return Err("blockType contribution cannot be empty".to_owned());
        }
    }
    Ok(())
}

fn validate_manifest(manifest: &Value) -> Result<(), String> {
    let object = manifest
        .as_object()
        .ok_or_else(|| "manifest must be an object".to_owned())?;
    for field in ["id", "name", "version", "minAppVersion", "main"] {
        let value = object
            .get(field)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("manifest {field} must be a string"))?;
        if value.trim().is_empty() {
            return Err(format!("manifest {field} cannot be empty"));
        }
    }
    if !is_plugin_id(object["id"].as_str().unwrap_or_default()) {
        return Err("manifest id must use reverse-DNS format".to_owned());
    }
    if !is_semver(object["version"].as_str().unwrap_or_default()) {
        return Err("manifest version must be semver".to_owned());
    }
    if !is_semver(object["minAppVersion"].as_str().unwrap_or_default()) {
        return Err("manifest minAppVersion must be semver".to_owned());
    }
    if unsafe_relative_path(object["main"].as_str().unwrap_or_default()) {
        return Err("manifest main must be a safe relative path".to_owned());
    }
    validate_permission_list(
        object.get("capabilities").unwrap_or(&Value::Null),
        "capabilities",
    )?;
    validate_permission_list(
        object.get("permissions").unwrap_or(&Value::Null),
        "permissions",
    )?;
    if let Some(description) = object.get("description") {
        if !description.is_string() {
            return Err("manifest description must be a string".to_owned());
        }
    }
    if let Some(builtin) = object.get("builtin") {
        if !builtin.is_boolean() {
            return Err("manifest builtin must be a boolean".to_owned());
        }
    }
    if let Some(contributions) = object.get("contributions") {
        let contributions = contributions
            .as_object()
            .ok_or_else(|| "contributions must be an object".to_owned())?;
        for (key, entries) in contributions {
            let kind = serde_json::from_value::<PluginContributionKind>(Value::String(key.clone()))
                .map_err(|_| format!("unknown contribution kind: {key}"))?;
            let entries = entries
                .as_array()
                .ok_or_else(|| format!("contributions {key} must be an array"))?;
            for entry in entries {
                validate_contribution(entry, kind)?;
            }
        }
    }
    if let Some(skills) = object.get("skills") {
        let skills = skills
            .as_array()
            .ok_or_else(|| "skills must be an array".to_owned())?;
        for skill in skills {
            let skill = skill
                .as_object()
                .ok_or_else(|| "skill must be an object".to_owned())?;
            let id = skill
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "skill id must be a string".to_owned())?;
            if id.is_empty() {
                return Err("skill id cannot be empty".to_owned());
            }
            for field in ["name", "description"] {
                if let Some(value) = skill.get(field) {
                    if !value.is_string() {
                        return Err(format!("skill {field} must be a string"));
                    }
                }
            }
            if let Some(params) = skill.get("params") {
                if !params.is_object() {
                    return Err("skill params must be an object".to_owned());
                }
            }
        }
    }
    Ok(())
}

/// Validates a raw manifest value against the shared TypeScript contract.
pub fn validate_manifest_value(manifest: &Value) -> Result<(), String> {
    validate_manifest(manifest)
}

fn parse_manifest_bytes(bytes: &[u8]) -> Result<(PluginManifest, Vec<u8>), String> {
    if bytes.len() > MANIFEST_LIMIT {
        return Err("manifest is too large".to_owned());
    }
    let value: Value =
        serde_json::from_slice(bytes).map_err(|error| format!("invalid manifest JSON: {error}"))?;
    validate_manifest(&value)?;
    let manifest: PluginManifest = serde_json::from_value(value)
        .map_err(|error| format!("invalid manifest structure: {error}"))?;
    Ok((manifest, bytes.to_vec()))
}

fn read_manifest_from_dir(root: &Path) -> Result<(PluginManifest, Vec<u8>), String> {
    let path = root.join(MANIFEST_FILE);
    let bytes =
        fs::read(&path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    parse_manifest_bytes(&bytes)
}

fn read_capped(path: &Path, limit: usize, label: &str) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|error| format!("cannot read {label}: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("cannot stat {label}: {error}"))?;
    if metadata.len() as usize > limit {
        return Err(format!("{label} is too large"));
    }
    let capacity = metadata.len().min(limit as u64) as usize;
    let mut bytes = Vec::with_capacity(capacity);
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("cannot read {label}: {error}"))?;
    Ok(bytes)
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    fs::write(path, bytes).map_err(|error| format!("cannot write {}: {error}", path.display()))
}

struct Sha256 {
    state: [u32; 8],
    buffer: [u8; 64],
    buffer_len: usize,
    total_len: u64,
}

impl Sha256 {
    fn new() -> Self {
        Self {
            state: [
                0x6a09_e667,
                0xbb67_ae85,
                0x3c6e_f372,
                0xa54f_f53a,
                0x510e_527f,
                0x9b05_688c,
                0x1f83_d9ab,
                0x5be0_cd19,
            ],
            buffer: [0; 64],
            buffer_len: 0,
            total_len: 0,
        }
    }

    fn update(&mut self, mut data: &[u8]) {
        self.total_len = self.total_len.wrapping_add(data.len() as u64);
        if self.buffer_len > 0 {
            let take = (64 - self.buffer_len).min(data.len());
            self.buffer[self.buffer_len..self.buffer_len + take].copy_from_slice(&data[..take]);
            self.buffer_len += take;
            data = &data[take..];
            if self.buffer_len == 64 {
                let block = self.buffer;
                self.compress(&block);
                self.buffer_len = 0;
            }
        }
        while data.len() >= 64 {
            let mut block = [0u8; 64];
            block.copy_from_slice(&data[..64]);
            self.compress(&block);
            data = &data[64..];
        }
        if !data.is_empty() {
            self.buffer[..data.len()].copy_from_slice(data);
            self.buffer_len = data.len();
        }
    }

    fn compress(&mut self, block: &[u8; 64]) {
        const K: [u32; 64] = [
            0x428a_2f98,
            0x7137_4491,
            0xb5c0_fbcf,
            0xe9b5_dba5,
            0x3956_c25b,
            0x59f1_11f1,
            0x923f_82a4,
            0xab1c_5ed5,
            0xd807_aa98,
            0x1283_5b01,
            0x2431_85be,
            0x550c_7dc3,
            0x72be_5d74,
            0x80de_b1fe,
            0x9bdc_06a7,
            0xc19b_f174,
            0xe49b_69c1,
            0xefbe_4786,
            0x0fc1_9dc6,
            0x240c_a1cc,
            0x2de9_2c6f,
            0x4a74_84aa,
            0x5cb0_a9dc,
            0x76f9_88da,
            0x983e_5152,
            0xa831_c66d,
            0xb003_27c8,
            0xbf59_7fc7,
            0xc6e0_0bf3,
            0xd5a7_9147,
            0x06ca_6351,
            0x1429_2967,
            0x27b7_0a85,
            0x2e1b_2138,
            0x4d2c_6dfc,
            0x5338_0d13,
            0x650a_7354,
            0x766a_0abb,
            0x81c2_c92e,
            0x9272_2c85,
            0xa2bf_e8a1,
            0xa81a_664b,
            0xc24b_8b70,
            0xc76c_51a3,
            0xd192_e819,
            0xd699_0624,
            0xf40e_3585,
            0x106a_a070,
            0x19a4_c116,
            0x1e37_6c08,
            0x2748_774c,
            0x34b0_bcb5,
            0x391c_0cb3,
            0x4ed8_aa4a,
            0x5b9c_ca4f,
            0x682e_6ff3,
            0x748f_82ee,
            0x78a5_636f,
            0x84c8_7814,
            0x8cc7_0208,
            0x90be_fffa,
            0xa450_6ceb,
            0xbef9_a3f7,
            0xc671_78f2,
        ];
        let mut words = [0u32; 64];
        for (index, word) in words.iter_mut().take(16).enumerate() {
            *word = u32::from_be_bytes([
                block[index * 4],
                block[index * 4 + 1],
                block[index * 4 + 2],
                block[index * 4 + 3],
            ]);
        }
        for index in 16..64 {
            let s0 = words[index - 15].rotate_right(7)
                ^ words[index - 15].rotate_right(18)
                ^ (words[index - 15] >> 3);
            let s1 = words[index - 2].rotate_right(17)
                ^ words[index - 2].rotate_right(19)
                ^ (words[index - 2] >> 10);
            words[index] = words[index - 16]
                .wrapping_add(s0)
                .wrapping_add(words[index - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = h
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[index])
                .wrapping_add(words[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        for (state, value) in self.state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *state = state.wrapping_add(value);
        }
    }

    fn finalize(mut self) -> String {
        let bit_len = self.total_len.wrapping_mul(8);
        self.update(&[0x80]);
        while self.buffer_len != 56 {
            self.update(&[0]);
        }
        self.total_len = 0;
        self.update(&bit_len.to_be_bytes());
        self.state
            .iter()
            .flat_map(|word| word.to_be_bytes())
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

fn sha256_parts(parts: &[&[u8]]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    hasher.finalize()
}

fn artifact_hash(manifest: &[u8], entry: &[u8]) -> String {
    sha256_parts(&[manifest, &[0], entry])
}

struct ZipEntry {
    name: String,
    is_dir: bool,
    data: Vec<u8>,
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16, String> {
    data.get(offset..offset + 2)
        .map(|slice| u16::from_le_bytes([slice[0], slice[1]]))
        .ok_or_else(|| "truncated ZIP".to_owned())
}

fn read_u32(data: &[u8], offset: usize) -> Result<u32, String> {
    data.get(offset..offset + 4)
        .map(|slice| u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
        .ok_or_else(|| "truncated ZIP".to_owned())
}

struct BitReader<'a> {
    data: &'a [u8],
    position: usize,
}

impl<'a> BitReader<'a> {
    fn read_bit(&mut self) -> Result<u32, String> {
        let byte = self
            .data
            .get(self.position / 8)
            .copied()
            .ok_or_else(|| "truncated deflate stream".to_owned())?;
        let bit = u32::from((byte >> (self.position % 8)) & 1);
        self.position += 1;
        Ok(bit)
    }

    fn read_bits(&mut self, count: u32) -> Result<u32, String> {
        let mut value = 0;
        for bit in 0..count {
            value |= self.read_bit()? << bit;
        }
        Ok(value)
    }

    fn align_byte(&mut self) {
        self.position = self.position.div_ceil(8) * 8;
    }
}

struct Huffman {
    counts: [u16; 16],
    symbols: Vec<u16>,
}

fn build_huffman(lengths: &[u8]) -> Result<Huffman, String> {
    let mut counts = [0u16; 16];
    for &length in lengths {
        if length > 15 {
            return Err("invalid Huffman length".to_owned());
        }
        counts[length as usize] += 1;
    }
    if counts[0] == lengths.len() as u16 {
        return Err("empty Huffman table".to_owned());
    }
    let mut next_code = [0u16; 16];
    for bits in 1..15 {
        next_code[bits + 1] = (next_code[bits] + counts[bits]) << 1;
    }
    let mut symbols = vec![0u16; lengths.len()];
    for (symbol, &length) in lengths.iter().enumerate() {
        if length != 0 {
            let code = next_code[length as usize];
            if code as usize >= symbols.len() {
                return Err("invalid Huffman table".to_owned());
            }
            symbols[code as usize] = symbol as u16;
            next_code[length as usize] += 1;
        }
    }
    Ok(Huffman { counts, symbols })
}

fn decode_huffman(reader: &mut BitReader, table: &Huffman) -> Result<u16, String> {
    let mut code = 0usize;
    let mut first = 0usize;
    let mut index = 0usize;
    for length in 1..16 {
        code |= reader.read_bit()? as usize;
        let count = table.counts[length] as usize;
        if code < first.wrapping_add(count) {
            return table
                .symbols
                .get(index + code - first)
                .copied()
                .ok_or_else(|| "invalid Huffman symbol".to_owned());
        }
        index += count;
        first = (first + count) << 1;
        code <<= 1;
    }
    Err("invalid Huffman code".to_owned())
}

fn fixed_huffman_tables() -> Result<(Huffman, Huffman), String> {
    let mut literal_lengths = [0u8; 288];
    for (symbol, length) in literal_lengths.iter_mut().enumerate() {
        *length = match symbol {
            0..=143 => 8,
            144..=255 => 9,
            256..=279 => 7,
            _ => 8,
        };
    }
    Ok((build_huffman(&literal_lengths)?, build_huffman(&[5u8; 30])?))
}

fn inflate_raw(data: &[u8], max_output: usize) -> Result<Vec<u8>, String> {
    let mut reader = BitReader { data, position: 0 };
    let mut output = Vec::new();
    loop {
        let final_block = reader.read_bit()? == 1;
        match reader.read_bits(2)? {
            0 => {
                reader.align_byte();
                let byte_position = reader.position / 8;
                let len = read_u16(data, byte_position)? as usize;
                let nlen = read_u16(data, byte_position + 2)? as usize;
                if len != (!nlen & 0xffff) {
                    return Err("invalid stored block length".to_owned());
                }
                let start = byte_position + 4;
                let end = start + len;
                let chunk = data
                    .get(start..end)
                    .ok_or_else(|| "truncated stored block".to_owned())?;
                if output.len() + chunk.len() > max_output {
                    return Err("inflate output exceeds limit".to_owned());
                }
                output.extend_from_slice(chunk);
                reader.position = end * 8;
            }
            block_type @ (1 | 2) => {
                let (literal_table, distance_table) = if block_type == 1 {
                    fixed_huffman_tables()?
                } else {
                    let hlit = reader.read_bits(5)? as usize + 257;
                    let hdist = reader.read_bits(5)? as usize + 1;
                    let hclen = reader.read_bits(4)? as usize + 4;
                    const ORDER: [usize; 19] = [
                        16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
                    ];
                    let mut code_lengths = [0u8; 19];
                    for &index in ORDER.iter().take(hclen) {
                        code_lengths[index] = reader.read_bits(3)? as u8;
                    }
                    let code_table = build_huffman(&code_lengths)?;
                    let mut lengths = vec![0u8; hlit + hdist];
                    let mut index = 0;
                    while index < lengths.len() {
                        let symbol = decode_huffman(&mut reader, &code_table)?;
                        match symbol {
                            0..=15 => {
                                lengths[index] = symbol as u8;
                                index += 1;
                            }
                            16 => {
                                if index == 0 {
                                    return Err("invalid repeat with no previous length".to_owned());
                                }
                                let previous = lengths[index - 1];
                                let repeat = 3 + reader.read_bits(2)? as usize;
                                if index + repeat > lengths.len() {
                                    return Err("invalid code length repeat".to_owned());
                                }
                                for _ in 0..repeat {
                                    lengths[index] = previous;
                                    index += 1;
                                }
                            }
                            17 | 18 => {
                                let zeros = if symbol == 17 {
                                    3 + reader.read_bits(3)? as usize
                                } else {
                                    11 + reader.read_bits(7)? as usize
                                };
                                if index + zeros > lengths.len() {
                                    return Err("invalid zero repeat".to_owned());
                                }
                                index += zeros;
                            }
                            _ => return Err("invalid code length symbol".to_owned()),
                        }
                    }
                    (
                        build_huffman(&lengths[..hlit])?,
                        build_huffman(&lengths[hlit..])?,
                    )
                };

                const LENGTH_BASE: [u16; 29] = [
                    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
                    83, 99, 115, 131, 163, 195, 227, 258,
                ];
                const LENGTH_EXTRA: [u8; 29] = [
                    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
                    5, 5, 0,
                ];
                const DISTANCE_BASE: [u16; 30] = [
                    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
                    1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
                ];
                const DISTANCE_EXTRA: [u8; 30] = [
                    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
                    11, 12, 12, 13, 13,
                ];

                loop {
                    let symbol = decode_huffman(&mut reader, &literal_table)?;
                    if symbol < 256 {
                        if output.len() >= max_output {
                            return Err("inflate output exceeds limit".to_owned());
                        }
                        output.push(symbol as u8);
                    } else if symbol == 256 {
                        break;
                    } else {
                        let length_index = symbol as usize - 257;
                        if length_index >= LENGTH_BASE.len() {
                            return Err("invalid length symbol".to_owned());
                        }
                        let length = LENGTH_BASE[length_index] as usize
                            + reader.read_bits(LENGTH_EXTRA[length_index] as u32)? as usize;
                        let distance_symbol = decode_huffman(&mut reader, &distance_table)?;
                        if distance_symbol as usize >= DISTANCE_BASE.len() {
                            return Err("invalid distance symbol".to_owned());
                        }
                        let distance = DISTANCE_BASE[distance_symbol as usize] as usize
                            + reader.read_bits(DISTANCE_EXTRA[distance_symbol as usize] as u32)?
                                as usize;
                        if distance > output.len() {
                            return Err("invalid deflate distance".to_owned());
                        }
                        if output.len() + length > max_output {
                            return Err("inflate output exceeds limit".to_owned());
                        }
                        let start = output.len() - distance;
                        for offset in 0..length {
                            let byte = output[start + offset];
                            output.push(byte);
                        }
                    }
                }
            }
            _ => return Err("invalid deflate block type".to_owned()),
        }
        if final_block {
            break;
        }
    }
    Ok(output)
}

fn clean_zip_name(name: &str) -> String {
    name.replace('\\', "/").trim_start_matches("./").to_owned()
}

fn strip_zip_wrapper(names: &[String]) -> Vec<String> {
    let cleaned: Vec<String> = names.iter().map(|name| clean_zip_name(name)).collect();
    let mut tops = HashSet::new();
    for name in &cleaned {
        if let Some((top, rest)) = name.split_once('/') {
            if !top.is_empty() && !rest.is_empty() {
                tops.insert(top.to_owned());
            }
        }
    }
    if tops.len() == 1 {
        let wrapper = format!("{}/", tops.iter().next().unwrap());
        cleaned
            .into_iter()
            .map(|name| name.strip_prefix(&wrapper).unwrap_or(&name).to_owned())
            .collect()
    } else {
        cleaned
    }
}

fn validate_zip_entry_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('/') || name.split('/').any(|part| part == "..") {
        return Err("unsafe ZIP path".to_owned());
    }
    Ok(())
}

fn parse_zip(data: &[u8]) -> Result<Vec<ZipEntry>, String> {
    if data.len() < 22 {
        return Err("invalid ZIP".to_owned());
    }
    let mut eocd = None;
    let min = data.len().saturating_sub(65557);
    for index in (min..=data.len() - 22).rev() {
        if read_u32(data, index)? == 0x0605_4b50 {
            eocd = Some(index);
            break;
        }
    }
    let eocd = eocd.ok_or_else(|| "invalid ZIP".to_owned())?;
    let total = read_u16(data, eocd + 10)? as usize;
    if total == 0 {
        return Err("empty ZIP".to_owned());
    }
    if total > ZIP_ENTRY_LIMIT {
        return Err("ZIP has too many entries".to_owned());
    }
    let mut offset = read_u32(data, eocd + 16)? as usize;
    let mut records = Vec::with_capacity(total);
    for _ in 0..total {
        if read_u32(data, offset)? != 0x0201_4b50 {
            return Err("invalid ZIP central directory".to_owned());
        }
        let method = read_u16(data, offset + 10)?;
        let compressed_size = read_u32(data, offset + 20)? as usize;
        let uncompressed_size = read_u32(data, offset + 24)? as usize;
        let name_len = read_u16(data, offset + 28)? as usize;
        let extra_len = read_u16(data, offset + 30)? as usize;
        let comment_len = read_u16(data, offset + 32)? as usize;
        let local_offset = read_u32(data, offset + 42)? as usize;
        let external_attr = read_u32(data, offset + 38)?;
        let name_start = offset + 46;
        let name_end = name_start + name_len;
        let raw_name = data
            .get(name_start..name_end)
            .ok_or_else(|| "truncated ZIP name".to_owned())?;
        records.push((
            String::from_utf8_lossy(raw_name).into_owned(),
            method,
            compressed_size,
            uncompressed_size,
            local_offset,
            external_attr,
        ));
        offset = name_end + extra_len + comment_len;
    }

    let names: Vec<String> = records.iter().map(|(name, ..)| name.clone()).collect();
    let normalized_names = strip_zip_wrapper(&names);
    let mut entries = Vec::with_capacity(records.len());
    let mut total_output = 0usize;
    for (record, normalized) in records.into_iter().zip(normalized_names) {
        let (raw_name, method, compressed_size, uncompressed_size, local_offset, external_attr) =
            record;
        let is_dir = raw_name.ends_with('/')
            || normalized.ends_with('/')
            || ((external_attr >> 16) & 0x10) != 0;
        if !is_dir {
            validate_zip_entry_name(&normalized)?;
        }
        if is_dir {
            entries.push(ZipEntry {
                name: normalized,
                is_dir: true,
                data: Vec::new(),
            });
            continue;
        }
        if uncompressed_size > ZIP_ENTRY_LIMIT_BYTES {
            return Err("ZIP entry is too large".to_owned());
        }
        if read_u32(data, local_offset)? != 0x0403_4b50 {
            return Err("invalid ZIP local header".to_owned());
        }
        let local_name_len = read_u16(data, local_offset + 26)? as usize;
        let local_extra_len = read_u16(data, local_offset + 28)? as usize;
        let start = local_offset + 30 + local_name_len + local_extra_len;
        let end = start + compressed_size;
        let compressed = data
            .get(start..end)
            .ok_or_else(|| "truncated ZIP data".to_owned())?;
        let file_data = match method {
            0 => compressed.to_vec(),
            8 => inflate_raw(compressed, ZIP_ENTRY_LIMIT_BYTES)?,
            other => return Err(format!("unsupported ZIP compression method: {other}")),
        };
        if file_data.len() > ZIP_ENTRY_LIMIT_BYTES {
            return Err("ZIP entry is too large".to_owned());
        }
        total_output += file_data.len();
        if total_output > ARTIFACT_LIMIT {
            return Err("ZIP exceeds the total size limit".to_owned());
        }
        entries.push(ZipEntry {
            name: normalized,
            is_dir: false,
            data: file_data,
        });
    }
    Ok(entries)
}

fn zip_entry<'a>(entries: &'a [ZipEntry], name: &str) -> Option<&'a ZipEntry> {
    entries
        .iter()
        .find(|entry| !entry.is_dir && entry.name == name)
}

impl PluginStore {
    pub fn new(
        state_file: Option<PathBuf>,
        plugins_root: Option<PathBuf>,
        host_version: &str,
    ) -> Self {
        let mut store = Self {
            state_file,
            plugins_root,
            host_version: host_version.to_owned(),
            ..Default::default()
        };
        store.restore();
        store
    }

    fn require_root(&self) -> Result<&Path, String> {
        self.plugins_root
            .as_deref()
            .ok_or_else(|| "plugin root is not configured".to_owned())
    }

    fn plugin_dir(&self, plugin_id: &str) -> Result<PathBuf, String> {
        if plugin_id.is_empty()
            || plugin_id.contains(['/', '\\'])
            || plugin_id == "."
            || plugin_id == ".."
        {
            return Err("invalid plugin id".to_owned());
        }
        Ok(self.require_root()?.join(plugin_id))
    }

    fn audit(
        &mut self,
        plugin_id: &str,
        operation: &str,
        permission: Option<PluginPermission>,
        allowed: bool,
        detail: Option<&str>,
    ) {
        self.audit.push(PluginAuditRecord {
            id: new_secret(),
            plugin_id: plugin_id.to_owned(),
            operation: operation.to_owned(),
            permission,
            allowed,
            detail: detail.map(str::to_owned),
            at: now_ms(),
        });
        if self.audit.len() > MAX_AUDIT {
            let excess = self.audit.len() - MAX_AUDIT;
            self.audit.drain(0..excess);
        }
    }

    fn require(&self, plugin_id: &str) -> Result<&PluginRecord, String> {
        self.plugins
            .get(plugin_id)
            .ok_or_else(|| format!("plugin not found: {plugin_id}"))
    }

    fn require_mut(&mut self, plugin_id: &str) -> Result<&mut PluginRecord, String> {
        self.plugins
            .get_mut(plugin_id)
            .ok_or_else(|| format!("plugin not found: {plugin_id}"))
    }

    fn view(record: &PluginRecord) -> PluginView {
        let mut grants = record
            .manifest
            .permissions
            .iter()
            .map(|permission| {
                let state = record
                    .grants
                    .get(permission)
                    .cloned()
                    .unwrap_or(GrantState {
                        granted: false,
                        always_allow: false,
                    });
                PluginPermissionGrant {
                    permission: *permission,
                    granted: state.granted,
                    always_allow: state.always_allow,
                }
            })
            .collect::<Vec<_>>();
        grants.sort_by_key(|grant| grant.permission as u8);
        PluginView {
            id: record.manifest.id.clone(),
            name: record.manifest.name.clone(),
            version: record.manifest.version.clone(),
            description: record.manifest.description.clone(),
            builtin: record.manifest.builtin,
            state: record.state,
            permissions: record.manifest.permissions.clone(),
            grants,
            contribution_counts: record
                .manifest
                .contributions
                .as_ref()
                .map(|contributions| {
                    contributions
                        .iter()
                        .map(|(kind, entries)| (*kind, entries.len()))
                        .collect()
                })
                .unwrap_or_default(),
            last_error: record.last_error.clone(),
        }
    }

    fn persist(&self) -> Result<(), String> {
        let Some(state_file) = self.state_file.as_ref() else {
            return Ok(());
        };
        let mut plugins = self
            .plugins
            .iter()
            .map(|(id, record)| PersistedPlugin {
                id: id.clone(),
                source: record.source.clone(),
                enabled: record.enabled,
                grants: record.grants.clone(),
            })
            .collect::<Vec<_>>();
        plugins.sort_by(|left, right| left.id.cmp(&right.id));
        let state = PersistedState {
            version: STATE_VERSION,
            plugins,
        };
        let bytes = serde_json::to_vec_pretty(&state)
            .map_err(|error| format!("cannot encode plugin state: {error}"))?;
        if let Some(parent) = state_file.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
        }
        let temporary = state_file.with_extension("json.tmp");
        {
            let mut file = File::create(&temporary)
                .map_err(|error| format!("cannot create {}: {error}", temporary.display()))?;
            file.write_all(&bytes)
                .and_then(|_| file.flush())
                .map_err(|error| format!("cannot write {}: {error}", temporary.display()))?;
        }
        fs::rename(&temporary, state_file)
            .map_err(|error| format!("cannot replace {}: {error}", state_file.display()))
    }

    fn restore(&mut self) {
        let Some(state_file) = self.state_file.clone() else {
            return;
        };
        let Ok(bytes) = fs::read(state_file) else {
            return;
        };
        let Ok(state) = serde_json::from_slice::<PersistedState>(&bytes) else {
            self.audit(
                "system",
                "state.restore",
                None,
                false,
                Some("invalid state file"),
            );
            return;
        };
        if state.version != STATE_VERSION {
            self.audit(
                "system",
                "state.restore",
                None,
                false,
                Some("unsupported state version"),
            );
            return;
        }
        for persisted in state.plugins {
            let Ok(dir) = self.plugin_dir(&persisted.id) else {
                continue;
            };
            let Ok((manifest, _)) = read_manifest_from_dir(&dir) else {
                continue;
            };
            self.plugins.insert(
                persisted.id.clone(),
                PluginRecord {
                    manifest,
                    source: persisted.source,
                    enabled: persisted.enabled,
                    grants: persisted.grants,
                    state: if persisted.enabled {
                        PluginRuntimeState::Active
                    } else {
                        PluginRuntimeState::Disabled
                    },
                    last_error: None,
                },
            );
        }
    }

    pub fn list(&self) -> Vec<PluginView> {
        let mut views = self.plugins.values().map(Self::view).collect::<Vec<_>>();
        views.sort_by(|left, right| left.id.cmp(&right.id));
        views
    }

    pub fn set_enabled(&mut self, plugin_id: &str, enabled: bool) -> Result<PluginView, String> {
        let record = self.require_mut(plugin_id)?;
        record.enabled = enabled;
        record.state = if enabled {
            PluginRuntimeState::Active
        } else {
            PluginRuntimeState::Disabled
        };
        let view = Self::view(record);
        self.persist()?;
        Ok(view)
    }

    pub fn uninstall(&mut self, plugin_id: &str) -> Result<(), String> {
        let dir = self.plugin_dir(plugin_id)?;
        if self.require(plugin_id)?.manifest.builtin == Some(true) {
            return Err("built-in plugins cannot be uninstalled".to_owned());
        }
        if self.plugins.remove(plugin_id).is_none() {
            return Err(format!("plugin not found: {plugin_id}"));
        }
        remove_dir_if_exists(&dir)?;
        self.audit(plugin_id, "install.uninstall", None, true, None);
        self.persist()
    }

    pub fn install_preview(&mut self, source_path: &Path) -> Result<PluginInstallTicket, String> {
        if !source_path.is_absolute() {
            return Err("plugin source path must be absolute".to_owned());
        }
        let root = self.require_root()?.to_path_buf();
        fs::create_dir_all(&root)
            .map_err(|error| format!("cannot create {}: {error}", root.display()))?;
        let metadata = fs::metadata(source_path)
            .map_err(|error| format!("cannot access plugin source: {error}"))?;
        let source = if metadata.is_dir() {
            PluginSource::Directory
        } else if source_path.extension().and_then(|value| value.to_str()) == Some("zip") {
            PluginSource::Zip
        } else {
            return Err("plugin source must be a directory or .zip file".to_owned());
        };
        let ticket = new_secret();
        let staging = root.join(&ticket);
        if staging.exists() {
            fs::remove_dir_all(&staging)
                .map_err(|error| format!("cannot reset staging: {error}"))?;
        }
        fs::create_dir_all(&staging).map_err(|error| format!("cannot create staging: {error}"))?;
        match self.create_stage(source_path, &staging, source, &ticket) {
            Ok(stage) => {
                let result = PluginInstallTicket {
                    ticket: stage.ticket.clone(),
                    artifact_hash: stage.artifact_hash.clone(),
                    source: stage.source,
                    manifest: stage.manifest.clone(),
                    requested_permissions: stage.requested_permissions.clone(),
                };
                self.tickets.insert(stage.ticket.clone(), stage);
                self.audit(&result.manifest.id, "install.preview", None, true, None);
                Ok(result)
            }
            Err(error) => {
                let _ = fs::remove_dir_all(&staging);
                Err(error)
            }
        }
    }

    fn create_stage(
        &self,
        source_path: &Path,
        staging: &Path,
        source: PluginSource,
        ticket: &str,
    ) -> Result<Stage, String> {
        let (manifest, manifest_raw, entry, main_rel) = match source {
            PluginSource::Directory => {
                let manifest_path = source_path.join(MANIFEST_FILE);
                let raw = read_capped(&manifest_path, MANIFEST_LIMIT, "manifest")?;
                let (manifest, raw) = parse_manifest_bytes(&raw)?;
                let main_rel = normalized_path(&manifest.main);
                let entry_path = safe_join(source_path, &manifest.main)?;
                let entry = read_capped(&entry_path, ARTIFACT_LIMIT, "plugin entry")?;
                write_file(&staging.join(MANIFEST_FILE), &raw)?;
                write_file(&staging.join(&main_rel), &entry)?;
                (manifest, raw, entry, main_rel)
            }
            PluginSource::Zip => {
                let bytes = read_capped(source_path, ARTIFACT_LIMIT, "plugin archive")?;
                let entries = parse_zip(&bytes)?;
                let manifest_entry = zip_entry(&entries, MANIFEST_FILE)
                    .ok_or_else(|| "manifest.json missing from ZIP".to_owned())?;
                let (manifest, raw) = parse_manifest_bytes(&manifest_entry.data)?;
                let main_rel = normalized_path(&manifest.main);
                let entry = zip_entry(&entries, &main_rel)
                    .ok_or_else(|| "plugin entry missing from ZIP".to_owned())?
                    .data
                    .clone();
                write_file(&staging.join("source.zip"), &bytes)?;
                (manifest, raw, entry, main_rel)
            }
        };
        let requested_permissions = manifest.permissions.clone();
        Ok(Stage {
            ticket: ticket.to_owned(),
            artifact_hash: artifact_hash(&manifest_raw, &entry),
            staging_path: staging.to_path_buf(),
            source,
            manifest,
            main_rel,
            requested_permissions,
            created_at: now_ms(),
        })
    }

    pub fn confirm_install(&mut self, ticket: &str, accept: bool) -> Result<PluginView, String> {
        let stage = self
            .tickets
            .remove(ticket)
            .ok_or_else(|| "install ticket not found".to_owned())?;
        if now_ms() > stage.created_at.saturating_add(TICKET_TTL_MS) {
            let _ = fs::remove_dir_all(&stage.staging_path);
            return Err("install ticket expired".to_owned());
        }
        if !accept {
            let _ = fs::remove_dir_all(&stage.staging_path);
            self.audit(
                &stage.manifest.id,
                "install.reject",
                None,
                false,
                Some("user declined"),
            );
            return Err("plugin installation was not accepted".to_owned());
        }
        let (manifest, manifest_raw, entry) = match stage.source {
            PluginSource::Directory => {
                let manifest_path = stage.staging_path.join(MANIFEST_FILE);
                let raw = read_capped(&manifest_path, MANIFEST_LIMIT, "staged manifest")?;
                let entry_path = safe_join(&stage.staging_path, &stage.main_rel)?;
                let entry = read_capped(&entry_path, ARTIFACT_LIMIT, "staged plugin entry")?;
                let (manifest, raw) = parse_manifest_bytes(&raw)?;
                (manifest, raw, entry)
            }
            PluginSource::Zip => {
                let archive = read_capped(
                    &stage.staging_path.join("source.zip"),
                    ARTIFACT_LIMIT,
                    "staged plugin archive",
                )?;
                let entries = parse_zip(&archive)?;
                let manifest_entry = zip_entry(&entries, MANIFEST_FILE)
                    .ok_or_else(|| "manifest.json missing from ZIP".to_owned())?;
                let (manifest, raw) = parse_manifest_bytes(&manifest_entry.data)?;
                let main_rel = normalized_path(&manifest.main);
                let entry = zip_entry(&entries, &main_rel)
                    .ok_or_else(|| "plugin entry missing from ZIP".to_owned())?
                    .data
                    .clone();
                (manifest, raw, entry)
            }
        };
        if artifact_hash(&manifest_raw, &entry) != stage.artifact_hash {
            let _ = fs::remove_dir_all(&stage.staging_path);
            self.audit(
                &manifest.id,
                "install.confirm",
                None,
                false,
                Some("artifact changed"),
            );
            return Err("plugin artifact changed after preview".to_owned());
        }
        if self.plugins.contains_key(&manifest.id) {
            let _ = fs::remove_dir_all(&stage.staging_path);
            return Err(format!("plugin is already installed: {}", manifest.id));
        }
        let plugin_dir = self.plugin_dir(&manifest.id)?;
        fs::create_dir_all(&plugin_dir)
            .map_err(|error| format!("cannot create {}: {error}", plugin_dir.display()))?;
        let write_result = write_file(&plugin_dir.join(MANIFEST_FILE), &manifest_raw)
            .and_then(|_| write_file(&plugin_dir.join(&stage.main_rel), &entry));
        if let Err(error) = write_result {
            let _ = fs::remove_dir_all(&plugin_dir);
            let _ = fs::remove_dir_all(&stage.staging_path);
            return Err(error);
        }
        let _ = fs::remove_dir_all(&stage.staging_path);
        let mut grants = HashMap::new();
        for permission in DEFAULT_GRANTS {
            let permission = PluginPermission::parse(permission)?;
            if manifest.permissions.contains(&permission) {
                grants.insert(
                    permission,
                    GrantState {
                        granted: true,
                        always_allow: true,
                    },
                );
            }
        }
        let record = PluginRecord {
            manifest: manifest.clone(),
            source: SourceRef {
                kind: stage.source,
                path: plugin_dir.display().to_string(),
            },
            enabled: true,
            grants,
            state: PluginRuntimeState::Active,
            last_error: None,
        };
        let view = Self::view(&record);
        self.plugins.insert(manifest.id.clone(), record);
        self.audit(&manifest.id, "install.confirm", None, true, None);
        self.persist()?;
        Ok(view)
    }

    pub fn grant_permission(
        &mut self,
        plugin_id: &str,
        permission: &str,
    ) -> Result<PluginView, String> {
        let permission = PluginPermission::parse(permission)?;
        let record = self.require_mut(plugin_id)?;
        if !record.manifest.permissions.contains(&permission) {
            return Err("permission is not declared by the plugin".to_owned());
        }
        record.grants.insert(
            permission,
            GrantState {
                granted: true,
                always_allow: true,
            },
        );
        let view = Self::view(record);
        self.audit(plugin_id, "permission.grant", Some(permission), true, None);
        self.persist()?;
        Ok(view)
    }

    pub fn revoke_permission(
        &mut self,
        plugin_id: &str,
        permission: &str,
    ) -> Result<PluginView, String> {
        let permission = PluginPermission::parse(permission)?;
        let record = self.require_mut(plugin_id)?;
        if !record.manifest.permissions.contains(&permission) {
            return Err("permission is not declared by the plugin".to_owned());
        }
        record.grants.insert(
            permission,
            GrantState {
                granted: false,
                always_allow: false,
            },
        );
        let view = Self::view(record);
        self.audit(plugin_id, "permission.revoke", Some(permission), true, None);
        self.persist()?;
        Ok(view)
    }

    pub fn begin_session(&mut self, plugin_id: &str) -> Result<PluginSessionToken, String> {
        let record = self.require(plugin_id)?;
        if !record.enabled || record.state != PluginRuntimeState::Active {
            return Err("plugin is not active".to_owned());
        }
        let session_id = format!("session_{}", &new_secret()[..16]);
        let token = format!("token_{}", new_secret());
        let issued_at = now_ms();
        let expires_at = issued_at.saturating_add(SESSION_TTL_MS);
        self.sessions.insert(
            session_id.clone(),
            AuthSession {
                session_id: session_id.clone(),
                plugin_id: plugin_id.to_owned(),
                token: token.clone(),
                expires_at,
            },
        );
        Ok(PluginSessionToken {
            token,
            plugin_id: plugin_id.to_owned(),
            session_id,
            issued_at,
            expires_at,
        })
    }

    pub fn close_session(&mut self, token: &str) -> Result<(), String> {
        let session_id = self
            .sessions
            .values()
            .find(|session| session.token == token)
            .map(|session| session.session_id.clone())
            .ok_or_else(|| "session not found".to_owned())?;
        self.sessions.remove(&session_id);
        Ok(())
    }

    pub fn begin_auth_challenge(
        &mut self,
        plugin_id: &str,
        permission: &str,
    ) -> Result<PluginAuthChallenge, String> {
        let permission = PluginPermission::parse(permission)?;
        self.require(plugin_id)?;
        let challenge = new_secret();
        let request_id = new_secret();
        let issued_at = now_ms();
        let expires_at = issued_at.saturating_add(CHALLENGE_TTL_MS);
        let request = json!({
            "apiVersion": PLUGIN_API_VERSION,
            "id": request_id.clone(),
            "method": "permission.request",
            "params": { "permission": permission }
        });
        let record = PluginAuthChallenge {
            challenge: challenge.clone(),
            plugin_id: plugin_id.to_owned(),
            permission,
            request,
            session_id: String::new(),
            request_id,
            issued_at,
            expires_at,
        };
        self.challenges.insert(challenge, record.clone());
        Ok(record)
    }

    pub fn reject_auth_challenge(&mut self, challenge: &str) -> Result<(), String> {
        self.challenges
            .remove(challenge)
            .map(|_| ())
            .ok_or_else(|| "challenge not found or already expired".to_owned())
    }

    pub fn run_command(
        &mut self,
        plugin_id: &str,
        command_id: &str,
        payload: Value,
    ) -> Result<PluginCommandAck, String> {
        self.require(plugin_id)?;
        if command_id.is_empty() {
            return Err("command id cannot be empty".to_owned());
        }
        self.audit(plugin_id, "command.run", None, true, Some(command_id));
        Ok(PluginCommandAck {
            command_id: command_id.to_owned(),
            plugin_id: plugin_id.to_owned(),
            payload,
            registered: true,
        })
    }

    pub fn get_runtime_source(&self, plugin_id: &str) -> Result<String, String> {
        let record = self.require(plugin_id)?;
        let dir = self.plugin_dir(plugin_id)?;
        let entry = safe_join(&dir, &record.manifest.main)?;
        let bytes = read_capped(&entry, ARTIFACT_LIMIT, "plugin entry")?;
        String::from_utf8(bytes).map_err(|_| "plugin entry is not UTF-8".to_owned())
    }

    pub fn list_audit_log(&self, plugin_id: Option<&str>, limit: usize) -> Vec<PluginAuditRecord> {
        if limit == 0 {
            return Vec::new();
        }
        self.audit
            .iter()
            .filter(|record| plugin_id.is_none_or(|id| record.plugin_id == id))
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }

    /// Command palette entries contributed by all loaded plugins, matching
    /// the Electron `listCommands()` contract.
    pub fn list_commands(&self) -> Vec<Value> {
        let mut commands = Vec::new();
        for record in self.plugins.values() {
            let Some(contributions) = record.manifest.contributions.as_ref() else {
                continue;
            };
            let Some(entries) = contributions.get(&PluginContributionKind::Commands) else {
                continue;
            };
            for entry in entries {
                commands.push(json!({
                    "id": entry.id,
                    "pluginId": record.manifest.id,
                    "title": entry.title,
                    "keywords": entry.keywords,
                }));
            }
        }
        commands
    }

    /// All contributions from active plugins, scoped by plugin id — the
    /// Electron `listContributions()` contract.
    pub fn list_contributions(&self) -> Vec<Value> {
        let mut contributions = Vec::new();
        for record in self.plugins.values() {
            if record.state != PluginRuntimeState::Active {
                continue;
            }
            let Some(by_kind) = record.manifest.contributions.as_ref() else {
                continue;
            };
            for (kind, entries) in by_kind {
                let kind_str = match kind {
                    PluginContributionKind::Commands => "commands",
                    PluginContributionKind::Menus => "menus",
                    PluginContributionKind::Views => "views",
                    PluginContributionKind::BlockTypes => "blockTypes",
                };
                for entry in entries {
                    let mut view = serde_json::to_value(entry).unwrap_or(Value::Null);
                    if let Some(object) = view.as_object_mut() {
                        object.insert(
                            "scopedId".to_owned(),
                            json!(format!("{}:{}", record.manifest.id, entry.id)),
                        );
                        object.insert("pluginId".to_owned(), json!(record.manifest.id));
                        object.insert("kind".to_owned(), json!(kind_str));
                    }
                    contributions.push(view);
                }
            }
        }
        contributions
    }
}

fn remove_dir_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("cannot remove {}: {error}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "nexnote-plugin-test-{}-{}-{label}",
            std::process::id(),
            new_secret()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_manifest(source: &Path, main: &str, permissions: &[&str]) {
        let permissions = permissions
            .iter()
            .map(|permission| format!("\"{permission}\""))
            .collect::<Vec<_>>()
            .join(",");
        fs::create_dir_all(source).unwrap();
        fs::write(
            source.join(MANIFEST_FILE),
            format!(
                r#"{{"id":"com.nexnote.test","name":"Test","version":"1.0.0","minAppVersion":"0.1.0","main":"{main}","description":"test","capabilities":[{permissions}],"permissions":[{permissions}]}}"#
            ),
        )
        .unwrap();
    }

    fn valid_manifest_value() -> Value {
        json!({
            "id": "com.nexnote.example",
            "name": "Example",
            "version": "1.2.3",
            "minAppVersion": "0.1.0",
            "main": "main.js",
            "capabilities": ["read", "edit"],
            "permissions": ["read", "edit", "network"],
            "contributions": {
                "commands": [{ "id": "hello", "title": "Hello" }],
                "views": [{ "id": "panel", "title": "Panel", "placement": "sidebar" }],
                "blockTypes": [{ "id": "demo", "title": "Demo", "blockType": "demo_block" }]
            },
            "skills": [{ "id": "search", "name": "Search", "params": { "limit": 5 } }]
        })
    }

    #[test]
    fn validates_manifest_contract() {
        assert!(validate_manifest_value(&valid_manifest_value()).is_ok());
        let mut invalid = valid_manifest_value();
        invalid["main"] = json!("../main.js");
        assert!(validate_manifest_value(&invalid).is_err());
        let mut invalid = valid_manifest_value();
        invalid["capabilities"] = json!(["not-a-permission"]);
        assert!(validate_manifest_value(&invalid).is_err());
        let mut invalid = valid_manifest_value();
        invalid["version"] = json!("1.0");
        assert!(validate_manifest_value(&invalid).is_err());
    }

    #[test]
    fn serializes_permissions_using_shared_union_names() {
        let value = json!({
            "id": "com.nexnote.example",
            "name": "Example",
            "version": "1.2.3",
            "minAppVersion": "0.1.0",
            "main": "main.js",
            "capabilities": ["external-command", "desktop-privileged"],
            "permissions": ["external-command", "desktop-privileged"]
        });
        validate_manifest_value(&value).unwrap();
        let manifest: PluginManifest = serde_json::from_value(value).unwrap();
        let serialized = serde_json::to_value(&manifest).unwrap();
        assert_eq!(serialized["capabilities"][0], "external-command");
        assert_eq!(serialized["capabilities"][1], "desktop-privileged");
        assert_eq!(serialized["minAppVersion"], "0.1.0");
    }

    #[test]
    fn installs_and_lists_plugin_without_internal_paths() {
        let root = temp_root("install");
        let source = root.join("source");
        write_manifest(&source, "main.js", &["read", "edit", "network"]);
        fs::write(source.join("main.js"), "export const hello = 'world';").unwrap();
        let mut store = PluginStore::new(
            Some(root.join("nexnote-plugins.json")),
            Some(root.join("plugins")),
            "0.1.0",
        );
        let ticket = store.install_preview(&source).unwrap();
        assert_eq!(ticket.manifest.id, "com.nexnote.test");
        assert_eq!(ticket.requested_permissions.len(), 3);
        let view = store.confirm_install(&ticket.ticket, true).unwrap();
        assert_eq!(view.id, "com.nexnote.test");
        assert_eq!(view.state, PluginRuntimeState::Active);
        let views = store.list();
        assert_eq!(views.len(), 1);
        assert!(!serde_json::to_string(&views[0])
            .unwrap()
            .contains("plugins"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn supports_enable_disable_and_uninstall() {
        let root = temp_root("lifecycle");
        let source = root.join("source");
        write_manifest(&source, "main.js", &["read", "edit"]);
        fs::write(source.join("main.js"), "console.log('test')").unwrap();
        let mut store = PluginStore::new(
            Some(root.join("nexnote-plugins.json")),
            Some(root.join("plugins")),
            "0.1.0",
        );
        let ticket = store.install_preview(&source).unwrap();
        store.confirm_install(&ticket.ticket, true).unwrap();
        let disabled = store.set_enabled("com.nexnote.test", false).unwrap();
        assert_eq!(disabled.state, PluginRuntimeState::Disabled);
        let enabled = store.set_enabled("com.nexnote.test", true).unwrap();
        assert_eq!(enabled.state, PluginRuntimeState::Active);
        store.uninstall("com.nexnote.test").unwrap();
        assert!(store.list().is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn grants_revokes_and_audits_permissions() {
        let root = temp_root("permissions");
        let source = root.join("source");
        write_manifest(&source, "main.js", &["read", "edit", "network"]);
        fs::write(source.join("main.js"), "console.log('permission')").unwrap();
        let mut store = PluginStore::new(
            Some(root.join("nexnote-plugins.json")),
            Some(root.join("plugins")),
            "0.1.0",
        );
        let ticket = store.install_preview(&source).unwrap();
        store.confirm_install(&ticket.ticket, true).unwrap();
        let view = store
            .grant_permission("com.nexnote.test", "network")
            .unwrap();
        let network = view
            .grants
            .iter()
            .find(|grant| grant.permission == PluginPermission::Network)
            .unwrap();
        assert!(network.granted);
        let view = store
            .revoke_permission("com.nexnote.test", "network")
            .unwrap();
        let network = view
            .grants
            .iter()
            .find(|grant| grant.permission == PluginPermission::Network)
            .unwrap();
        assert!(!network.granted);
        assert!(store
            .list_audit_log(Some("com.nexnote.test"), 10)
            .iter()
            .any(|record| record.operation == "permission.grant"));
        assert!(store
            .grant_permission("com.nexnote.test", "desktop-privileged")
            .is_err());
        let _ = fs::remove_dir_all(&root);
    }

    fn stored_zip(names: &[&str], payloads: &[&[u8]]) -> Vec<u8> {
        let mut local = Vec::new();
        let mut central = Vec::new();
        let mut offsets = Vec::new();
        for (name, data) in names.iter().zip(payloads) {
            offsets.push(local.len() as u32);
            local.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
            local.extend_from_slice(&20u16.to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(&(data.len() as u32).to_le_bytes());
            local.extend_from_slice(&(data.len() as u32).to_le_bytes());
            local.extend_from_slice(&(name.len() as u16).to_le_bytes());
            local.extend_from_slice(&0u16.to_le_bytes());
            local.extend_from_slice(name.as_bytes());
            local.extend_from_slice(data);
        }
        for ((offset, name), data) in offsets.iter().zip(names.iter()).zip(payloads) {
            central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            central.extend_from_slice(&20u16.to_le_bytes());
            central.extend_from_slice(&20u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(name.len() as u16).to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u32.to_le_bytes());
            central.extend_from_slice(&offset.to_le_bytes());
            central.extend_from_slice(name.as_bytes());
        }
        let central_offset = local.len() as u32;
        let mut bytes = local;
        bytes.extend_from_slice(&central);
        bytes.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        let count = names.len() as u16;
        bytes.extend_from_slice(&count.to_le_bytes());
        bytes.extend_from_slice(&count.to_le_bytes());
        bytes.extend_from_slice(&(central.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&central_offset.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes
    }

    #[test]
    fn extracts_stored_zip_and_confirms_install() {
        let root = temp_root("zip");
        let source_zip = root.join("plugin.zip");
        let manifest = br#"{"id":"com.nexnote.zip","name":"Zip","version":"1.0.0","minAppVersion":"0.1.0","main":"main.js","capabilities":["read"],"permissions":["read"]}"#;
        let entry = b"console.log('zip');";
        fs::write(
            &source_zip,
            stored_zip(
                &["plugin/", "plugin/manifest.json", "plugin/main.js"],
                &[b"", manifest, entry],
            ),
        )
        .unwrap();
        let mut store = PluginStore::new(
            Some(root.join("nexnote-plugins.json")),
            Some(root.join("plugins")),
            "0.1.0",
        );
        let ticket = store.install_preview(&source_zip).unwrap();
        assert_eq!(ticket.source, PluginSource::Zip);
        assert_eq!(ticket.manifest.id, "com.nexnote.zip");
        store.confirm_install(&ticket.ticket, true).unwrap();
        assert_eq!(
            store.get_runtime_source("com.nexnote.zip").unwrap(),
            "console.log('zip');"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_zip_slip_and_cleans_declined_stage() {
        let root = temp_root("zip-safety");
        let unsafe_zip = root.join("unsafe.zip");
        let manifest = br#"{"id":"com.nexnote.evil","name":"Evil","version":"1.0.0","minAppVersion":"0.1.0","main":"main.js","capabilities":["read"],"permissions":["read"]}"#;
        fs::write(
            &unsafe_zip,
            stored_zip(
                &["plugin/manifest.json", "plugin/../evil.js"],
                &[manifest, b"console.log('evil')"],
            ),
        )
        .unwrap();
        let mut store = PluginStore::new(
            Some(root.join("nexnote-plugins.json")),
            Some(root.join("plugins")),
            "0.1.0",
        );
        assert!(store.install_preview(&unsafe_zip).is_err());
        assert!(fs::read_dir(root.join("plugins")).unwrap().count() == 0);

        let source = root.join("source");
        write_manifest(&source, "main.js", &["read"]);
        fs::write(source.join("main.js"), "console.log('accepted')").unwrap();
        let ticket = store.install_preview(&source).unwrap();
        let staging = root.join("plugins").join(&ticket.ticket);
        assert!(staging.exists());
        assert!(store.confirm_install(&ticket.ticket, false).is_err());
        assert!(!staging.exists());
        let _ = fs::remove_dir_all(&root);
    }
}
