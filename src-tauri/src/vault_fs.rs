#![allow(dead_code)]

use base64::Engine;
use serde_json::{json, Value};
use std::{
    fs, io,
    path::{Component, Path, PathBuf},
};

fn error(code: &str, message: &str) -> Value {
    json!({ "ok": false, "error": message, "code": code })
}

fn ok(data: Value) -> Value {
    json!({ "ok": true, "data": data })
}

pub const EXCLUDED_DIRS: [&str; 4] = [".nexnote", ".git", ".trash", "node_modules"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentFormat {
    Markdown,
    Docx,
    Xlsx,
    Mindmap,
}

pub fn format_for_path(path: &str) -> Option<DocumentFormat> {
    let ext = Path::new(path)
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_ascii_lowercase())?;
    match ext.as_str() {
        "docx" => Some(DocumentFormat::Docx),
        "xlsx" => Some(DocumentFormat::Xlsx),
        "xmind" => Some(DocumentFormat::Mindmap),
        "md" | "markdown" => Some(DocumentFormat::Markdown),
        _ => None,
    }
}

pub fn is_document_path(path: &str) -> bool {
    format_for_path(path).is_some()
}

pub fn metadata_path_for(root: &Path, document_path: &str) -> PathBuf {
    let normalized = document_path.replace('\\', "/");
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(normalized.as_bytes());
    root.join(".nexnote")
        .join("metadata")
        .join(format!("{encoded}.json"))
}

pub fn read_metadata(root: &Path, document_path: &str) -> Option<Value> {
    let raw = fs::read_to_string(metadata_path_for(root, document_path)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn write_metadata(root: &Path, document_path: &str, metadata: &Value) -> Result<(), io::Error> {
    let target = metadata_path_for(root, document_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let serialized = serde_json::to_vec_pretty(metadata)?;
    let temp = target.with_extension("tmp");
    fs::write(&temp, serialized)?;
    fs::rename(&temp, &target)
}

fn resolve_vault_relative(root: &Path, rel: &str) -> Result<PathBuf, Value> {
    let normalized = rel.trim();
    if normalized.is_empty() || normalized == "." {
        return Ok(root.to_path_buf());
    }
    if normalized.starts_with('/') {
        return Err(error("ABSOLUTE_PATH", "Absolute paths are not allowed"));
    }
    if normalized.len() >= 2 {
        let bytes = normalized.as_bytes();
        if bytes[1] == b':' && (bytes[0] as char).is_ascii_alphabetic() {
            return Err(error("ABSOLUTE_PATH", "Absolute paths are not allowed"));
        }
    }
    let candidate = root.join(normalized);
    let mut depth: i32 = 0;
    for component in candidate.components() {
        match component {
            Component::Normal(_) => depth += 1,
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return Err(error("OUTSIDE_VAULT", "Path traversal is not allowed"));
                }
            }
            _ => {}
        }
    }
    let canonical = candidate
        .components()
        .filter(|c| matches!(c, Component::Normal(_)))
        .fold(root.to_path_buf(), |acc, c| acc.join(c));
    if canonical != root {
        let first = canonical
            .strip_prefix(root)
            .ok()
            .and_then(|rel| rel.components().next());
        if let Some(Component::Normal(name)) = first {
            if EXCLUDED_DIRS.contains(&name.to_string_lossy().as_ref()) {
                return Err(error("EXCLUDED_DIR", "Cannot access internal directory"));
            }
        }
    }
    Ok(canonical)
}

fn require_root(root: &Path) -> Result<(), Value> {
    if root.is_dir() {
        Ok(())
    } else {
        Err(error("NO_VAULT", "Vault root does not exist"))
    }
}

fn entry_json(entry: &fs::DirEntry) -> Value {
    let name = entry.file_name().to_string_lossy().into_owned();
    let kind = if entry.file_type().map(|v| v.is_dir()).unwrap_or(false) {
        "directory"
    } else {
        "file"
    };
    json!({ "name": name, "kind": kind })
}

pub fn list_dir(root: &Path, payload: &Value) -> Value {
    if let Err(e) = require_root(root) {
        return e;
    }
    let relative = payload.get("path").and_then(Value::as_str).unwrap_or(".");
    let target = match resolve_vault_relative(root, relative) {
        Ok(path) => path,
        Err(value) => return value,
    };
    let entries = match fs::read_dir(&target) {
        Ok(iter) => iter,
        Err(err) => return error("LIST_DIR_FAILED", &err.to_string()),
    };
    let items: Vec<Value> = entries
        .filter_map(Result::ok)
        .filter(|e| !EXCLUDED_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
        .map(|e| entry_json(&e))
        .collect();
    ok(json!(items))
}

pub fn list_tree(root: &Path, payload: &Value) -> Value {
    if let Err(e) = require_root(root) {
        return e;
    }
    let show_all = payload
        .get("showAllFiles")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut items = Vec::new();
    walk_tree(root, root, show_all, &mut items);
    ok(json!(items))
}

fn walk_tree(root: &Path, dir: &Path, show_all: bool, out: &mut Vec<Value>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut sorted: Vec<_> = entries.filter_map(Result::ok).collect();
    sorted.sort_by_key(|a| a.file_name());
    for entry in sorted {
        let name = entry.file_name().to_string_lossy().into_owned();
        if EXCLUDED_DIRS.contains(&name.as_str()) {
            continue;
        }
        let is_dir = entry.file_type().map(|v| v.is_dir()).unwrap_or(false);
        let entry_path = entry.path();
        let rel = entry_path
            .strip_prefix(root)
            .unwrap_or(&entry_path)
            .to_string_lossy()
            .replace('\\', "/");
        if is_dir {
            out.push(json!({ "name": name, "path": rel, "kind": "directory" }));
            walk_tree(root, &entry.path(), show_all, out);
        } else if show_all
            || name.to_ascii_lowercase().ends_with(".md")
            || name.to_ascii_lowercase().ends_with(".markdown")
        {
            out.push(json!({ "name": name, "path": rel, "kind": "file" }));
        }
    }
}

pub fn read_text_file(root: &Path, payload: &Value) -> Value {
    if let Err(e) = require_root(root) {
        return e;
    }
    let Some(relative) = payload.get("path").and_then(Value::as_str) else {
        return error("INVALID_PATH", "path is required");
    };
    let target = match resolve_vault_relative(root, relative) {
        Ok(path) => path,
        Err(value) => return value,
    };
    match fs::read_to_string(&target) {
        Ok(content) => ok(json!({ "content": content })),
        Err(err) => error("READ_FAILED", &err.to_string()),
    }
}

fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), io::Error> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = target.with_extension("tmp");
    fs::write(&temp, bytes)?;
    fs::rename(&temp, target)
}

pub fn write_text_file(root: &Path, payload: &Value) -> Value {
    if let Err(e) = require_root(root) {
        return e;
    }
    let (Some(relative), Some(content)) = (
        payload.get("path").and_then(Value::as_str),
        payload.get("content").and_then(Value::as_str),
    ) else {
        return error("INVALID_FILE", "path and content are required");
    };
    let target = match resolve_vault_relative(root, relative) {
        Ok(path) => path,
        Err(value) => return value,
    };
    match atomic_write(&target, content.as_bytes()) {
        Ok(()) => ok(Value::Null),
        Err(err) => error("WRITE_FAILED", &err.to_string()),
    }
}

pub fn create_text_file(root: &Path, payload: &Value) -> Value {
    if let Err(e) = require_root(root) {
        return e;
    }
    let (Some(relative), Some(content)) = (
        payload.get("path").and_then(Value::as_str),
        payload.get("content").and_then(Value::as_str),
    ) else {
        return error("INVALID_FILE", "path and content are required");
    };
    let target = match resolve_vault_relative(root, relative) {
        Ok(path) => path,
        Err(value) => return value,
    };
    if target.exists() {
        return ok(json!({ "created": false }));
    }
    match atomic_write(&target, content.as_bytes()) {
        Ok(()) => ok(json!({ "created": true })),
        Err(err) => error("CREATE_FAILED", &err.to_string()),
    }
}

pub fn create_note(root: &Path, payload: &Value) -> Value {
    if let Err(e) = require_root(root) {
        return e;
    }
    let parent_dir = payload
        .get("parentDir")
        .and_then(Value::as_str)
        .unwrap_or("");
    let name = match payload.get("name").and_then(Value::as_str) {
        Some(name) if !name.trim().is_empty() => name.trim().to_owned(),
        _ => return error("NAME_EMPTY", "File name is required"),
    };
    let content = payload.get("content").and_then(Value::as_str).unwrap_or("");
    let format = payload
        .get("format")
        .and_then(Value::as_str)
        .unwrap_or("native-block");
    let file_name = if name.to_ascii_lowercase().ends_with(".md")
        || name.to_ascii_lowercase().ends_with(".markdown")
    {
        name.clone()
    } else {
        format!("{name}.md")
    };
    let relative = if parent_dir.is_empty() {
        file_name.clone()
    } else {
        format!("{parent_dir}/{file_name}")
    };
    let target = match resolve_vault_relative(root, &relative) {
        Ok(path) => path,
        Err(value) => return value,
    };
    if target.exists() {
        return error("FILE_EXISTS", "A file with this name already exists");
    }
    if let Err(err) = atomic_write(&target, content.as_bytes()) {
        return error("CREATE_NOTE_FAILED", &err.to_string());
    }
    let metadata = json!({ "format": format });
    let _ = write_metadata(root, &relative, &metadata);
    let rel_normalized = relative.replace('\\', "/");
    ok(json!({
        "path": rel_normalized,
        "name": file_name,
        "kind": "file",
        "size": content.len() as u64,
    }))
}

pub fn exists(root: &Path, payload: &Value) -> Value {
    if let Err(e) = require_root(root) {
        return e;
    }
    let Some(relative) = payload.get("path").and_then(Value::as_str) else {
        return error("INVALID_PATH", "path is required");
    };
    match resolve_vault_relative(root, relative) {
        Ok(target) => ok(json!(target.exists())),
        Err(_) => ok(json!(false)),
    }
}

pub fn stat(root: &Path, payload: &Value) -> Value {
    if let Err(e) = require_root(root) {
        return e;
    }
    let Some(relative) = payload.get("path").and_then(Value::as_str) else {
        return error("INVALID_PATH", "path is required");
    };
    let target = match resolve_vault_relative(root, relative) {
        Ok(path) => path,
        Err(value) => return value,
    };
    match target.metadata() {
        Ok(meta) => {
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis().to_string())
                .unwrap_or_default();
            ok(json!({
                "path": relative,
                "name": target
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                "kind": if meta.is_dir() { "directory" } else { "file" },
                "size": meta.len(),
                "modifiedAt": modified,
            }))
        }
        Err(_) => ok(Value::Null),
    }
}

pub fn mkdir(root: &Path, payload: &Value) -> Value {
    if let Err(e) = require_root(root) {
        return e;
    }
    let Some(relative) = payload.get("path").and_then(Value::as_str) else {
        return error("INVALID_PATH", "path is required");
    };
    let recursive = payload
        .get("recursive")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let target = match resolve_vault_relative(root, relative) {
        Ok(path) => path,
        Err(value) => return value,
    };
    let result = if recursive {
        fs::create_dir_all(&target)
    } else {
        fs::create_dir(&target)
    };
    match result {
        Ok(()) => ok(json!({
            "path": relative,
            "name": target
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            "kind": "directory",
            "size": 0,
            "modifiedAt": "",
        })),
        Err(err) => error("MKDIR_FAILED", &err.to_string()),
    }
}

pub fn rename(root: &Path, payload: &Value) -> Value {
    if let Err(e) = require_root(root) {
        return e;
    }
    let (Some(from), Some(to)) = (
        payload.get("from").and_then(Value::as_str),
        payload.get("to").and_then(Value::as_str),
    ) else {
        return error("INVALID_PATH", "from and to are required");
    };
    let source = match resolve_vault_relative(root, from) {
        Ok(path) => path,
        Err(value) => return value,
    };
    let dest = match resolve_vault_relative(root, to) {
        Ok(path) => path,
        Err(value) => return value,
    };
    match fs::rename(&source, &dest) {
        Ok(()) => {
            let meta = dest
                .metadata()
                .unwrap_or_else(|_| fs::metadata(&dest).unwrap_or_else(|_| unreachable!()));
            ok(json!({
                "path": to,
                "name": dest
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                "kind": if meta.is_dir() { "directory" } else { "file" },
                "size": meta.len(),
                "modifiedAt": "",
            }))
        }
        Err(err) => error("RENAME_FAILED", &err.to_string()),
    }
}

pub fn delete(root: &Path, payload: &Value) -> Value {
    if let Err(e) = require_root(root) {
        return e;
    }
    let Some(relative) = payload.get("path").and_then(Value::as_str) else {
        return error("INVALID_PATH", "path is required");
    };
    let to_trash = payload
        .get("toTrash")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let target = match resolve_vault_relative(root, relative) {
        Ok(path) => path,
        Err(value) => return value,
    };
    let result = if to_trash {
        let trash = root.join(".trash");
        let _ = fs::create_dir_all(&trash);
        let file_name = target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| {
                format!(
                    "unnamed_{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis())
                        .unwrap_or_default()
                )
            });
        fs::rename(&target, trash.join(&file_name))
    } else if target.is_dir() {
        fs::remove_dir_all(&target)
    } else {
        fs::remove_file(&target)
    };
    match result {
        Ok(()) => ok(Value::Null),
        Err(err) => error("DELETE_FAILED", &err.to_string()),
    }
}

pub fn scan_tags(root: &Path) -> Value {
    if let Err(e) = require_root(root) {
        return e;
    }
    let mut tags = std::collections::BTreeMap::<String, u64>::new();
    let mut paths = Vec::new();
    walk_tree(root, root, false, &mut paths);
    for item in &paths {
        let path = item.get("path").and_then(Value::as_str).unwrap_or("");
        if !path.to_ascii_lowercase().ends_with(".md")
            && !path.to_ascii_lowercase().ends_with(".markdown")
        {
            continue;
        }
        let Ok(content) = fs::read_to_string(root.join(path)) else {
            continue;
        };
        let (frontmatter, body) = split_frontmatter(&content);
        if let Some(fm) = frontmatter {
            for tag in parse_frontmatter_tags(fm) {
                *tags.entry(tag).or_default() += 1;
            }
        }
        for tag in extract_inline_tags(body) {
            *tags.entry(tag).or_default() += 1;
        }
    }
    let items: Vec<Value> = tags
        .into_iter()
        .map(|(tag, count)| json!({ "tag": tag, "count": count }))
        .collect();
    ok(json!(items))
}

fn split_frontmatter(text: &str) -> (Option<&str>, &str) {
    if let Some(rest) = text.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---") {
            return (Some(&rest[..end]), &rest[end + 4..]);
        }
    }
    (None, text)
}

fn parse_frontmatter_tags(frontmatter: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let mut in_block = false;
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if in_block {
            if let Some(tag) = trimmed.strip_prefix("- ") {
                tags.push(tag.trim().to_owned());
            } else {
                in_block = false;
            }
        } else if let Some(rest) = trimmed.strip_prefix("tags:") {
            let rest = rest.trim();
            if rest.starts_with('[') && rest.ends_with(']') {
                for item in rest[1..rest.len() - 1].split(',') {
                    tags.push(item.trim().to_owned());
                }
            } else if rest.is_empty() {
                in_block = true;
            } else {
                tags.push(rest.to_owned());
            }
        }
    }
    tags.retain(|t| !t.is_empty());
    tags
}

fn extract_inline_tags(body: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let mut in_fence = false;
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || line.contains('`') {
            continue;
        }
        for part in line.split_whitespace() {
            if let Some(tag) = part.strip_prefix('#') {
                if tag
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_alphabetic() || c == '_')
                {
                    tags.push(tag.to_owned());
                }
            }
        }
    }
    tags.sort();
    tags.dedup();
    tags
}
