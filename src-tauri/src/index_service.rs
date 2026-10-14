#![allow(dead_code)]

use rusqlite::Connection;
use serde_json::{json, Value};
use std::{fs, path::Path, sync::Mutex};

pub const SCHEMA_VERSION: i64 = 6;

fn error(code: &str, message: &str) -> Value {
    json!({ "ok": false, "error": message, "code": code })
}

fn ok(data: Value) -> Value {
    json!({ "ok": true, "data": data })
}

static DB: Mutex<Option<Connection>> = Mutex::new(None);
static CURRENT_ROOT: Mutex<Option<String>> = Mutex::new(None);
#[cfg(test)]
static TEST_LOCK: Mutex<()> = Mutex::new(());

pub fn open_database(root: &Path) -> Result<Connection, String> {
    let dir = root.join(".nexnote");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(dir.join("index.db")).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .pragma_update_and_check(None, "user_version", 0, |_row| Ok(()))
        .map_err(|e| e.to_string())
        .and_then(|_| {
            conn.query_row("PRAGMA user_version", [], |row| row.get(0))
                .map_err(|e| e.to_string())
        })
        .unwrap_or(0);
    if version >= SCHEMA_VERSION {
        return Ok(());
    }
    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]', created_at TEXT, updated_at TEXT, hash TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY, source_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, target_page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL, target_raw TEXT NOT NULL, target_name TEXT NOT NULL, link_type TEXT NOT NULL DEFAULT 'wiki', anchor TEXT);
             CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, tag_name TEXT NOT NULL, tag_path TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS blocks (id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, block_id TEXT, block_type TEXT NOT NULL, content_text TEXT NOT NULL, position INTEGER NOT NULL);
             CREATE UNIQUE INDEX IF NOT EXISTS pages_path_idx ON pages(path);
             CREATE INDEX IF NOT EXISTS links_target_idx ON links(target_page_id);
             CREATE INDEX IF NOT EXISTS links_source_idx ON links(source_page_id);
             CREATE INDEX IF NOT EXISTS tags_name_idx ON tags(tag_name);
             CREATE INDEX IF NOT EXISTS blocks_id_idx ON blocks(block_id);
             CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(path UNINDEXED, title, aliases, tags, content);",
        )
        .map_err(|e| e.to_string())?;
    }
    if version < 2 {
        conn.execute_batch(
            "ALTER TABLE links ADD COLUMN source_block_id INTEGER REFERENCES blocks(id) ON DELETE SET NULL;
             ALTER TABLE links ADD COLUMN source_text TEXT NOT NULL DEFAULT '';
             UPDATE links SET source_text = target_raw WHERE source_text = '';",
        )
        .map_err(|e| e.to_string())?;
    }
    if version < 3 {
        conn.execute_batch(
            "DROP TABLE IF EXISTS page_fts;
             CREATE VIRTUAL TABLE page_fts USING fts5(path UNINDEXED, title UNINDEXED, aliases UNINDEXED, tags UNINDEXED, content UNINDEXED, tok);",
        )
        .map_err(|e| e.to_string())?;
    }
    if version < 4 {
        conn.execute_batch(
            "ALTER TABLE pages ADD COLUMN confidence_boost REAL;
             CREATE TABLE IF NOT EXISTS confidence (page_id INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE, score REAL NOT NULL, factors_json TEXT NOT NULL, computed_at TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS confidence_page_idx ON confidence(page_id);",
        )
        .map_err(|e| e.to_string())?;
    }
    if version < 5 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS block_vectors (block_rowid INTEGER PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE, page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, block_id TEXT, block_type TEXT, vector TEXT NOT NULL, dims INTEGER NOT NULL, model TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS block_vectors_page_idx ON block_vectors(page_id);
             CREATE TABLE IF NOT EXISTS vector_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .map_err(|e| e.to_string())?;
    }
    if version < 6 {
        conn.execute_batch(
            "ALTER TABLE pages ADD COLUMN stable_id TEXT;
             CREATE INDEX IF NOT EXISTS pages_stable_id_idx ON pages(stable_id);",
        )
        .map_err(|e| e.to_string())?;
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(|e| e.to_string())?;
    Ok(())
}

const CJK_START: u32 = 0x3400;
const CJK_END: u32 = 0x9FFF;
const CJK_COMPAT_START: u32 = 0xF900;
const CJK_COMPAT_END: u32 = 0xFAFF;

fn is_cjk(c: char) -> bool {
    let cp = c as u32;
    (CJK_START..=CJK_END).contains(&cp) || (CJK_COMPAT_START..=CJK_COMPAT_END).contains(&cp)
}

pub fn fts_index_tokens(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let lower = text.to_lowercase();
    let chars: Vec<char> = lower.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if is_cjk(c) {
            let start = i;
            while i < chars.len() && is_cjk(chars[i]) {
                i += 1;
            }
            let run: String = chars[start..i].iter().collect();
            for ch in run.chars() {
                tokens.push(ch.to_string());
            }
            let run_chars: Vec<char> = run.chars().collect();
            for j in 0..run_chars.len().saturating_sub(1) {
                tokens.push(run_chars[j..=j + 1].iter().collect());
            }
        } else if c.is_ascii_alphanumeric() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_alphanumeric() {
                i += 1;
            }
            tokens.push(chars[start..i].iter().collect());
        } else {
            i += 1;
        }
    }
    tokens
}

fn quote_token(token: &str) -> String {
    format!("\"{}\"", token.replace('"', "\"\""))
}

pub fn fts_query_expr(query: &str) -> String {
    let mut terms = Vec::new();
    let lower = query.to_lowercase();
    let chars: Vec<char> = lower.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if is_cjk(c) {
            let start = i;
            while i < chars.len() && is_cjk(chars[i]) {
                i += 1;
            }
            let run_len = i - start;
            if run_len == 1 {
                terms.push(quote_token(&chars[start].to_string()));
            } else {
                for j in start..i - 1 {
                    let bigram: String = chars[j..=j + 1].iter().collect();
                    terms.push(quote_token(&bigram));
                }
            }
        } else if c.is_ascii_alphanumeric() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_alphanumeric() {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            terms.push(format!("{}*", quote_token(&word)));
        } else {
            i += 1;
        }
    }
    terms.join(" AND ")
}

pub struct ParsedPage {
    pub path: String,
    pub title: String,
    pub aliases: Vec<String>,
    pub stable_id: Option<String>,
    pub hash: String,
    pub body: String,
    pub tags: Vec<String>,
    pub links: Vec<ParsedLink>,
    pub blocks: Vec<ParsedBlock>,
}

pub struct ParsedLink {
    pub target_raw: String,
    pub target_name: String,
    pub link_type: String,
    pub anchor: Option<String>,
    pub source_block_index: usize,
    pub source_text: String,
}

pub struct ParsedBlock {
    pub block_id: Option<String>,
    pub block_type: String,
    pub content: String,
    pub position: usize,
}

fn parse_wikilinks(body: &str) -> Vec<ParsedLink> {
    let mut links = Vec::new();
    let mut in_fence = false;
    let mut block_index: usize = 0;
    let mut prev_blank = true;
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if trimmed.is_empty() {
            if !prev_blank {
                block_index += 1;
            }
            prev_blank = true;
            continue;
        }
        prev_blank = false;
        if in_fence || line.contains('`') {
            continue;
        }
        let mut rest = line;
        while let Some(start) = rest.find("[[") {
            let inner_start = start + 2;
            let Some(end) = rest[inner_start..].find("]]") else {
                break;
            };
            let inner = &rest[inner_start..inner_start + end];
            let (target, _alias) = match inner.find('|') {
                Some(bar) => (
                    inner[..bar].trim(),
                    Some(inner[bar + 1..].trim().to_owned()),
                ),
                None => (inner.trim(), None),
            };
            let (target, anchor) = match target.find('#') {
                Some(hash) => (target[..hash].trim(), Some(target[hash..].to_owned())),
                None => (target, None),
            };
            let target_name = target.strip_suffix(".md").unwrap_or(target).to_owned();
            if !target_name.is_empty() {
                links.push(ParsedLink {
                    target_raw: target.to_owned(),
                    target_name,
                    link_type: "wiki".to_owned(),
                    anchor,
                    source_block_index: block_index,
                    source_text: format!("[[{inner}]]"),
                });
            }
            rest = &rest[inner_start + end + 2..];
        }
    }
    links
}

fn split_blocks(body: &str) -> Vec<(String, usize)> {
    let mut blocks = Vec::new();
    let mut current = String::new();
    let mut position: usize = 0;
    let mut prev_blank = true;
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            current.push_str(line);
            current.push('\n');
            prev_blank = false;
            continue;
        }
        if trimmed.is_empty() {
            if !prev_blank && !current.trim().is_empty() {
                blocks.push((current.clone(), position));
                position += 1;
                current.clear();
            }
            prev_blank = true;
        } else {
            current.push_str(line);
            current.push('\n');
            prev_blank = false;
        }
    }
    if !current.trim().is_empty() {
        blocks.push((current, position));
    }
    blocks
}

fn parse_markdown_page(path: &str, content: &str) -> ParsedPage {
    let (frontmatter, body) = split_frontmatter(content);
    let title = first_heading(body).unwrap_or_else(|| {
        Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_owned())
    });
    let tags = if let Some(fm) = frontmatter {
        parse_fm_tags(fm)
    } else {
        Vec::new()
    };
    let links = parse_wikilinks(body);
    let blocks = split_blocks(body)
        .into_iter()
        .map(|(text, pos)| ParsedBlock {
            block_id: None,
            block_type: "text".to_owned(),
            content: text.trim().to_owned(),
            position: pos,
        })
        .collect();
    let hash = {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        content.hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    };
    ParsedPage {
        path: path.to_owned(),
        title,
        aliases: Vec::new(),
        stable_id: None,
        hash,
        body: body.to_owned(),
        tags,
        links,
        blocks,
    }
}

fn split_frontmatter(text: &str) -> (Option<&str>, &str) {
    if let Some(rest) = text.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---") {
            return (Some(&rest[..end]), &rest[end + 4..]);
        }
    }
    (None, text)
}

fn first_heading(body: &str) -> Option<String> {
    body.lines()
        .find_map(|line| line.strip_prefix("# "))
        .map(|s| s.trim().to_owned())
}

fn parse_fm_tags(frontmatter: &str) -> Vec<String> {
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

fn upsert_page(conn: &Connection, page: &ParsedPage) -> Result<(), String> {
    let aliases_json = serde_json::to_string(&page.aliases).unwrap_or_else(|_| "[]".into());
    let old: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, hash FROM pages WHERE path=?1",
            [&page.path],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    if let Some((id, ref hash)) = old {
        if hash == &page.hash {
            return Ok(());
        }
        conn.execute("DELETE FROM page_fts WHERE path=?1", [&page.path])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM links WHERE source_page_id=?1", [id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM tags WHERE page_id=?1", [id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM blocks WHERE page_id=?1", [id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM pages WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "INSERT INTO pages(path,title,aliases,hash,stable_id) VALUES(?1,?2,?3,?4,?5)",
        rusqlite::params![
            page.path,
            page.title,
            aliases_json,
            page.hash,
            page.stable_id
        ],
    )
    .map_err(|e| e.to_string())?;
    let page_id: i64 = conn
        .query_row("SELECT id FROM pages WHERE path=?1", [&page.path], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    let mut block_ids: Vec<Option<i64>> = Vec::new();
    for block in &page.blocks {
        conn.execute(
            "INSERT INTO blocks(page_id,block_id,block_type,content_text,position) VALUES(?1,?2,?3,?4,?5)",
            rusqlite::params![page_id, block.block_id, block.block_type, block.content, block.position as i64],
        )
        .map_err(|e| e.to_string())?;
        block_ids.push(Some(conn.last_insert_rowid()));
    }
    for link in &page.links {
        let source_block_id = block_ids.get(link.source_block_index).and_then(|v| *v);
        conn.execute(
            "INSERT INTO links(source_page_id,target_page_id,target_raw,target_name,link_type,anchor,source_block_id,source_text) VALUES(?1,NULL,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                page_id,
                link.target_raw,
                link.target_name,
                link.link_type,
                link.anchor,
                source_block_id,
                link.source_text,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    for tag in &page.tags {
        conn.execute(
            "INSERT INTO tags(page_id,tag_name,tag_path) VALUES(?1,?2,?3)",
            rusqlite::params![page_id, tag, tag],
        )
        .map_err(|e| e.to_string())?;
    }
    let tok = fts_index_tokens(
        &[
            page.title.clone(),
            aliases_json.clone(),
            page.tags.join(" "),
            page.body.clone(),
        ]
        .join("\n"),
    )
    .join(" ");
    conn.execute(
        "INSERT INTO page_fts(path,title,aliases,tags,content,tok) VALUES(?1,?2,?3,?4,?5,?6)",
        rusqlite::params![
            page.path,
            page.title,
            aliases_json,
            page.tags.join(" "),
            page.body,
            tok
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn resolve_links(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "UPDATE links SET target_page_id = (SELECT id FROM pages WHERE pages.path = links.target_raw OR pages.path = links.target_raw || '.md' OR pages.title = links.target_raw OR pages.path LIKE '%/' || links.target_raw || '.md') WHERE target_page_id IS NULL",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn ensure_open(root: &Path) -> Result<(), Value> {
    let mut db = DB.lock().expect("index db lock");
    let mut current = CURRENT_ROOT.lock().expect("current root lock");
    let root_str = root.display().to_string();
    if current.as_deref() == Some(root_str.as_str()) && db.is_some() {
        return Ok(());
    }
    *db = None;
    match open_database(root) {
        Ok(conn) => {
            *db = Some(conn);
            *current = Some(root_str);
            Ok(())
        }
        Err(e) => Err(error("INDEX_OPEN_FAILED", &e)),
    }
}

pub fn close() {
    *DB.lock().expect("index db lock") = None;
    *CURRENT_ROOT.lock().expect("current root lock") = None;
}

pub fn rebuild(root: &Path) -> Value {
    if let Err(e) = ensure_open(root) {
        return e;
    }
    let db_guard = DB.lock().expect("index db lock");
    let Some(conn) = db_guard.as_ref() else {
        return error("INDEX_NOT_OPEN", "Index database is not open");
    };
    let files = collect_markdown_files(root);
    let mut indexed: usize = 0;
    let _ = conn.execute("DELETE FROM page_fts", []);
    let _ = conn.execute("DELETE FROM links", []);
    let _ = conn.execute("DELETE FROM tags", []);
    let _ = conn.execute("DELETE FROM blocks", []);
    let _ = conn.execute("DELETE FROM pages", []);
    for file in &files {
        let Ok(content) = fs::read_to_string(root.join(file)) else {
            continue;
        };
        let page = parse_markdown_page(file, &content);
        if upsert_page(conn, &page).is_ok() {
            indexed += 1;
        }
    }
    let _ = resolve_links(conn);
    ok(json!({
        "phase": "ready",
        "pagesTotal": files.len(),
        "pagesIndexed": indexed,
        "mode": "full",
    }))
}

fn collect_markdown_files(root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    walk_md(root, root, &mut files);
    files.sort();
    files
}

fn walk_md(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if crate::vault_fs::EXCLUDED_DIRS.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            walk_md(root, &path, out);
        } else {
            let ext = path.extension().and_then(|v| v.to_str()).unwrap_or("");
            if ext == "md" || ext == "markdown" {
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push(rel);
            }
        }
    }
}

pub fn status(_root: &Path) -> Value {
    let db_guard = DB.lock().expect("index db lock");
    let Some(conn) = db_guard.as_ref() else {
        return ok(json!({ "phase": "idle", "pagesTotal": 0, "pagesIndexed": 0, "mode": "full" }));
    };
    let pages: i64 = conn
        .query_row("SELECT COUNT(*) FROM pages", [], |row| row.get(0))
        .unwrap_or(0);
    ok(json!({
        "phase": "ready",
        "pagesTotal": pages,
        "pagesIndexed": pages,
        "mode": "full",
    }))
}

pub fn search(root: &Path, payload: &Value) -> Value {
    if let Err(e) = ensure_open(root) {
        return e;
    }
    let query = payload.get("query").and_then(Value::as_str).unwrap_or("");
    if query.trim().is_empty() {
        return ok(json!([]));
    }
    let limit = payload.get("limit").and_then(Value::as_i64).unwrap_or(20);
    let db_guard = DB.lock().expect("index db lock");
    let Some(conn) = db_guard.as_ref() else {
        return error("INDEX_NOT_OPEN", "Index database is not open");
    };
    let expr = fts_query_expr(query);
    if expr.is_empty() {
        return ok(json!([]));
    }
    let sql = format!(
        "SELECT p.path, p.title, snippet(page_fts, 4, '', '', '…', 12) AS snippet \
         FROM page_fts f JOIN pages p ON p.path = f.path \
         WHERE page_fts MATCH '{expr}' LIMIT {limit}"
    );
    let mut stmt = match conn.prepare(&sql) {
        Ok(stmt) => stmt,
        Err(err) => return error("SEARCH_FAILED", &err.to_string()),
    };
    let results: Vec<Value> = stmt
        .query_map([], |row| {
            Ok(json!({
                "path": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "snippet": row.get::<_, String>(2)?,
            }))
        })
        .unwrap_or_else(|_| panic!(""))
        .filter_map(Result::ok)
        .collect();
    ok(json!(results))
}

pub fn backlinks(root: &Path, payload: &Value) -> Value {
    if let Err(e) = ensure_open(root) {
        return e;
    }
    let page_path = payload
        .get("pagePath")
        .and_then(Value::as_str)
        .unwrap_or("");
    let db_guard = DB.lock().expect("index db lock");
    let Some(conn) = db_guard.as_ref() else {
        return error("INDEX_NOT_OPEN", "Index database is not open");
    };
    let mut stmt = match conn.prepare(
        "SELECT p.path, p.title, l.link_type, COALESCE(l.anchor,''), COALESCE(l.source_text,''), b.content_text, b.block_id, b.position \
         FROM links l JOIN pages p ON p.id = l.source_page_id \
         LEFT JOIN blocks b ON b.id = l.source_block_id \
         WHERE l.target_page_id = (SELECT id FROM pages WHERE path = ?1 OR path = ?1 || '.md') \
         ORDER BY p.title, COALESCE(b.position, -1)",
    ) {
        Ok(stmt) => stmt,
        Err(err) => return error("BACKLINKS_FAILED", &err.to_string()),
    };
    let results: Vec<Value> = stmt
        .query_map([page_path], |row| {
            Ok(json!({
                "fromPath": row.get::<_, String>(0)?,
                "fromTitle": row.get::<_, String>(1)?,
                "linkType": row.get::<_, String>(2)?,
                "anchor": row.get::<_, String>(3)?,
                "sourceText": row.get::<_, String>(4)?,
                "blockContent": row.get::<_, Option<String>>(5)?,
                "blockId": row.get::<_, Option<String>>(6)?,
                "blockPosition": row.get::<_, Option<i64>>(7)?,
            }))
        })
        .unwrap_or_else(|_| panic!(""))
        .filter_map(Result::ok)
        .collect();
    ok(json!(results))
}

fn parse_aliases_json(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

fn folder_for_path(path: &str) -> String {
    path.rsplit_once('/')
        .map(|(folder, _)| folder.to_owned())
        .unwrap_or_default()
}

fn tags_for_page(conn: &Connection, page_id: i64) -> Vec<String> {
    let Ok(mut stmt) =
        conn.prepare("SELECT tag_name FROM tags WHERE page_id = ?1 ORDER BY tag_name")
    else {
        return Vec::new();
    };
    stmt.query_map([page_id], |row| row.get::<_, String>(0))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

fn rewrite_wikilink_target(content: &str, old_stem: &str, new_stem: &str) -> String {
    if old_stem == new_stem {
        return content.to_owned();
    }

    let mut rewritten = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(offset) = rest.find("[[") {
        let Some(relative_end) = rest[offset + 2..].find("]]") else {
            rewritten.push_str(rest);
            return rewritten;
        };

        let inner_start = offset + 2;
        let inner_end = inner_start + relative_end;
        rewritten.push_str(&rest[..inner_start]);
        let inner = &rest[inner_start..inner_end];
        let target_end = inner.find(['|', '#']).unwrap_or(inner.len());
        let (target, tail) = inner.split_at(target_end);
        let target_stem = target.strip_suffix(".md").unwrap_or(target);

        if target_stem == old_stem {
            rewritten.push_str(new_stem);
            rewritten.push_str(tail);
        } else {
            rewritten.push_str(inner);
        }
        rewritten.push_str("]]");
        rest = &rest[inner_end + 2..];
    }

    rewritten.push_str(rest);
    rewritten
}

pub fn graph(root: &Path) -> Value {
    if let Err(e) = ensure_open(root) {
        return e;
    }
    let db_guard = DB.lock().expect("index db lock");
    let Some(conn) = db_guard.as_ref() else {
        return error("INDEX_NOT_OPEN", "Index database is not open");
    };

    let mut page_stmt = match conn.prepare(
        "SELECT p.id, p.path, p.title, COALESCE(p.aliases, '[]'), \
         (SELECT COUNT(DISTINCT l.source_page_id) FROM links l WHERE l.target_page_id = p.id) AS inbound, \
         (SELECT COUNT(DISTINCT l.target_page_id) FROM links l WHERE l.source_page_id = p.id AND l.target_page_id IS NOT NULL) AS outbound \
         FROM pages p ORDER BY p.path",
    ) {
        Ok(stmt) => stmt,
        Err(err) => return error("GRAPH_FAILED", &err.to_string()),
    };
    let mut pages = Vec::new();
    let page_rows = page_stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
        ))
    });
    match page_rows {
        Ok(rows) => {
            for row in rows.filter_map(Result::ok) {
                let (page_id, path, title, aliases, inbound, outbound) = row;
                pages.push(json!({
                    "path": path,
                    "title": title,
                    "folder": folder_for_path(&path),
                    "tags": tags_for_page(conn, page_id),
                    "inboundLinks": inbound,
                    "outboundLinks": outbound,
                    "_aliases": parse_aliases_json(&aliases),
                }));
            }
        }
        Err(err) => return error("GRAPH_FAILED", &err.to_string()),
    }

    let mut link_stmt = match conn.prepare(
        "SELECT DISTINCT sp.path, tp.path \
         FROM links l \
         JOIN pages sp ON sp.id = l.source_page_id \
         JOIN pages tp ON tp.id = l.target_page_id \
         WHERE l.target_page_id IS NOT NULL \
         ORDER BY sp.path, tp.path",
    ) {
        Ok(stmt) => stmt,
        Err(err) => return error("GRAPH_FAILED", &err.to_string()),
    };
    let links: Vec<Value> = link_stmt
        .query_map([], |row| {
            Ok(json!({
                "source": row.get::<_, String>(0)?,
                "target": row.get::<_, String>(1)?,
            }))
        })
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default();

    let pages: Vec<Value> = pages
        .into_iter()
        .map(|mut page| {
            if let Some(object) = page.as_object_mut() {
                object.remove("_aliases");
            }
            page
        })
        .collect();
    ok(json!({ "pages": pages, "links": links }))
}

pub fn tag_pages(root: &Path, payload: &Value) -> Value {
    if let Err(e) = ensure_open(root) {
        return e;
    }
    let tag = payload.get("tag").and_then(Value::as_str).unwrap_or("");
    if tag.is_empty() {
        return ok(json!([]));
    }

    let db_guard = DB.lock().expect("index db lock");
    let Some(conn) = db_guard.as_ref() else {
        return error("INDEX_NOT_OPEN", "Index database is not open");
    };
    let mut stmt = match conn.prepare(
        "SELECT p.path FROM tags t JOIN pages p ON p.id = t.page_id WHERE t.tag_name = ?1 ORDER BY p.path",
    ) {
        Ok(stmt) => stmt,
        Err(err) => return error("TAG_PAGES_FAILED", &err.to_string()),
    };
    let paths: Vec<String> = stmt
        .query_map([tag], |row| row.get(0))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default();
    ok(json!(paths))
}

pub fn tags(root: &Path, payload: &Value) -> Value {
    if let Err(e) = ensure_open(root) {
        return e;
    }
    let _flat = payload.get("flat").and_then(Value::as_bool).unwrap_or(true);

    let db_guard = DB.lock().expect("index db lock");
    let Some(conn) = db_guard.as_ref() else {
        return error("INDEX_NOT_OPEN", "Index database is not open");
    };
    let mut stmt = match conn.prepare(
        "SELECT tag_name, COUNT(*) AS page_count FROM tags GROUP BY tag_name ORDER BY tag_name",
    ) {
        Ok(stmt) => stmt,
        Err(err) => return error("TAGS_FAILED", &err.to_string()),
    };
    let entries: Vec<Value> = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map(|rows| {
            rows.filter_map(Result::ok)
                .map(|(tag, page_count)| {
                    json!({
                        "tag": tag,
                        "pageCount": page_count,
                        "descendantPageCount": page_count,
                        "path": [tag],
                        "isIntermediate": false,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    ok(json!(entries))
}

pub fn page_summary(root: &Path, payload: &Value) -> Value {
    if let Err(e) = ensure_open(root) {
        return e;
    }
    let page_path = payload.get("path").and_then(Value::as_str).unwrap_or("");
    if page_path.is_empty() {
        return error("PAGE_NOT_FOUND", "Page path is required");
    }

    let db_guard = DB.lock().expect("index db lock");
    let Some(conn) = db_guard.as_ref() else {
        return error("INDEX_NOT_OPEN", "Index database is not open");
    };
    let summary = conn.query_row(
        "SELECT p.id, p.path, p.title, COALESCE(p.aliases, '[]'), COALESCE(p.updated_at, ''), \
         (SELECT COUNT(DISTINCT l.source_page_id) FROM links l WHERE l.target_page_id = p.id), \
         (SELECT COUNT(DISTINCT l.target_page_id) FROM links l WHERE l.source_page_id = p.id AND l.target_page_id IS NOT NULL) \
         FROM pages p WHERE p.path = ?1 OR p.path = ?1 || '.md'",
        [page_path],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        },
    );
    let (page_id, path, title, aliases, updated_at, inbound, outbound) = match summary {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return error("PAGE_NOT_FOUND", &format!("Page not found: {page_path}"));
        }
        Err(err) => return error("PAGE_SUMMARY_FAILED", &err.to_string()),
    };

    let body = conn
        .query_row(
            "SELECT content FROM page_fts WHERE path = ?1",
            [&path],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_default();
    let word_count = body.split_whitespace().count();
    let block_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM blocks WHERE page_id = ?1",
            [page_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    ok(json!({
        "pageId": page_id,
        "path": path,
        "title": title,
        "aliases": parse_aliases_json(&aliases),
        "tags": tags_for_page(conn, page_id),
        "updatedAt": updated_at,
        "wordCount": word_count,
        "blockCount": block_count,
        "inboundLinks": inbound,
        "outboundLinks": outbound,
    }))
}

pub fn page_summaries(root: &Path) -> Value {
    if let Err(e) = ensure_open(root) {
        return e;
    }
    let db_guard = DB.lock().expect("index db lock");
    let Some(conn) = db_guard.as_ref() else {
        return error("INDEX_NOT_OPEN", "Index database is not open");
    };
    let mut stmt = match conn
        .prepare("SELECT path, title, COALESCE(aliases, '[]') FROM pages ORDER BY path")
    {
        Ok(stmt) => stmt,
        Err(err) => return error("PAGE_SUMMARIES_FAILED", &err.to_string()),
    };
    let summaries: Vec<Value> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map(|rows| {
            rows.filter_map(Result::ok)
                .map(|(path, title, aliases)| {
                    json!({
                        "path": path,
                        "title": title,
                        "aliases": parse_aliases_json(&aliases),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    ok(json!(summaries))
}

pub fn jump_to(root: &Path, payload: &Value) -> Value {
    if let Err(e) = ensure_open(root) {
        return e;
    }
    let query = payload.get("query").and_then(Value::as_str).unwrap_or("");
    if query.trim().is_empty() {
        return ok(json!([]));
    }
    let limit = payload.get("limit").and_then(Value::as_u64).unwrap_or(10) as usize;
    let query_lower = query.to_lowercase();

    let db_guard = DB.lock().expect("index db lock");
    let Some(conn) = db_guard.as_ref() else {
        return error("INDEX_NOT_OPEN", "Index database is not open");
    };
    let mut stmt = match conn.prepare("SELECT path, title, COALESCE(aliases, '[]') FROM pages") {
        Ok(stmt) => stmt,
        Err(err) => return error("JUMP_TO_FAILED", &err.to_string()),
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    });
    let mut results = Vec::new();
    match rows {
        Ok(rows) => {
            for row in rows.filter_map(Result::ok) {
                let (path, title, aliases) = row;
                let title_lower = title.to_lowercase();
                let path_lower = path.to_lowercase();
                let aliases = parse_aliases_json(&aliases);

                let exact_title = title_lower == query_lower;
                let title_match = title_lower.contains(&query_lower);
                let alias_match = aliases
                    .iter()
                    .find(|alias| alias.to_lowercase().contains(&query_lower));
                let path_match = path_lower.contains(&query_lower);

                let rank = if exact_title {
                    0
                } else if title_match {
                    1
                } else if alias_match.is_some() {
                    2
                } else if path_match {
                    3
                } else {
                    continue;
                };
                let match_kind = if title_match {
                    "title"
                } else if alias_match.is_some() {
                    "alias"
                } else {
                    "path"
                };
                let folder = folder_for_path(&path);
                let subtitle = match match_kind {
                    "alias" => alias_match.map(String::as_str).unwrap_or_default(),
                    "path" => path.as_str(),
                    _ => folder.as_str(),
                };
                results.push((
                    rank,
                    json!({
                        "path": path,
                        "title": title,
                        "subtitle": subtitle,
                        "match": match_kind,
                    }),
                ));
            }
        }
        Err(err) => return error("JUMP_TO_FAILED", &err.to_string()),
    }

    results.sort_by_key(|(rank, _)| *rank);
    let results = results.into_iter().map(|(_, item)| item).take(limit);
    ok(json!(results.collect::<Vec<_>>()))
}

pub fn rename_linked(root: &Path, old_path: &str, new_path: &str) -> Value {
    if old_path.is_empty() || new_path.is_empty() {
        return error("RENAME_LINKED_FAILED", "Old and new paths are required");
    }
    if let Err(e) = ensure_open(root) {
        return e;
    }

    let Some(old_stem) = Path::new(old_path).file_stem().and_then(|s| s.to_str()) else {
        return error("RENAME_LINKED_FAILED", "Invalid old path");
    };
    let Some(new_stem) = Path::new(new_path).file_stem().and_then(|s| s.to_str()) else {
        return error("RENAME_LINKED_FAILED", "Invalid new path");
    };

    {
        let db_guard = DB.lock().expect("index db lock");
        let Some(conn) = db_guard.as_ref() else {
            return error("INDEX_NOT_OPEN", "Index database is not open");
        };
        if let Err(err) = conn.execute(
            "UPDATE pages SET path = ?1 WHERE path = ?2",
            rusqlite::params![new_path, old_path],
        ) {
            return error("RENAME_LINKED_FAILED", &err.to_string());
        }
    }

    for file in collect_markdown_files(root) {
        let path = root.join(&file);
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let updated = rewrite_wikilink_target(&content, old_stem, new_stem);
        if updated != content {
            if let Err(err) = fs::write(&path, updated) {
                return error("RENAME_LINKED_FAILED", &err.to_string());
            }
        }
    }

    rebuild(root)
}

#[cfg(test)]
pub(crate) use tests::with_test_lock;

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    pub(crate) fn with_test_lock<T>(operation: impl FnOnce() -> T) -> T {
        let _guard = TEST_LOCK.lock().expect("index test lock");
        operation()
    }

    fn test_vault(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nexnote-index-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create test vault");
        root
    }

    fn seed_vault(name: &str) -> PathBuf {
        close();
        let root = test_vault(name);
        fs::write(
            root.join("a.md"),
            "---\ntags: [rust]\n---\n\n# Alpha\n\nLink [[b]] and [[Missing]].\n",
        )
        .expect("write a");
        fs::write(
            root.join("b.md"),
            "---\ntags: [rust]\n---\n\n# Beta\n\nBack [[Alpha|alpha link]].\n",
        )
        .expect("write b");
        fs::write(
            root.join("c.md"),
            "---\ntags:\n  - notes/depth\n---\n\n# Gamma\n",
        )
        .expect("write c");
        root
    }

    #[test]
    fn graph_tags_summaries_and_jump_use_resolved_index() {
        with_test_lock(|| {
            let root = seed_vault("queries");
            assert_eq!(rebuild(&root)["ok"], json!(true));

            let graph = graph(&root);
            assert_eq!(graph["ok"], json!(true));
            assert_eq!(graph["data"]["pages"].as_array().unwrap().len(), 3);
            let links = graph["data"]["links"].as_array().unwrap();
            assert_eq!(links.len(), 2);
            assert!(links.contains(&json!({ "source": "a.md", "target": "b.md" })));
            assert!(links.contains(&json!({ "source": "b.md", "target": "a.md" })));

            let tag_pages = tag_pages(&root, &json!({ "tag": "rust" }));
            assert_eq!(tag_pages["data"], json!(["a.md", "b.md"]));

            let tags = tags(&root, &json!({ "flat": true }));
            let tags = tags["data"].as_array().unwrap();
            assert_eq!(tags.len(), 2);
            assert!(tags.contains(&json!({
                "tag": "rust",
                "pageCount": 2,
                "descendantPageCount": 2,
                "path": ["rust"],
                "isIntermediate": false,
            })));

            let summary = page_summary(&root, &json!({ "path": "a.md" }));
            assert_eq!(summary["data"]["inboundLinks"], json!(1));
            assert_eq!(summary["data"]["outboundLinks"], json!(1));
            assert_eq!(summary["data"]["blockCount"], json!(2));
            assert_eq!(summary["data"]["tags"], json!(["rust"]));

            let summaries = page_summaries(&root);
            assert_eq!(summaries["data"].as_array().unwrap().len(), 3);

            let jumps = jump_to(&root, &json!({ "query": "beta", "limit": 10 }));
            assert_eq!(jumps["data"][0]["path"], json!("b.md"));
            assert_eq!(jumps["data"][0]["match"], json!("title"));

            close();
            let _ = fs::remove_dir_all(root);
        });
    }

    #[test]
    fn rename_linked_updates_wikilinks_and_index() {
        with_test_lock(|| {
            let root = seed_vault("rename");
            assert_eq!(rebuild(&root)["ok"], json!(true));

            fs::create_dir(root.join("docs")).expect("create docs");
            fs::rename(root.join("b.md"), root.join("docs/renamed.md")).expect("rename file");
            let result = rename_linked(&root, "b.md", "docs/renamed.md");
            assert_eq!(result["ok"], json!(true));
            let content = fs::read_to_string(root.join("a.md")).expect("read renamed target");
            assert!(content.contains("[[renamed]]"));

            let graph = graph(&root);
            assert!(graph["data"]["links"]
                .as_array()
                .unwrap()
                .contains(&json!({ "source": "a.md", "target": "docs/renamed.md" })));

            close();
            let _ = fs::remove_dir_all(root);
        });
    }
}
