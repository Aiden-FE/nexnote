//! Three-stage progressive retrieval (DEV-011 contract) over the Rust index.
//!
//! Stage one narrows the vault with FTS (term-wise tiers), stage two expands
//! one-hop link neighbours, stage three reranks with embeddings. When the
//! embedding runtime is unavailable — not enabled, not downloaded, or still
//! building — retrieval degrades to the first two stages and says so explicitly
//! instead of failing the whole call.

use crate::embedding_service::{self, EmbeddingState, InputRole};
use crate::index_service::{self, db_handle, CandidateBlock};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

const TIER_BASE: [(&str, f64); 4] = [
    ("title", 4.0),
    ("tag", 3.0),
    ("alias", 2.0),
    ("content", 1.0),
];
const LINK_BASE: f64 = 0.3;
const NEIGHBOR_BLOCK_CAP: usize = 60;
const BUILD_BATCH_SIZE: usize = 48;

static BUILDING: AtomicBool = AtomicBool::new(false);

/// Owned vector row staged during a build before it is written as a batch.
type OwnedVectorItem = (i64, Option<String>, String, Vec<f64>, String);

/// Where stage-three embeddings come from. Built-in keeps text on-device; the
/// remote variant is an explicit user configuration (ADR-0027).
pub enum Embedder {
    BuiltIn {
        state: std::sync::Arc<EmbeddingState>,
        profile_id: String,
    },
    Remote {
        base_url: String,
        model: String,
        profile_id: String,
    },
}

impl Embedder {
    /// Stable identity used both for result metadata and for detecting vector
    /// generations that no longer match the active embedder.
    pub fn model(&self) -> String {
        match self {
            Self::BuiltIn { .. } => embedding_service::model_identity(),
            Self::Remote { model, .. } => model.clone(),
        }
    }

    fn embed(&self, role: InputRole, texts: &[String]) -> Result<Vec<Vec<f64>>, String> {
        match self {
            Self::BuiltIn { state, .. } => Ok(state
                .embed(role, texts)?
                .into_iter()
                .map(|vector| vector.into_iter().map(f64::from).collect())
                .collect()),
            Self::Remote {
                base_url, model, ..
            } => crate::ai_service::embed(base_url, None, model, texts),
        }
    }
}

/// Parses the retrieval channel payload with the shared defaults.
pub struct RetrievalRequest {
    pub query: String,
    pub top_k: usize,
    pub fts_limit: usize,
    pub budget_chars: usize,
    pub confidence_weight: f64,
    pub disable_vector: bool,
}

impl RetrievalRequest {
    pub fn from_payload(payload: &Value) -> Self {
        let query = payload
            .get("query")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        Self {
            query,
            top_k: payload
                .get("topK")
                .and_then(Value::as_u64)
                .map_or(8, |value| value as usize),
            fts_limit: payload
                .get("ftsLimit")
                .and_then(Value::as_u64)
                .map_or(20, |value| value as usize),
            budget_chars: payload
                .get("budgetChars")
                .and_then(Value::as_u64)
                .map_or(4000, |value| value as usize),
            confidence_weight: payload
                .get("confidenceWeight")
                .and_then(Value::as_f64)
                .unwrap_or(0.3),
            disable_vector: payload
                .get("disableVector")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        }
    }
}

struct ScoredSource {
    block: CandidateBlock,
    score: f64,
    vector_sim: Option<f64>,
    confidence: Option<f64>,
    via: &'static str,
}

/// Runs the three-stage pipeline for one open vault.
///
/// `root` identifies the index database; the caller has already validated the
/// vault. When the stored vector generation does not match the active embedder,
/// a background rebuild is started (at most one at a time) and this call
/// degrades to two stages with a note, exactly like the reference behavior.
pub fn retrieve(root: &Path, request: &RetrievalRequest, embedder: Option<&Embedder>) -> Value {
    let query = request.query.trim().to_string();
    if query.is_empty() {
        return degraded_response(&query, "empty query");
    }

    let tier_base = |tier: &str| {
        TIER_BASE
            .iter()
            .find(|(name, _)| *name == tier)
            .map_or(1.0, |(_, base)| *base)
    };

    let mut sources: std::collections::HashMap<i64, ScoredSource> =
        std::collections::HashMap::new();
    let mut stages: Vec<Value> = Vec::new();

    // Stage one: FTS page-level coarse filtering.
    let started = std::time::Instant::now();
    let guard = db_handle();
    let Some(conn) = guard.as_ref() else {
        return degraded_response(&query, "index not open");
    };
    let hits = index_service::search_page_hits(conn, &query, request.fts_limit);
    let seed_paths: Vec<String> = hits.iter().map(|hit| hit.path.clone()).collect();
    let stage_one = index_service::blocks_for_paths(conn, &seed_paths);
    let tier_by_path: std::collections::HashMap<&str, &str> = hits
        .iter()
        .map(|hit| (hit.path.as_str(), hit.tier))
        .collect();
    for block in &stage_one {
        let tier = tier_by_path
            .get(block.path.as_str())
            .copied()
            .unwrap_or("content");
        sources.insert(
            block.block_rowid,
            ScoredSource {
                block: block.clone(),
                score: tier_base(tier),
                vector_sim: None,
                confidence: None,
                via: "fts",
            },
        );
    }
    stages.push(json!({
        "stage": "fts",
        "candidates": stage_one.len(),
        "elapsedMs": started.elapsed().as_millis() as u64,
        "enabled": true,
    }));

    // Stage two: bidirectional one-hop neighbours.
    let started = std::time::Instant::now();
    let neighbor_paths = index_service::neighbor_paths(conn, &seed_paths);
    let mut neighbor_blocks = index_service::blocks_for_paths(conn, &neighbor_paths);
    neighbor_blocks.truncate(NEIGHBOR_BLOCK_CAP);
    for block in &neighbor_blocks {
        let entry = sources.entry(block.block_rowid);
        entry.or_insert_with(|| ScoredSource {
            block: block.clone(),
            score: LINK_BASE,
            vector_sim: None,
            confidence: None,
            via: "links",
        });
    }
    stages.push(json!({
        "stage": "links",
        "candidates": neighbor_blocks.len(),
        "elapsedMs": started.elapsed().as_millis() as u64,
        "enabled": true,
    }));

    // Stage three: embedding rerank. Any failure here degrades explicitly.
    let started = std::time::Instant::now();
    let mut degraded = request.disable_vector;
    let mut model: Option<String> = None;
    if !degraded {
        match embedder {
            None => {
                degraded = true;
                stages.push(json!({
                    "stage": "vector",
                    "candidates": 0,
                    "elapsedMs": started.elapsed().as_millis() as u64,
                    "enabled": false,
                    "note": "retrieval.vectorDegraded",
                }));
            }
            Some(active) => {
                model = Some(active.model());
                let rebuild_needed = {
                    let coverage = index_service::vector_coverage(conn);
                    coverage.vectors == 0
                        || coverage.model.as_deref() != Some(active.model().as_str())
                };
                if rebuild_needed {
                    maybe_start_background_rebuild(root.to_path_buf(), active);
                    degraded = true;
                    stages.push(json!({
                        "stage": "vector",
                        "candidates": 0,
                        "elapsedMs": started.elapsed().as_millis() as u64,
                        "enabled": false,
                        "note": "vector index building",
                    }));
                } else {
                    match rerank_with_vectors(
                        conn,
                        active,
                        &query,
                        request.confidence_weight,
                        &mut sources,
                    ) {
                        Ok(()) => degraded = false,
                        Err(error) => {
                            degraded = true;
                            model = None;
                            stages.push(json!({
                                "stage": "vector",
                                "candidates": 0,
                                "elapsedMs": started.elapsed().as_millis() as u64,
                                "enabled": false,
                                "note": error,
                            }));
                        }
                    }
                }
            }
        }
    }
    if !stages.iter().any(|stage| stage["stage"] == "vector") {
        let vector_note = if degraded {
            json!("retrieval.vectorDegraded")
        } else {
            Value::Null
        };
        stages.push(json!({
            "stage": "vector",
            "candidates": sources.len(),
            "elapsedMs": started.elapsed().as_millis() as u64,
            "enabled": !degraded,
            "note": vector_note,
        }));
    }
    drop(guard);

    let mut ranked: Vec<&ScoredSource> = sources.values().collect();
    ranked.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    ranked.truncate(request.top_k);
    let context_text = pack_context(&ranked, request.budget_chars);
    let sources_json: Vec<Value> = ranked
        .iter()
        .map(|source| {
            json!({
                "path": source.block.path,
                "title": source.block.title,
                "blockId": source.block.block_id,
                "blockType": source.block.block_type,
                "snippet": clamp_snippet(&source.block.content, 180),
                "score": round4(source.score),
                "vectorSim": source.vector_sim.map(round4),
                "confidenceScore": source.confidence,
                "via": source.via,
            })
        })
        .collect();

    json!({
        "query": query,
        "degraded": degraded,
        "model": model,
        "contextText": context_text,
        "sources": sources_json,
        "stages": stages,
    })
}

fn rerank_with_vectors(
    conn: &rusqlite::Connection,
    embedder: &Embedder,
    query: &str,
    confidence_weight: f64,
    sources: &mut std::collections::HashMap<i64, ScoredSource>,
) -> Result<(), String> {
    let rowids: Vec<i64> = sources.keys().copied().collect();
    let query_vectors = embedder.embed(InputRole::Query, &[query.to_string()])?;
    let Some(query_vector) = query_vectors.into_iter().next() else {
        return Err("query embedding returned no vector".to_string());
    };
    let stored = index_service::vectors_for_blocks(conn, &rowids);
    if stored.is_empty() {
        return Err("no stored vectors for candidates".to_string());
    }
    let by_rowid: std::collections::HashMap<i64, &index_service::VectorRow> =
        stored.iter().map(|row| (row.block_rowid, row)).collect();
    let confidence_weight = confidence_weight.clamp(0.0, 1.0);
    for source in sources.values_mut() {
        let Some(row) = by_rowid.get(&source.block.block_rowid) else {
            continue;
        };
        let similarity = cosine(&query_vector, &row.vector);
        let confidence = index_service::confidence_score(conn, source.block.page_id);
        let confidence01 = confidence.map_or(1.0, |value| (value / 100.0).clamp(0.0, 1.0));
        source.vector_sim = Some(similarity);
        source.confidence = confidence;
        source.score = (source.score + similarity * 3.0)
            * (1.0 - confidence_weight + confidence_weight * confidence01);
    }
    Ok(())
}

/// Starts a full vector rebuild unless one is already running. Runs off-thread:
/// batches lock the index briefly, embed unlocked, then write, so retrieval
/// stays responsive while the index fills.
fn maybe_start_background_rebuild(root: std::path::PathBuf, embedder: &Embedder) {
    if BUILDING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let embedder = match embedder {
        Embedder::BuiltIn { state, profile_id } => Embedder::BuiltIn {
            state: state.clone(),
            profile_id: profile_id.clone(),
        },
        Embedder::Remote {
            base_url,
            model,
            profile_id,
        } => Embedder::Remote {
            base_url: base_url.clone(),
            model: model.clone(),
            profile_id: profile_id.clone(),
        },
    };
    let _ = std::thread::Builder::new()
        .name("nexnote-vector-build".to_string())
        .spawn(move || {
            let result = build_all_vectors(&root, &embedder, |blocks_done, blocks_total, model| {
                if let Some(callback) = BUILD_PROGRESS_CALLBACK.get() {
                    callback(blocks_done, blocks_total, model);
                }
            });
            if let (Some(callback), Err(error)) = (BUILD_PROGRESS_CALLBACK.get(), &result) {
                callback(0, 0, &format!("error:{error}"));
            }
            BUILDING.store(false, Ordering::SeqCst);
        });
}

/// Progress hook installed once by the product layer so build status can be
/// emitted as `ai:retrievalStatus` events. `(blocks_done, blocks_total, note)` —
/// a non-empty `note` starting with "error:" marks a failed build.
pub type BuildProgressHook = Box<dyn Fn(u64, u64, &str) + Send + Sync>;
pub static BUILD_PROGRESS_CALLBACK: std::sync::OnceLock<BuildProgressHook> =
    std::sync::OnceLock::new();

/// Embeds every block and replaces the vector index page by page.
/// `on_progress` reports cumulative progress per batch.
pub fn build_all_vectors(
    root: &Path,
    embedder: &Embedder,
    mut on_progress: impl FnMut(u64, u64, &str),
) -> Result<(), String> {
    // `ensure_open` reports failures as the shared JSON error envelope.
    index_service::ensure_open(root).map_err(|failure| failure.to_string())?;
    let mut blocks_by_page: std::collections::BTreeMap<i64, Vec<CandidateBlock>> =
        std::collections::BTreeMap::new();
    {
        let guard = db_handle();
        let Some(conn) = guard.as_ref() else {
            return Err("index not open".to_string());
        };
        for block in index_service::all_blocks(conn) {
            blocks_by_page.entry(block.page_id).or_default().push(block);
        }
    }
    let blocks_total: u64 = blocks_by_page.values().map(Vec::len).sum::<usize>() as u64;
    let mut blocks_done: u64 = 0;
    for (_page_id, page_blocks) in blocks_by_page {
        let mut items: Vec<OwnedVectorItem> = Vec::with_capacity(page_blocks.len());
        for chunk in page_blocks.chunks(BUILD_BATCH_SIZE) {
            let texts: Vec<String> = chunk.iter().map(|block| block.content.clone()).collect();
            let vectors = embedder.embed(InputRole::Passage, &texts)?;
            for (block, vector) in chunk.iter().zip(vectors) {
                if vector.len() as u32 != embedding_service::MODEL_DIMENSIONS {
                    return Err(format!(
                        "vector dimension mismatch: got {}, expected {}",
                        vector.len(),
                        embedding_service::MODEL_DIMENSIONS
                    ));
                }
                items.push((
                    block.block_rowid,
                    block.block_id.clone(),
                    block.block_type.clone(),
                    vector,
                    embedder.model(),
                ));
            }
            blocks_done += chunk.len() as u64;
            on_progress(blocks_done, blocks_total, embedder.model().as_str());
        }
        let mut guard = db_handle();
        let Some(conn) = guard.as_mut() else {
            return Err("index not open".to_string());
        };
        let borrowed: Vec<index_service::PageVectorItem<'_>> = items
            .iter()
            .map(|(rowid, block_id, block_type, vector, model)| {
                (
                    *rowid,
                    block_id.as_deref(),
                    block_type.as_str(),
                    vector.as_slice(),
                    model.as_str(),
                )
            })
            .collect();
        index_service::replace_page_vectors(conn, _page_id, &borrowed)?;
    }
    {
        let guard = db_handle();
        let Some(conn) = guard.as_ref() else {
            return Err("index not open".to_string());
        };
        index_service::set_vector_meta(conn, "embedding_model", &embedder.model())?;
    }
    Ok(())
}

fn cosine(left: &[f64], right: &[f64]) -> f64 {
    if left.is_empty() || left.len() != right.len() {
        return 0.0;
    }
    let dot: f64 = left.iter().zip(right).map(|(l, r)| l * r).sum();
    let norm_left = left.iter().map(|value| value * value).sum::<f64>().sqrt();
    let norm_right = right.iter().map(|value| value * value).sum::<f64>().sqrt();
    if norm_left <= f64::EPSILON || norm_right <= f64::EPSILON {
        return 0.0;
    }
    dot / (norm_left * norm_right)
}

fn clamp_snippet(text: &str, max: usize) -> String {
    let clean: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.chars().count() <= max {
        clean
    } else {
        let cut: String = clean.chars().take(max).collect();
        format!("{cut}…")
    }
}

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn pack_context(ranked: &[&ScoredSource], budget_chars: usize) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut used = 0usize;
    for source in ranked {
        let anchor = source
            .block
            .block_id
            .as_deref()
            .map(|id| format!(" [^{id}]"))
            .unwrap_or_default();
        let block = format!(
            "《{}》{}\n{}",
            source.block.title,
            anchor,
            clamp_snippet(&source.block.content, 180)
        );
        if used + block.chars().count() > budget_chars {
            break;
        }
        used += block.chars().count() + 2;
        parts.push(block);
    }
    parts.join("\n\n")
}

fn degraded_response(query: &str, note: &str) -> Value {
    json!({
        "query": query,
        "degraded": true,
        "model": Value::Null,
        "contextText": "",
        "sources": [],
        "stages": [
            { "stage": "fts", "candidates": 0, "elapsedMs": 0, "enabled": false, "note": note },
            { "stage": "links", "candidates": 0, "elapsedMs": 0, "enabled": false, "note": note },
            { "stage": "vector", "candidates": 0, "elapsedMs": 0, "enabled": false, "note": "retrieval.vectorDegraded" },
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_matches_reference_behavior() {
        assert!((cosine(&[1.0, 0.0], &[1.0, 0.0]) - 1.0).abs() < 1e-9);
        assert!((cosine(&[1.0, 0.0], &[0.0, 1.0])).abs() < 1e-9);
        assert!((cosine(&[1.0, 0.0], &[-1.0, 0.0]) + 1.0).abs() < 1e-9);
        assert_eq!(cosine(&[], &[1.0]), 0.0);
        assert_eq!(cosine(&[1.0], &[1.0, 2.0]), 0.0);
    }

    #[test]
    fn request_defaults_match_the_shared_contract() {
        let request = RetrievalRequest::from_payload(&json!({ "query": "hello" }));
        assert_eq!(request.top_k, 8);
        assert_eq!(request.fts_limit, 20);
        assert_eq!(request.budget_chars, 4000);
        assert!((request.confidence_weight - 0.3).abs() < 1e-9);
        assert!(!request.disable_vector);

        let custom = RetrievalRequest::from_payload(&json!({
            "query": "hello",
            "topK": 3,
            "disableVector": true,
        }));
        assert_eq!(custom.top_k, 3);
        assert!(custom.disable_vector);
    }

    #[test]
    fn snippet_is_clamped_with_ellipsis() {
        assert_eq!(clamp_snippet("  a   b  ", 10), "a b");
        let long = clamp_snippet(&"x".repeat(300), 180);
        assert_eq!(long.chars().count(), 181);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn empty_query_degrades_without_touching_the_index() {
        let response = retrieve(
            Path::new("/nonexistent-vault"),
            &RetrievalRequest::from_payload(&json!({ "query": "   " })),
            None,
        );
        assert_eq!(response["degraded"], json!(true));
        assert_eq!(response["sources"].as_array().map(Vec::len), Some(0));
    }
}
