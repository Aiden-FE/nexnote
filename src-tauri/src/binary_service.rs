use base64::Engine;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Seek, Write},
    path::{Component, Path, PathBuf},
};

pub const MAX_BINARY_BYTES: usize = 200 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryKind {
    Xlsx,
    Mindmap,
}

impl BinaryKind {
    fn extension(self) -> &'static str {
        match self {
            Self::Xlsx => ".xlsx",
            Self::Mindmap => ".xmind",
        }
    }
}

#[derive(Debug)]
pub struct BinaryError {
    pub code: String,
    pub message: String,
}

impl BinaryError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
        message: message.into(),
        }
    }
}

fn read_entry(payload: &Value, key: &str) -> Option<&str> {
    payload.get(key).and_then(Value::as_str)
}

fn resolve_vault_path(root: &Path, relative: &str) -> Result<PathBuf, BinaryError> {
    let normalized = relative.trim();
    if normalized.is_empty() {
        return Err(BinaryError::new("INVALID_PATH", "path is required"));
    }
    if normalized.starts_with('/') {
        return Err(BinaryError::new("ABSOLUTE_PATH", "Absolute paths are not allowed"));
    }
    if normalized.len() >= 2 {
        let bytes = normalized.as_bytes();
        if bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
            return Err(BinaryError::new(
                "ABSOLUTE_PATH",
                "Absolute paths are not allowed",
            ));
        }
    }
    let mut depth: i32 = 0;
    for component in Path::new(normalized).components() {
        match component {
            Component::Normal(_) => depth += 1,
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return Err(BinaryError::new(
                        "OUTSIDE_VAULT",
                        "Path traversal is not allowed",
                    ));
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(BinaryError::new(
                    "ABSOLUTE_PATH",
                    "Absolute paths are not allowed",
                ));
            }
            Component::CurDir => {}
        }
    }
    Ok(root.join(normalized))
}

fn validate_kind_path(kind: BinaryKind, relative: &str) -> Result<(), BinaryError> {
    let ext = Path::new(relative)
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_ascii_lowercase());
    let expected = kind.extension().trim_start_matches('.');
    if ext.as_deref() != Some(expected) {
        return Err(BinaryError::new(
            "BINARY_NOT_MATCH",
            format!("Expected {expected} file, got {relative}"),
        ));
    }
    Ok(())
}

fn resolve_document(root: &Path, kind: BinaryKind, relative: &str) -> Result<PathBuf, BinaryError> {
    validate_kind_path(kind, relative)?;
    let target = resolve_vault_path(root, relative)?;
    if !target.is_file() {
        return Err(BinaryError::new("NOT_FOUND", "Binary document not found"));
    }
    Ok(target)
}

fn read_document(root: &Path, kind: BinaryKind, relative: &str) -> Result<Vec<u8>, BinaryError> {
    let target = resolve_document(root, kind, relative)?;
    let bytes = fs::read(&target).map_err(|e| BinaryError::new("READ_FAILED", e.to_string()))?;
    if bytes.is_empty() {
        return Err(BinaryError::new("BINARY_EMPTY", "Binary document is empty"));
    }
    if bytes.len() > MAX_BINARY_BYTES {
        return Err(BinaryError::new(
            "BINARY_TOO_LARGE",
            "Binary document is too large",
        ));
    }
    Ok(bytes)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut state = Sha256::new();
    state.update(bytes);
    hex::encode(state.finalize())
}

fn decode_import_source(encoded: &str) -> Result<Vec<u8>, BinaryError> {
    if encoded.is_empty() || encoded.len() > MAX_BINARY_BYTES * 4 / 3 + 4 {
        return Err(BinaryError::new(
            "BINARY_IMPORT_SOURCE",
            "Import source must be non-empty base64",
        ));
    }
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| BinaryError::new("BINARY_IMPORT_SOURCE", "Invalid base64 import source"))
}

fn kind_field(payload: &Value) -> Result<BinaryKind, BinaryError> {
    match read_entry(payload, "kind") {
        Some("xlsx") => Ok(BinaryKind::Xlsx),
        Some("mindmap") => Ok(BinaryKind::Mindmap),
        _ => Err(BinaryError::new("INVALID_BINARY_KIND", "kind must be xlsx or mindmap")),
    }
}

fn sanitize_base_name(raw: &str) -> String {
    let mut output = String::new();
    for ch in raw.trim().chars() {
        let replacement = if matches!(
            ch,
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
        ) || ch.is_control()
        {
            '_'
        } else {
            ch
        };
        output.push(replacement);
    }
    if output.is_empty() {
        "未命名".to_owned()
    } else {
        output.chars().take(80).collect()
    }
}

fn unique_import_target(
    root: &Path,
    relative: &str,
) -> Result<(PathBuf, String), BinaryError> {
    let candidate = resolve_vault_path(root, relative)?;
    if !candidate.exists() {
        return Ok((candidate, relative.to_owned()));
    }
    let extension = Path::new(relative)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default();
    let stem = Path::new(relative)
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("binary");
    for seq in 2.. {
        let next = if extension.is_empty() {
            format!("{stem} {seq}")
        } else {
            format!("{stem} {seq}.{extension}")
        };
        let target = candidate
            .parent()
            .ok_or_else(|| BinaryError::new("INVALID_PATH", "Invalid target path"))?
            .join(&next);
        if !target.exists() {
            let parent = relative
                .rsplit_once('/')
                .map(|(dir, _)| format!("{dir}/"))
                .unwrap_or_default();
            return Ok((target, format!("{parent}{next}")));
        }
    }
    unreachable!()
}

fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), BinaryError> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))?;
    }
    let file_name = target
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("binary");
    let temp = target.with_file_name(format!(
        "{file_name}.tmp-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let write = || -> Result<(), BinaryError> {
        fs::write(&temp, bytes).map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))?;
        fs::rename(&temp, target).map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))
    };
    if let Err(e) = write() {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }
    Ok(())
}

fn write_sidecar(root: &Path, relative: &str, sha256: &str, kind: BinaryKind) -> Result<(), BinaryError> {
    let metadata = json!({
        "format": if kind == BinaryKind::Xlsx { "xlsx" } else { "mindmap" },
        "sourceSha256": sha256
    });
    let target = vault_fs::metadata_path_for(root, relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))?;
    }
    let temp = target.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(&metadata)
        .map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))?;
    fs::write(&temp, bytes).map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))?;
    fs::rename(&temp, &target).map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))
}

fn require_zip(bytes: &[u8]) -> Result<ZipArchive<Cursor<&[u8]>>, BinaryError> {
    ZipArchive::new(Cursor::new(bytes)).map_err(|e| {
        BinaryError::new(
            if kind_for_bytes(bytes) == BinaryKind::Mindmap {
                "XMIND_INVALID_ZIP"
            } else {
                "XLSX_INVALID_ZIP"
            },
            format!("Invalid ZIP archive: {e}"),
        )
    })
}

fn kind_for_bytes(bytes: &[u8]) -> BinaryKind {
    if bytes.starts_with(b"PK") {
        BinaryKind::Mindmap
    }
    else {
        BinaryKind::Xlsx
    }
}

fn read_zip_json(archive: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<Value, BinaryError> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| BinaryError::new("BINARY_NO_CONTENT", format!("Missing {name}")))?;
    if entry.size() > MAX_BINARY_BYTES as u64 {
        return Err(BinaryError::new("BINARY_TOO_LARGE", "ZIP entry is too large"));
    }
    let mut content = Vec::new();
    entry
        .read_to_end(&mut content)
        .map_err(|e| BinaryError::new("BINARY_PARSE_FAILED", e.to_string()))?;
    serde_json::from_slice(&content)
        .map_err(|e| BinaryError::new("BINARY_PARSE_FAILED", format!("Invalid JSON: {e}")))
}

fn root_topic(sheet: &Value) -> Result<&Value, BinaryError> {
    sheet
        .get("rootTopic")
        .filter(|topic| !topic.is_null())
        .ok_or_else(|| BinaryError::new("XMIND_NO_ROOT", "XMind document has no root topic"))
}

fn convert_xmind_topic(node: &Value) -> Value {
    let mut data = serde_json::Map::new();
    let text = node
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default();
    data.insert("text".to_owned(), Value::String(text.to_owned()));
    if let Some(note) = node.pointer("/notes/plain/content").or_else(|| {
        node.pointer("/notes/realHTML/content")
    }) {
        if let Some(note) = note.as_str() {
            if !note.is_empty() {
                data.insert("note".to_owned(), Value::String(note.to_owned()));
            }
        }
    }
    if let Some(href) = node.get("href").and_then(Value::as_str) {
        if href.starts_with("http://") || href.starts_with("https://") {
            data.insert("hyperlink".to_owned(), Value::String(href.to_owned()));
        }
    }
    if let Some(labels) = node.get("labels").and_then(Value::as_array) {
        if !labels.is_empty() {
            let tags: Vec<_> = labels
                .iter()
                .filter_map(|v| v.as_str().map(|s| Value::String(s.to_owned())))
                .collect();
            if !tags.is_empty() {
                data.insert("tag".to_owned(), Value::Array(tags));
            }
        }
    }
    let children = match node.get("children").and_then(Value::get("attached")) {
        Some(Value::Array(items)) => items
            .iter()
            .map(convert_xmind_topic)
            .collect(),
        _ => Vec::new(),
    };
    json!({ "data": data, "children": children })
}

fn structure_id_for_class(value: Option<&str>) -> Option<&'static str> {
    match value {
        Some("org.xmind.ui.logic.right") => Some("right"),
        Some("org.xmind.ui.logic.left") => Some("left"),
        Some("org.xmind.ui.org-chart.down") => Some("down"),
        Some("org.xmind.ui.fishbone.rightHeaded") => Some("fishbone"),
        _ => None,
    }
}

fn xlsx_sheets(archive: &mut ZipArchive<Cursor<&[u8]>>) -> Result<Vec<Value>, BinaryError> {
    let names: Vec<String> = archive.file_names().map(ToOwned::to_owned).collect();
    if names.iter().any(|name| name.eq_ignore_ascii_case("xl/vbaProject.bin")) {
        // Macro preservation cannot be performed by this minimal ZIP writer yet.
        return Err(BinaryError::new(
            "XLSX_PARSE_FAILED",
            "Macro-enabled workbooks require the binary preservation pipeline",
        );
    }
    let shared_strings = read_zip_json(archive, "xl/sharedStrings.xml")... // bogus
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nexnote-binary-service-{}-{}",
            std::process::id(),
            name
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn creates_reads_and_saves_xmind() {
        let root = temp_root("xmind");
        let created = create_binary(&root, &json!({ "kind": "mindmap", "title": "Root" })).unwrap();
        assert!(created["path"].as_str().unwrap().ends_with(".xmind"));

        let read = read_binary(&root, &json!({ "kind": "mindmap", "path": created["path"] })).unwrap();
        assert_eq!(read["data"]["model"]["data"]["text"], "Root");

        let model = read["data"].clone();
        let saved = save_binary(
            &root,
            &json!({
                "kind": "mindmap",
                "path": created["path"],
                "data": { "model": { "data": { "text": "Changed" }, "children": [] } },
                "expectedSha256": read["sha256"]
            }),
        )
        .unwrap();
        assert_ne!(saved["sha256"], read["sha256"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_conflicting_save() {
        let root = temp_root("conflict");
        let created = create_binary(&root, &json!({ "kind": "xlsx", "title": "Book" })).unwrap();
        let result = save_binary(
            &root,
        &json!({
                "kind": "xlsx", "path": created["path"],
                "data": { "sheets": [] },
                "expectedSha256": "0".repeat(64)
            }),
        );
        assert_eq!(result.unwrap_err().code, "BINARY_CONFLICT");
        let _ = fs::remove_dir_all(&root);
    }
}
