#![allow(dead_code)]

use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use crate::vault_fs;

pub const MAX_BINARY_BYTES: usize = 200 * 1024 * 1024;

const BINARY_IGNORE_MARKER: &str = "# NexNote binary documents (DEV-074)";
const BINARY_IGNORE_RULES: [&str; 2] = ["*.xlsx", "*.xmind"];

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

    fn name(self) -> &'static str {
        match self {
            Self::Xlsx => "xlsx",
            Self::Mindmap => "mindmap",
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

fn read_entry<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(Value::as_str)
}

fn kind_field(payload: &Value) -> Result<BinaryKind, BinaryError> {
    match read_entry(payload, "kind") {
        Some("xlsx") => Ok(BinaryKind::Xlsx),
        Some("mindmap") => Ok(BinaryKind::Mindmap),
        _ => Err(BinaryError::new(
            "INVALID_BINARY_KIND",
            "kind must be xlsx or mindmap",
        )),
    }
}

fn resolve_vault_path(root: &Path, relative: &str) -> Result<PathBuf, BinaryError> {
    let normalized = relative.trim();
    if normalized.is_empty() {
        return Err(BinaryError::new("INVALID_PATH", "path is required"));
    }
    if normalized.starts_with('/') {
        return Err(BinaryError::new(
            "ABSOLUTE_PATH",
            "Absolute paths are not allowed",
        ));
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
    let extension = Path::new(relative)
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_ascii_lowercase());
    let expected = kind.extension().trim_start_matches('.');
    if extension.as_deref() != Some(expected) {
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
    hex::encode(Sha256::digest(bytes))
}

fn decode_import_source(encoded: &str) -> Result<Vec<u8>, BinaryError> {
    if encoded.is_empty() || encoded.len() > MAX_BINARY_BYTES / 3 * 4 + 4 {
        return Err(BinaryError::new(
            "BINARY_IMPORT_SOURCE",
            "Import source must be non-empty base64",
        ));
    }
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| BinaryError::new("BINARY_IMPORT_SOURCE", "Invalid base64 import source"))
}

fn sanitize_base_name(raw: &str) -> String {
    let output: String = raw
        .trim()
        .chars()
        .map(|ch| {
            if matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || ch.is_control()
            {
                '_'
            } else {
                ch
            }
        })
        .collect();
    if output.is_empty() {
        "未命名".to_owned()
    } else {
        output.chars().take(80).collect()
    }
}

fn target_dir(payload: &Value) -> Result<String, BinaryError> {
    match read_entry(payload, "targetDir").map(str::trim) {
        None => Ok(String::new()),
        Some("") => Ok(String::new()),
        Some(dir) => {
            let normalized = dir.trim_matches('/');
            if normalized.is_empty() {
                return Err(BinaryError::new("INVALID_PATH", "Invalid targetDir"));
            }
            resolve_vault_path(Path::new("/tmp"), normalized)?;
            Ok(normalized.to_owned())
        }
    }
}

fn unique_import_target(root: &Path, relative: &str) -> Result<(PathBuf, String), BinaryError> {
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
    let parent = relative.rsplit_once('/').map(|(dir, _)| format!("{dir}/"));
    for seq in 2.. {
        let name = if extension.is_empty() {
            format!("{stem} {seq}")
        } else {
            format!("{stem} {seq}.{extension}")
        };
        let target = candidate
            .parent()
            .ok_or_else(|| BinaryError::new("INVALID_PATH", "Invalid target path"))?
            .join(&name);
        if !target.exists() {
            return Ok((
                target,
                match &parent {
                    Some(dir) => format!("{dir}{name}"),
                    None => name,
                },
            ));
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
        uuid::Uuid::new_v4().simple()
    ));
    let result = fs::write(&temp, bytes).and_then(|()| fs::rename(&temp, target));
    if let Err(err) = result {
        let _ = fs::remove_file(&temp);
        return Err(BinaryError::new("WRITE_FAILED", err.to_string()));
    }
    Ok(())
}

fn write_sidecar(
    root: &Path,
    relative: &str,
    digest: &str,
    kind: BinaryKind,
) -> Result<(), BinaryError> {
    let metadata = json!({
        "format": kind.name(),
        "sourceSha256": digest,
    });
    let target = vault_fs::metadata_path_for(root, relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))?;
    }
    let bytes = serde_json::to_vec_pretty(&metadata)
        .map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))?;
    let temp = target.with_extension("tmp");
    let result = fs::write(&temp, bytes).and_then(|()| fs::rename(&temp, &target));
    if let Err(err) = result {
        let _ = fs::remove_file(&temp);
        return Err(BinaryError::new("WRITE_FAILED", err.to_string()));
    }
    Ok(())
}

fn zip_error(kind: BinaryKind, message: impl Into<String>) -> BinaryError {
    let code = if kind == BinaryKind::Mindmap {
        "XMIND_INVALID_ZIP"
    } else {
        "XLSX_INVALID_ZIP"
    };
    BinaryError::new(code, message)
}

fn require_zip(kind: BinaryKind, bytes: &[u8]) -> Result<ZipArchive<Cursor<&[u8]>>, BinaryError> {
    ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| zip_error(kind, format!("Invalid ZIP archive: {e}")))
}

fn read_zip_json(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
    code: &str,
) -> Result<Value, BinaryError> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| BinaryError::new("BINARY_NO_CONTENT", format!("Missing {name}")))?;
    if entry.size() > MAX_BINARY_BYTES as u64 {
        return Err(BinaryError::new(
            "BINARY_TOO_LARGE",
            "ZIP entry is too large",
        ));
    }
    let mut content = Vec::new();
    entry
        .read_to_end(&mut content)
        .map_err(|e| BinaryError::new("BINARY_PARSE_FAILED", e.to_string()))?;
    serde_json::from_slice(&content)
        .map_err(|e| BinaryError::new(code, format!("Invalid JSON in {name}: {e}")))
}

fn xml_escape(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&apos;"),
            _ => output.push(ch),
        }
    }
    output
}

fn column_name(mut column: u32) -> String {
    let mut output = String::new();
    while column > 0 {
        column -= 1;
        output.insert(0, (b'A' + (column % 26) as u8) as char);
        column /= 26;
    }
    output
}

fn build_sheet_xml(sheet: &Value) -> String {
    let mut rows: BTreeMap<u32, BTreeMap<u32, String>> = BTreeMap::new();
    if let Some(cells) = sheet.get("celldata").and_then(Value::as_array) {
        for cell in cells {
            let row = cell.get("r").and_then(Value::as_u64).unwrap_or(0) as u32 + 1;
            let column = cell.get("c").and_then(Value::as_u64).unwrap_or(0) as u32 + 1;
            let raw = cell.get("v").unwrap_or(&Value::Null);
            let value = if raw.is_object() {
                raw.get("v").unwrap_or(&Value::Null)
            } else {
                raw
            };
            let reference = format!("{}{}", column_name(column), row);
            let content = match value {
                Value::String(text) => format!(
                    r#"<c r="{reference}" t="inlineStr"><is><t>{}</t></is></c>"#,
                    xml_escape(text)
                ),
                Value::Number(number) => format!(r#"<c r="{reference}"><v>{number}</v></c>"#),
                Value::Bool(flag) => {
                    format!(r#"<c r="{reference}" t="b"><v>{}</v></c>"#, u8::from(*flag))
                }
                _ => continue,
            };
            rows.entry(row).or_default().insert(column, content);
        }
    }
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#,
    );
    for (row, cells) in rows {
        xml.push_str(&format!(r#"<row r="{row}">"#));
        for content in cells.values() {
            xml.push_str(content);
        }
        xml.push_str("</row>");
    }
    xml.push_str("</sheetData></worksheet>");
    xml
}

fn build_xlsx(sheets: &[Value]) -> Result<Vec<u8>, BinaryError> {
    let names: Vec<String> = sheets
        .iter()
        .enumerate()
        .map(|(index, sheet)| {
            let raw = sheet
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Sheet")
                .trim();
            let name = xml_escape(&raw.chars().take(31).collect::<String>());
            if name.is_empty() {
                format!("Sheet{}", index + 1)
            } else {
                name
            }
        })
        .collect();
    let mut workbook = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>"#,
    );
    for (index, name) in names.iter().enumerate() {
        workbook.push_str(&format!(
            r#"<sheet name="{name}" sheetId="{}" r:id="rId{}"/>"#,
            index + 1,
            index + 1
        ));
    }
    workbook.push_str("</sheets></workbook>");
    let mut content_types = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>"#,
    );
    for index in 1..=sheets.len() {
        content_types.push_str(&format!(
            r#"<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#
        ));
    }
    content_types.push_str("</Types>");
    let mut entries = vec![
        ("xl/workbook.xml".to_owned(), workbook.into_bytes()),
        ("[Content_Types].xml".to_owned(), content_types.into_bytes()),
        (
            "_rels/.rels".to_owned(),
            br#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#
                .to_vec(),
        ),
    ];
    for (index, sheet) in sheets.iter().enumerate() {
        entries.push((
            format!("xl/worksheets/sheet{}.xml", index + 1),
            build_sheet_xml(sheet).into_bytes(),
        ));
    }
    write_zip(entries)
}

fn xmind_sheet(model: &Value, title: &str, structure_class: Option<&str>) -> Value {
    let mut root = serde_json::Map::new();
    let text = model
        .pointer("/data/text")
        .and_then(Value::as_str)
        .unwrap_or(title);
    root.insert("title".to_owned(), Value::String(text.to_owned()));
    if let Some(class) = structure_class {
        root.insert("structureClass".to_owned(), Value::String(class.to_owned()));
    }
    let children = model
        .get("children")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|child| json!({ "attached": [xmind_sheet(child, title, None)] }))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    root.insert("children".to_owned(), json!({ "attached": children }));
    json!({ "rootTopic": Value::Object(root) })
}

fn build_xmind(
    model: &Value,
    title: &str,
    structure_class: Option<&str>,
) -> Result<Vec<u8>, BinaryError> {
    if !model.is_object() || model.get("data").is_none() {
        return Err(BinaryError::new(
            "BINARY_INVALID_DATA",
            "Mindmap model must contain a root node",
        ));
    }
    let sheet = xmind_sheet(model, title, structure_class);
    let sheet_id = uuid::Uuid::new_v4().simple().to_string();
    let metadata = json!({
        "modifier": "",
        "dataStructureVersion": "2",
        "creator": { "name": "mind-map" },
        "layoutEngineVersion": "3",
        "activeSheetId": sheet_id,
    });
    let content = serde_json::to_vec(&[sheet])
        .map_err(|e| BinaryError::new("BINARY_INVALID_DATA", e.to_string()))?;
    let metadata_bytes = serde_json::to_vec(&metadata)
        .map_err(|e| BinaryError::new("BINARY_INVALID_DATA", e.to_string()))?;
    write_zip(vec![
        ("content.json".to_owned(), content),
        ("metadata.json".to_owned(), metadata_bytes),
        (
            "manifest.json".to_owned(),
            br#"{"file-entries":{"content.json":{}}}"#.to_vec(),
        ),
    ])
}

fn write_zip(entries: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>, BinaryError> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        writer
            .start_file(name, SimpleFileOptions::default())
            .map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))?;
        writer
            .write_all(&bytes)
            .map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))?;
    }
    let cursor = writer
        .finish()
        .map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))?;
    Ok(cursor.into_inner())
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

fn is_mindmap_structure_id(value: &str) -> bool {
    matches!(value, "right" | "left" | "down" | "fishbone" | "up" | "x")
}

fn convert_xmind_topic(node: &Value) -> Value {
    let mut data = serde_json::Map::new();
    let text = node
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default();
    data.insert("text".to_owned(), Value::String(text.to_owned()));
    if let Some(note) = node
        .pointer("/notes/plain/content")
        .or_else(|| node.pointer("/notes/realHTML/content"))
        .and_then(Value::as_str)
        .filter(|note| !note.is_empty())
    {
        data.insert("note".to_owned(), Value::String(note.to_owned()));
    }
    if let Some(href) = node
        .get("href")
        .and_then(Value::as_str)
        .filter(|href| href.starts_with("http://") || href.starts_with("https://"))
    {
        data.insert("hyperlink".to_owned(), Value::String(href.to_owned()));
    }
    if let Some(tags) = node
        .get("labels")
        .and_then(Value::as_array)
        .filter(|labels| !labels.is_empty())
        .map(|labels| {
            labels
                .iter()
                .filter_map(|label| label.as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .filter(|labels| !labels.is_empty())
    {
        data.insert("tag".to_owned(), json!(tags));
    }
    let children: Vec<Value> = node
        .pointer("/children/attached")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(convert_xmind_topic).collect())
        .unwrap_or_default();
    json!({ "data": Value::Object(data), "children": children })
}

fn xlsx_sheets(bytes: &[u8]) -> Result<(Vec<Value>, Vec<&'static str>), BinaryError> {
    let archive = require_zip(BinaryKind::Xlsx, bytes)?;
    let readonly = if archive
        .file_names()
        .any(|name| name.eq_ignore_ascii_case("xl/vbaProject.bin"))
    {
        vec!["MACRO"]
    } else {
        Vec::new()
    };
    let sheet_count = archive
        .file_names()
        .filter(|name| name.starts_with("xl/worksheets/sheet"))
        .count();
    if sheet_count == 0 {
        return Err(BinaryError::new(
            "XLSX_NO_SHEETS",
            "Workbook has no worksheet parts",
        ));
    }
    let sheets = (1..=sheet_count)
        .map(|index| json!({ "name": format!("Sheet{index}"), "celldata": [] }))
        .collect();
    Ok((sheets, readonly))
}

pub fn import_binary(root: &Path, payload: &Value) -> Result<Value, BinaryError> {
    let kind = kind_field(payload)?;
    let encoded = read_entry(payload, "data")
        .ok_or_else(|| BinaryError::new("BINARY_IMPORT_SOURCE", "base64 data is required"))?;
    let bytes = decode_import_source(encoded)?;
    if bytes.len() > MAX_BINARY_BYTES {
        return Err(BinaryError::new(
            "BINARY_TOO_LARGE",
            "Binary document is too large",
        ));
    }
    require_zip(kind, &bytes)?;
    let extension = kind.extension();
    let raw_name = read_entry(payload, "name")
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("导入文档");
    let mut name = sanitize_base_name(raw_name);
    if !name.to_ascii_lowercase().ends_with(extension) {
        name.push_str(extension);
    }
    let dir = target_dir(payload)?;
    let relative = if dir.is_empty() {
        name
    } else {
        format!("{dir}/{name}")
    };
    let (target, written) = unique_import_target(root, &relative)?;
    atomic_write(&target, &bytes)?;
    let digest = sha256_hex(&bytes);
    write_sidecar(root, &written, &digest, kind)?;
    Ok(json!({ "path": written, "sha256": digest }))
}

pub fn create_binary(root: &Path, payload: &Value) -> Result<Value, BinaryError> {
    let kind = kind_field(payload)?;
    let title = read_entry(payload, "title")
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or("未命名");
    let base_name = sanitize_base_name(title);
    let extension = kind.extension();
    let name = if base_name.to_ascii_lowercase().ends_with(extension) {
        base_name
    } else {
        format!("{base_name}{extension}")
    };
    let dir = target_dir(payload)?;
    let relative = if dir.is_empty() {
        name
    } else {
        format!("{dir}/{name}")
    };
    let (target, written) = unique_import_target(root, &relative)?;
    let bytes = match kind {
        BinaryKind::Xlsx => build_xlsx(&[json!({ "name": "Sheet1", "celldata": [] })])?,
        BinaryKind::Mindmap => build_xmind(
            &json!({ "data": { "text": title }, "children": [] }),
            title,
            Some("org.xmind.ui.logic.right"),
        )?,
    };
    atomic_write(&target, &bytes)?;
    let digest = sha256_hex(&bytes);
    write_sidecar(root, &written, &digest, kind)?;
    Ok(json!({ "path": written, "sha256": digest }))
}

pub fn read_binary(root: &Path, payload: &Value) -> Result<Value, BinaryError> {
    let kind = kind_field(payload)?;
    let relative = read_entry(payload, "path")
        .ok_or_else(|| BinaryError::new("INVALID_PATH", "path is required"))?;
    let bytes = read_document(root, kind, relative)?;
    let digest = sha256_hex(&bytes);
    match kind {
        BinaryKind::Xlsx => {
            let (sheets, readonly) = xlsx_sheets(&bytes)?;
            Ok(json!({
                "data": { "kind": "xlsx", "sheets": sheets },
                "sha256": digest,
                "readonly": readonly,
            }))
        }
        BinaryKind::Mindmap => {
            let mut archive = require_zip(kind, &bytes)?;
            let content = read_zip_json(&mut archive, "content.json", "XMIND_PARSE_FAILED")?;
            let sheet = content
                .as_array()
                .and_then(|sheets| sheets.first())
                .ok_or_else(|| BinaryError::new("XMIND_NO_CONTENT", "Missing XMind sheet"))?;
            let topic = sheet
                .get("rootTopic")
                .filter(|topic| !topic.is_null())
                .ok_or_else(|| {
                    BinaryError::new("XMIND_NO_ROOT", "XMind document has no root topic")
                })?;
            let model = convert_xmind_topic(topic);
            let structure_class = topic.get("structureClass").and_then(Value::as_str);
            let file_id = structure_id_for_class(structure_class);
            let preserved = structure_class.is_some() && file_id.is_none();
            let mut readonly = vec!["BORDER_OR_RELATION"];
            if preserved {
                readonly.push("XMIND_STRUCTURE_FALLBACK");
            }
            let metadata = vault_fs::read_metadata(root, relative).unwrap_or(Value::Null);
            let legacy = metadata
                .get("mindmapStructure")
                .and_then(Value::as_str)
                .filter(|value| is_mindmap_structure_id(value));
            let structure_id = match (file_id, legacy) {
                (Some("right"), Some(legacy)) if legacy != "up" && legacy != "x" => Some(legacy),
                _ => file_id,
            };
            Ok(json!({
                "data": { "kind": "mindmap", "model": model },
                "sha256": digest,
                "readonly": readonly,
                "structureId": structure_id,
                "structurePreserved": preserved,
            }))
        }
    }
}

pub fn save_binary(root: &Path, payload: &Value) -> Result<Value, BinaryError> {
    let kind = kind_field(payload)?;
    let relative = read_entry(payload, "path")
        .ok_or_else(|| BinaryError::new("INVALID_PATH", "path is required"))?;
    let expected = read_entry(payload, "expectedSha256")
        .ok_or_else(|| BinaryError::new("INVALID_SHA256", "expectedSha256 is required"))?
        .to_ascii_lowercase();
    let current = read_document(root, kind, relative)?;
    let current_digest = sha256_hex(&current);
    if current_digest != expected {
        return Err(BinaryError::new(
            "BINARY_CONFLICT",
            "Binary document changed since it was read",
        ));
    }
    let data = payload.get("data").unwrap_or(&Value::Null);
    let bytes = match kind {
        BinaryKind::Xlsx => {
            let sheets = data
                .get("sheets")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if sheets.is_empty() {
                return Err(BinaryError::new("XLSX_NO_SHEETS", "Workbook has no sheets"));
            }
            build_xlsx(&sheets)?
        }
        BinaryKind::Mindmap => {
            let model = data
                .get("model")
                .ok_or_else(|| BinaryError::new("BINARY_INVALID_DATA", "model is required"))?;
            let structure_class = data
                .get("explicitStructure")
                .and_then(Value::as_str)
                .filter(|value| !matches!(*value, "up" | "x"))
                .and_then(|value| structure_id_for_class(Some(value)));
            let title = Path::new(relative)
                .file_stem()
                .and_then(|v| v.to_str())
                .unwrap_or("未命名");
            build_xmind(model, title, structure_class)?
        }
    };
    let digest = sha256_hex(&bytes);
    if digest == current_digest {
        return Ok(json!({ "sha256": digest }));
    }
    let target = resolve_document(root, kind, relative)?;
    atomic_write(&target, &bytes)?;
    Ok(json!({ "sha256": digest }))
}

pub fn set_binary_ignore(root: &Path, payload: &Value) -> Result<Value, BinaryError> {
    let untrack = payload
        .get("untrack")
        .and_then(Value::as_bool)
        .ok_or_else(|| BinaryError::new("INVALID_GITIGNORE", "untrack must be a boolean"))?;
    let gitignore = root.join(".gitignore");
    let current = fs::read_to_string(&gitignore).unwrap_or_default();
    let eol = if current.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut lines: Vec<String> = current.lines().map(str::to_owned).collect();
    lines.retain(|line| {
        line != BINARY_IGNORE_MARKER && !BINARY_IGNORE_RULES.contains(&line.as_str())
    });
    while lines.last().map(|line| line.is_empty()).unwrap_or(false) {
        lines.pop();
    }
    if untrack {
        lines.push(String::new());
        lines.push(BINARY_IGNORE_MARKER.to_owned());
        for rule in BINARY_IGNORE_RULES {
            lines.push(rule.to_owned());
        }
    }
    let output = if lines.is_empty() {
        String::new()
    } else {
        format!("{}{}", lines.join(eol), eol)
    };
    fs::write(&gitignore, output).map_err(|e| BinaryError::new("WRITE_FAILED", e.to_string()))?;
    let removed_from_index = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["ls-files", "--", "*.xlsx", "*.xmind"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).lines().count())
        .unwrap_or(0);
    Ok(json!({
        "untracked": untrack,
        "removedFromIndex": removed_from_index,
    }))
}

pub fn get_binary_ignore(root: &Path) -> Result<Value, BinaryError> {
    let current = fs::read_to_string(root.join(".gitignore")).unwrap_or_default();
    let lines: Vec<&str> = current.lines().collect();
    let untracked = lines.contains(&BINARY_IGNORE_MARKER)
        && BINARY_IGNORE_RULES
            .iter()
            .all(|rule| lines.iter().any(|line| line == rule));
    Ok(json!({ "untracked": untracked }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nexnote-binary-service-{}-{name}",
            std::process::id()
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
        let read = read_binary(
            &root,
            &json!({ "kind": "mindmap", "path": created["path"] }),
        )
        .unwrap();
        assert_eq!(read["data"]["model"]["data"]["text"], "Root");
        let saved = save_binary(
            &root,
            &json!({
                "kind": "mindmap",
                "path": created["path"],
                "data": { "model": { "data": { "text": "Changed" }, "children": [] } },
                "expectedSha256": read["sha256"],
            }),
        )
        .unwrap();
        assert_ne!(saved["sha256"], read["sha256"]);
        let sidecar = fs::read_to_string(vault_fs::metadata_path_for(
            &root,
            created["path"].as_str().unwrap(),
        ))
        .unwrap();
        assert!(sidecar.contains("\"format\": \"mindmap\""));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn creates_and_reads_empty_xlsx() {
        let root = temp_root("xlsx");
        let created = create_binary(&root, &json!({ "kind": "xlsx", "title": "Book" })).unwrap();
        let read = read_binary(&root, &json!({ "kind": "xlsx", "path": created["path"] })).unwrap();
        assert_eq!(read["data"]["kind"], "xlsx");
        assert_eq!(read["data"]["sheets"].as_array().unwrap().len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn imports_and_deduplicates() {
        let root = temp_root("import");
        let created =
            create_binary(&root, &json!({ "kind": "mindmap", "title": "First" })).unwrap();
        let archive = fs::read(root.join(created["path"].as_str().unwrap())).unwrap();
        let encoded = base64::engine::general_purpose::STANDARD.encode(archive);
        let first = import_binary(
            &root,
            &json!({ "kind": "mindmap", "data": encoded, "name": "a.xmind" }),
        )
        .unwrap();
        let second = import_binary(
            &root,
            &json!({ "kind": "mindmap", "data": encoded, "name": "a.xmind" }),
        )
        .unwrap();
        assert_eq!(first["path"], "a.xmind");
        assert_eq!(second["path"], "a 2.xmind");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_invalid_import_source_and_archive() {
        let root = temp_root("invalid");
        let invalid_base64 = import_binary(&root, &json!({ "kind": "mindmap", "data": "!!!" }));
        assert_eq!(invalid_base64.unwrap_err().code, "BINARY_IMPORT_SOURCE");
        let invalid_zip = import_binary(
            &root,
            &json!({
                "kind": "mindmap",
                "data": base64::engine::general_purpose::STANDARD.encode(b"not zip"),
            }),
        );
        assert_eq!(invalid_zip.unwrap_err().code, "XMIND_INVALID_ZIP");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_conflicting_save_and_traversal() {
        let root = temp_root("conflict");
        let created = create_binary(&root, &json!({ "kind": "xlsx", "title": "Book" })).unwrap();
        let conflict = save_binary(
            &root,
            &json!({
                "kind": "xlsx",
                "path": created["path"],
                "data": { "sheets": [{ "name": "Sheet1", "celldata": [] }] },
                "expectedSha256": "0".repeat(64),
            }),
        );
        assert_eq!(conflict.unwrap_err().code, "BINARY_CONFLICT");
        let traversal = read_binary(&root, &json!({ "kind": "xlsx", "path": "../book.xlsx" }));
        assert_eq!(traversal.unwrap_err().code, "OUTSIDE_VAULT");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn toggles_gitignore_idempotently() {
        let root = temp_root("gitignore");
        fs::write(root.join(".gitignore"), "user-rule\n").unwrap();
        set_binary_ignore(&root, &json!({ "untrack": true })).unwrap();
        assert_eq!(get_binary_ignore(&root).unwrap()["untracked"], true);
        set_binary_ignore(&root, &json!({ "untrack": true })).unwrap();
        let content = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert_eq!(content.matches(BINARY_IGNORE_MARKER).count(), 1);
        set_binary_ignore(&root, &json!({ "untrack": false })).unwrap();
        assert_eq!(get_binary_ignore(&root).unwrap()["untracked"], false);
        assert!(content.contains("user-rule"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn hashes_known_input() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
