//! Persisted skill configuration (DEV-014 contract, DEV-121 migration).
//!
//! Mirrors the Electron `SkillService` store exactly: two builtin skills with
//! default enable/order/params, a per-id user-override layer persisted to a
//! JSON file, and view composition where user overrides win per key over the
//! builtin defaults (`base ∪ user`, shallow). `set_params` replaces the user
//! layer wholesale — that is reference behaviour, not a merge. `set_order`
//! accepts unknown ids faithfully (they become phantom settings entries that
//! never surface, exactly like the reference). A corrupt file falls back to
//! defaults instead of panicking on startup.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{collections::BTreeMap, fs, io::Write, path::PathBuf, sync::Mutex};

/// Renderer-visible skill view; field names match the shared TS `SkillView`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SkillView {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub source: &'static str,
    pub enabled: bool,
    pub order: i64,
    pub params: Value,
    pub available: bool,
}

/// User overrides for one skill; absent fields mean "use the builtin default".
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct SkillSetting {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    order: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedSettings {
    settings: BTreeMap<String, SkillSetting>,
}

#[derive(Debug, Clone)]
struct BuiltinSkill {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    default_enabled: bool,
    order: i64,
    params: Value,
}

/// The two builtin retrieval skills, byte-for-byte from the reference.
fn builtin_skills() -> Vec<BuiltinSkill> {
    vec![
        BuiltinSkill {
            id: "builtin.retrieval",
            name: "内置检索",
            description: "三阶段渐进式召回：FTS 粗筛 → 双链 1 跳 → 向量重排（含置信度因子）。",
            default_enabled: true,
            order: 0,
            params: json!({}),
        },
        BuiltinSkill {
            id: "builtin.retrieval-fts",
            name: "快速关键词检索",
            description: "仅 FTS + 双链（关闭向量重排），低延迟；可与内置检索组合。",
            default_enabled: false,
            order: 1,
            params: json!({ "disableVector": true, "topK": 6 }),
        },
    ]
}

pub struct SkillStore {
    path: PathBuf,
    settings: Mutex<BTreeMap<String, SkillSetting>>,
}

impl SkillStore {
    pub fn new(path: PathBuf) -> Self {
        let settings = restore(&path);
        Self {
            path,
            settings: Mutex::new(settings),
        }
    }

    /// All skills sorted by effective order, then id — the same order the
    /// renderer uses for display and multi-skill retrieval.
    pub fn list(&self) -> Vec<SkillView> {
        let settings = self.settings.lock().expect("skill settings lock");
        let mut views: Vec<SkillView> = builtin_skills()
            .into_iter()
            .map(|skill| {
                let user = settings.get(skill.id).cloned().unwrap_or_default();
                SkillView {
                    id: skill.id.to_owned(),
                    name: skill.name.to_owned(),
                    description: Some(skill.description.to_owned()),
                    source: "builtin",
                    enabled: user.enabled.unwrap_or(skill.default_enabled),
                    order: user.order.unwrap_or(skill.order),
                    params: merge_objects(&skill.params, user.params.as_ref()),
                    available: true,
                }
            })
            .collect();
        views.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
        views
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<SkillView, String> {
        self.mutate(id, |setting| setting.enabled = Some(enabled))?;
        self.find(id)
    }

    /// Assigns `order = index` for each listed id (unknown ids accepted,
    /// matching the reference) and returns the re-sorted full list.
    pub fn set_order(&self, ordered_ids: &[String]) -> Result<Vec<SkillView>, String> {
        let mut settings = self.settings.lock().expect("skill settings lock");
        for (index, id) in ordered_ids.iter().enumerate() {
            settings.entry(id.clone()).or_default().order = Some(index as i64);
        }
        persist(&self.path, &settings)?;
        drop(settings);
        Ok(self.list())
    }

    /// Replaces the user params layer wholesale (reference semantics); the
    /// view still merges builtin defaults underneath, per key.
    pub fn set_params(&self, id: &str, params: Value) -> Result<SkillView, String> {
        self.mutate(id, |setting| setting.params = Some(params))?;
        self.find(id)
    }

    fn find(&self, id: &str) -> Result<SkillView, String> {
        self.list()
            .into_iter()
            .find(|view| view.id == id)
            .ok_or_else(|| format!("Skill not found: {id}"))
    }

    /// Locks, applies the mutation, persists, and verifies the skill exists —
    /// order matters: an unknown id must not leave a phantom write behind.
    fn mutate(&self, id: &str, apply: impl FnOnce(&mut SkillSetting)) -> Result<(), String> {
        if !builtin_skills().iter().any(|skill| skill.id == id) {
            return Err(format!("Skill not found: {id}"));
        }
        let mut settings = self.settings.lock().expect("skill settings lock");
        apply(settings.entry(id.to_owned()).or_default());
        persist(&self.path, &settings)?;
        Ok(())
    }
}

/// Shallow object union; keys in `overrides` win. Non-objects yield `overrides`.
fn merge_objects(base: &Value, overrides: Option<&Value>) -> Value {
    let Some(overrides) = overrides else {
        return base.clone();
    };
    let (Some(base_map), Some(override_map)) = (base.as_object(), overrides.as_object()) else {
        return overrides.clone();
    };
    let mut merged: Map<String, Value> = base_map.clone();
    for (key, value) in override_map {
        merged.insert(key.clone(), value.clone());
    }
    Value::Object(merged)
}

/// Atomic persist: temp file in the same directory, then rename over.
fn persist(path: &PathBuf, settings: &BTreeMap<String, SkillSetting>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create the skill settings directory: {error}"))?;
    }
    let payload = serde_json::to_string_pretty(&PersistedSettings {
        settings: settings.clone(),
    })
    .map_err(|error| format!("Failed to encode skill settings: {error}"))?;
    let temp = path.with_extension("tmp");
    let mut file = fs::File::create(&temp)
        .map_err(|error| format!("Failed to create {}: {error}", temp.display()))?;
    file.write_all(payload.as_bytes())
        .and_then(|()| file.flush())
        .map_err(|error| format!("Failed to write {}: {error}", temp.display()))?;
    fs::rename(&temp, path)
        .map_err(|error| format!("Failed to persist {}: {error}", path.display()))?;
    Ok(())
}

/// Corrupt, missing or unreadable files fall back to defaults — never panic
/// during app startup over a settings file.
fn restore(path: &PathBuf) -> BTreeMap<String, SkillSetting> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<PersistedSettings>(&raw).ok())
        .map(|parsed| parsed.settings)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "nexnote-skills-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or_default()
        ))
    }

    #[test]
    fn seeds_two_builtins_in_reference_order() {
        let store = SkillStore::new(temp_path("seed"));
        let views = store.list();
        assert_eq!(views.len(), 2);
        assert_eq!(views[0].id, "builtin.retrieval");
        assert!(views[0].enabled);
        assert_eq!(views[0].order, 0);
        assert_eq!(views[0].source, "builtin");
        assert!(views[0].available);
        assert_eq!(views[0].params, json!({}));

        assert_eq!(views[1].id, "builtin.retrieval-fts");
        assert!(!views[1].enabled);
        assert_eq!(views[1].order, 1);
        assert_eq!(views[1].params, json!({ "disableVector": true, "topK": 6 }));
    }

    #[test]
    fn enable_toggle_survives_a_reload() {
        let path = temp_path("reload");
        let store = SkillStore::new(path.clone());
        let view = store
            .set_enabled("builtin.retrieval-fts", true)
            .expect("toggle builtin skill");
        assert!(view.enabled);

        let reopened = SkillStore::new(path.clone());
        let reopened_view = reopened
            .list()
            .into_iter()
            .find(|item| item.id == "builtin.retrieval-fts")
            .expect("skill persists");
        assert!(reopened_view.enabled);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn set_order_reassigns_and_resorts() {
        let store = SkillStore::new(temp_path("order"));
        let views = store
            .set_order(&[
                "builtin.retrieval-fts".to_owned(),
                "builtin.retrieval".to_owned(),
            ])
            .expect("reorder");
        assert_eq!(views[0].id, "builtin.retrieval-fts");
        assert_eq!(views[0].order, 0);
        assert_eq!(views[1].id, "builtin.retrieval");
        assert_eq!(views[1].order, 1);
    }

    #[test]
    fn set_params_replaces_user_layer_but_base_keys_survive_in_view() {
        let store = SkillStore::new(temp_path("params"));
        // User layer {topK:8} replaces any prior user params; the view unions
        // it with the builtin base, so disableVector survives.
        let view = store
            .set_params("builtin.retrieval-fts", json!({ "topK": 8 }))
            .expect("set params");
        assert_eq!(
            view.params,
            json!({ "disableVector": true, "topK": 8 }),
            "base keys must survive under user overrides: {view:?}"
        );

        // Replacing with {disableVector:false} drops topK from the user layer,
        // but the builtin base topK reappears in the view.
        let view = store
            .set_params("builtin.retrieval-fts", json!({ "disableVector": false }))
            .expect("replace params");
        assert_eq!(
            view.params,
            json!({ "disableVector": false, "topK": 6 }),
            "user layer replacement must not erase base defaults: {view:?}"
        );
    }

    #[test]
    fn unknown_skills_are_rejected() {
        let store = SkillStore::new(temp_path("unknown"));
        assert!(store.set_enabled("nope", true).is_err());
        assert!(store.set_params("nope", json!({})).is_err());
    }

    #[test]
    fn set_order_accepts_unknown_ids_faithfully() {
        let path = temp_path("phantom");
        let store = SkillStore::new(path.clone());
        // Reference behaviour: unknown ids become phantom settings entries.
        let views = store
            .set_order(&["ghost".to_owned(), "builtin.retrieval".to_owned()])
            .expect("order accepts unknown ids");
        assert_eq!(views.len(), 2, "phantom entries never surface in list()");

        // And they persist (same file shape as the reference).
        let reopened = SkillStore::new(path.clone());
        assert_eq!(reopened.list().len(), 2);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let path = temp_path("corrupt");
        std::fs::write(&path, b"{ not json").expect("write corrupt settings");
        let store = SkillStore::new(path.clone());
        let views = store.list();
        assert_eq!(views.len(), 2);
        assert!(views[0].enabled, "defaults return after corruption");
        let _ = std::fs::remove_file(path);
    }
}
