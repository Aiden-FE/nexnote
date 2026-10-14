//! Built-in semantic embedding runtime (ADR-0027, DEV-121).
//!
//! The model is never bundled with the installer. A user who explicitly enables
//! the built-in embedding profile triggers a download of three files at a fixed
//! Hugging Face revision: int8 ONNX weights, the fast tokenizer and the license
//! material. Every file is streamed to a temp file while being hashed, verified
//! by length and SHA-256, and only then atomically renamed into the cache, so a
//! corrupted, partial or tampered download can never be executed. Missing,
//! unverified or failed downloads degrade retrieval to FTS + backlinks instead
//! of silently shipping vault text to a remote service.

use ndarray::Array2;
use ort::session::Session;
use ort::value::Tensor;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokenizers::{PaddingParams, PaddingStrategy, Tokenizer, TruncationParams};

/// Fixed upstream revision. Never resolve a branch or tag: the identity must
/// stay reproducible so different bytes can never be mixed into one generation.
pub const MODEL_REPO: &str = "Xenova/multilingual-e5-small";
pub const MODEL_REVISION: &str = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
/// Upstream project (`intfloat/multilingual-e5-small`) revision whose model card
/// declares the MIT license in its metadata.
const UPSTREAM_REPO: &str = "intfloat/multilingual-e5-small";
const UPSTREAM_REVISION: &str = "614241f622f53c4eeff9890bdc4f31cfecc418b3";

/// multilingual-e5-small is a 12-layer XLM-R encoder with 384 hidden units.
pub const MODEL_DIMENSIONS: u32 = 384;
pub const MODEL_DTYPE: &str = "int8";
pub const MODEL_METRIC: &str = "cosine";
pub const MODEL_LICENSE: &str = "MIT";
const MAX_SEQUENCE_LENGTH: usize = 512;
const EMBED_BATCH_SIZE: usize = 48;

/// One pinned, checksummed download artifact.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ModelFile {
    repo: &'static str,
    revision: &'static str,
    remote_path: &'static str,
    local_name: &'static str,
    size_bytes: u64,
    sha256: &'static str,
}

const MODEL_FILE: ModelFile = ModelFile {
    repo: MODEL_REPO,
    revision: MODEL_REVISION,
    remote_path: "onnx/model_int8.onnx",
    local_name: "model_int8.onnx",
    size_bytes: 118_054_593,
    sha256: "4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c",
};

const TOKENIZER_FILE: ModelFile = ModelFile {
    repo: MODEL_REPO,
    revision: MODEL_REVISION,
    remote_path: "tokenizer.json",
    local_name: "tokenizer.json",
    size_bytes: 17_082_730,
    sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
};

/// License material travels with the cache so an offline install can still show
/// the model card and its declared license.
const LICENSE_FILE: ModelFile = ModelFile {
    repo: UPSTREAM_REPO,
    revision: UPSTREAM_REVISION,
    remote_path: "README.md",
    local_name: "MODEL_CARD_LICENSE.md",
    size_bytes: 497_538,
    sha256: "0038de97aee16258cecbad7ffda4b4febd6953e747a00e0ddbc8e6ed241e9c1c",
};

const MODEL_FILES: [ModelFile; 3] = [MODEL_FILE, TOKENIZER_FILE, LICENSE_FILE];

/// Which e5 input role a batch of texts plays. The model card is explicit that a
/// missing prefix significantly degrades retrieval quality, so callers declare
/// the role instead of writing the prefix themselves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputRole {
    Query,
    Passage,
}

impl InputRole {
    pub fn prefix(self) -> &'static str {
        match self {
            Self::Query => "query: ",
            Self::Passage => "passage: ",
        }
    }
}

/// Applies the role prefix required by multilingual-e5.
pub fn with_prefix(role: InputRole, text: &str) -> String {
    format!("{}{}", role.prefix(), text.trim())
}

/// Model identity. Per ADR-0027 this covers model, revision, dtype, dimension
/// and metric; any change means a new generation and a full rebuild, so vectors
/// of different identities may never be ranked together.
pub fn model_identity() -> String {
    format!("{MODEL_REPO}@{MODEL_REVISION}:{MODEL_DTYPE}:{MODEL_DIMENSIONS}:{MODEL_METRIC}")
}

/// Download progress for the renderer-facing status channel.
#[derive(Debug, Clone, PartialEq)]
pub struct DownloadProgress {
    pub file: &'static str,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub done: bool,
}

pub struct LoadedModel {
    session: Mutex<Session>,
    tokenizer: Tokenizer,
}

/// Process-wide handle to the on-disk model cache and the loaded session.
pub struct EmbeddingState {
    model_dir: PathBuf,
    runtime: Mutex<Option<Arc<LoadedModel>>>,
    downloading: Mutex<bool>,
}

impl EmbeddingState {
    /// The cache lives in app data, never inside a vault: it is derived data a
    /// user may delete and re-download at any time.
    pub fn new(app_data: &Path) -> Self {
        Self {
            model_dir: app_data.join("embedding").join("multilingual-e5-small"),
            runtime: Mutex::new(None),
            downloading: Mutex::new(false),
        }
    }

    /// Single-flight guard: two wizard clicks must not race on the same files.
    pub fn begin_download(&self) -> Result<(), String> {
        let mut downloading = self.downloading.lock().expect("embedding download lock");
        if *downloading {
            return Err("A built-in model download is already running".to_string());
        }
        *downloading = true;
        Ok(())
    }

    pub fn end_download(&self) {
        *self.downloading.lock().expect("embedding download lock") = false;
    }

    pub fn is_downloading(&self) -> bool {
        *self.downloading.lock().expect("embedding download lock")
    }

    /// Absolute path of the derived cache; never inside a vault.
    #[cfg(test)]
    pub fn model_dir(&self) -> &Path {
        &self.model_dir
    }

    /// Drops the in-memory session so the next use re-reads disk. Called after a
    /// completed download and after a delete.
    pub fn invalidate_runtime(&self) {
        *self.runtime.lock().expect("embedding runtime lock") = None;
    }

    /// Downloads and verifies every pinned file unless a valid copy already
    /// exists. Each file lands atomically: the temp file is only renamed to its
    /// final name after its length and digest match, so a partial or corrupt
    /// download is never loaded and never left behind for a later run to pick up.
    pub fn ensure_downloaded(
        &self,
        mut on_progress: impl FnMut(DownloadProgress),
    ) -> Result<(), String> {
        fs::create_dir_all(&self.model_dir).map_err(|error| {
            format!(
                "Failed to create the built-in model directory {}: {error}",
                self.model_dir.display()
            )
        })?;
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|error| format!("Failed to prepare the model download client: {error}"))?;

        for file in MODEL_FILES {
            let target = self.model_dir.join(file.local_name);
            if verify_file(&target, file).is_ok() {
                on_progress(DownloadProgress {
                    file: file.local_name,
                    downloaded_bytes: file.size_bytes,
                    total_bytes: file.size_bytes,
                    done: true,
                });
                continue;
            }
            download_file(&client, file, &target, &mut on_progress)?;
        }
        self.invalidate_runtime();
        Ok(())
    }

    /// Renderer-visible cache state. `downloaded` is true only when every pinned
    /// file passes its own digest check right now.
    pub fn status(&self) -> Value {
        let files: Vec<Value> = MODEL_FILES
            .iter()
            .map(|file| {
                let path = self.model_dir.join(file.local_name);
                let present = path.is_file();
                let verified = verify_file(&path, *file).is_ok();
                json!({
                    "name": file.local_name,
                    "remotePath": file.remote_path,
                    "sizeBytes": file.size_bytes,
                    "sha256": file.sha256,
                    "present": present,
                    "verified": verified,
                })
            })
            .collect();
        let verified_count = files
            .iter()
            .filter(|file| file.get("verified") == Some(&Value::Bool(true)))
            .count();
        let loaded = self
            .runtime
            .lock()
            .expect("embedding runtime lock")
            .is_some();
        json!({
            "identity": model_identity(),
            "model": MODEL_REPO,
            "revision": MODEL_REVISION,
            "dtype": MODEL_DTYPE,
            "dimensions": MODEL_DIMENSIONS,
            "metric": MODEL_METRIC,
            "license": MODEL_LICENSE,
            "rolePrefixes": {
                "query": InputRole::Query.prefix(),
                "passage": InputRole::Passage.prefix(),
            },
            "directory": self.model_dir.display().to_string(),
            "files": files,
            "downloaded": verified_count == MODEL_FILES.len(),
            "downloading": self.is_downloading(),
            "loaded": loaded,
        })
    }

    /// Deletes the derived cache and unloads the session. The next explicit
    /// enable re-downloads the same pinned bytes.
    pub fn delete(&self) -> Result<(), String> {
        self.invalidate_runtime();
        if self.model_dir.exists() {
            fs::remove_dir_all(&self.model_dir).map_err(|error| {
                format!(
                    "Failed to delete the built-in model cache {}: {error}",
                    self.model_dir.display()
                )
            })?;
        }
        Ok(())
    }

    /// Loads the session on first use and reuses it afterwards.
    pub fn runtime(&self) -> Result<Arc<LoadedModel>, String> {
        if let Some(runtime) = self.runtime.lock().expect("embedding runtime lock").clone() {
            return Ok(runtime);
        }
        for file in MODEL_FILES {
            let path = self.model_dir.join(file.local_name);
            verify_file(&path, file).map_err(|error| {
                format!(
                    "The built-in embedding model is not available ({error}). Enable it and download the pinned files first."
                )
            })?;
        }
        let session = Session::builder()
            .map_err(|error| format!("Failed to create the ONNX session builder: {error}"))?
            .commit_from_file(self.model_dir.join(MODEL_FILE.local_name))
            .map_err(|error| format!("Failed to load the built-in ONNX model: {error}"))?;
        let mut tokenizer = Tokenizer::from_file(self.model_dir.join(TOKENIZER_FILE.local_name))
            .map_err(|error| format!("Failed to load the built-in tokenizer: {error}"))?;
        tokenizer
            .with_padding(Some(PaddingParams {
                strategy: PaddingStrategy::BatchLongest,
                ..Default::default()
            }))
            .with_truncation(Some(TruncationParams {
                max_length: MAX_SEQUENCE_LENGTH,
                ..Default::default()
            }))
            .map_err(|error| format!("Failed to configure the built-in tokenizer: {error}"))?;
        let loaded = Arc::new(LoadedModel {
            session: Mutex::new(session),
            tokenizer,
        });
        *self.runtime.lock().expect("embedding runtime lock") = Some(loaded.clone());
        Ok(loaded)
    }

    /// Embeds texts with the built-in model. Callers pass the semantic role;
    /// the prefix is applied here so no call site can forget it.
    pub fn embed(&self, role: InputRole, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let runtime = self.runtime()?;
        embed_texts(&runtime, role, texts)
    }
}

/// Streams one artifact to `<target>.part` while hashing, verifies length and
/// digest, and only after both pass atomically renames it onto the target name.
fn download_file(
    client: &reqwest::blocking::Client,
    file: ModelFile,
    target: &Path,
    on_progress: &mut impl FnMut(DownloadProgress),
) -> Result<(), String> {
    let part = target.with_extension("part");
    let _ = fs::remove_file(&part);
    let url = format!(
        "https://huggingface.co/{}/resolve/{}/{}",
        file.repo, file.revision, file.remote_path
    );
    let mut response = client
        .get(url)
        .send()
        .map_err(|error| format!("Failed to download {}: {error}", file.local_name))?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download {}: HTTP {}",
            file.local_name,
            response.status()
        ));
    }
    let mut stream = fs::File::create(&part)
        .map_err(|error| format!("Failed to create {}: {error}", part.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("Failed to download {}: {error}", file.local_name))?;
        if read == 0 {
            break;
        }
        stream
            .write_all(&buffer[..read])
            .map_err(|error| format!("Failed to write {}: {error}", part.display()))?;
        hasher.update(&buffer[..read]);
        downloaded += read as u64;
        on_progress(DownloadProgress {
            file: file.local_name,
            downloaded_bytes: downloaded,
            total_bytes: file.size_bytes,
            done: false,
        });
    }
    stream
        .flush()
        .map_err(|error| format!("Failed to flush {}: {error}", part.display()))?;
    drop(stream);

    let actual = hex::encode(hasher.finalize());
    if downloaded != file.size_bytes || actual != file.sha256 {
        // Never promote an unverified artifact, and never keep it around for a
        // later run to pick up by accident.
        let _ = fs::remove_file(&part);
        return Err(format!(
            "Verification failed for {}: expected {} bytes / {}, got {} bytes / {}",
            file.local_name, file.size_bytes, file.sha256, downloaded, actual
        ));
    }
    // The verified part file becomes the cache entry atomically.
    fs::rename(&part, target).map_err(|error| {
        let _ = fs::remove_file(&part);
        format!("Failed to promote {}: {error}", part.display())
    })?;
    on_progress(DownloadProgress {
        file: file.local_name,
        downloaded_bytes: file.size_bytes,
        total_bytes: file.size_bytes,
        done: true,
    });
    Ok(())
}

/// Length + digest check for one cached file.
fn verify_file(path: &Path, file: ModelFile) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("{} is missing: {error}", file.local_name))?;
    if metadata.len() != file.size_bytes {
        return Err(format!(
            "{} has {} bytes, expected {}",
            file.local_name,
            metadata.len(),
            file.size_bytes
        ));
    }
    let mut hasher = Sha256::new();
    let mut stream = fs::File::open(path)
        .map_err(|error| format!("Failed to read {}: {error}", file.local_name))?;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = stream
            .read(&mut buffer)
            .map_err(|error| format!("Failed to read {}: {error}", file.local_name))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = hex::encode(hasher.finalize());
    if actual != file.sha256 {
        return Err(format!(
            "{} digest mismatch: expected {}, got {}",
            file.local_name, file.sha256, actual
        ));
    }
    Ok(())
}

/// Tokenizes in fixed-size batches, runs the session and applies
/// attention-masked mean pooling plus L2 normalization, matching
/// sentence-transformers pooling for this export.
fn embed_texts(
    runtime: &LoadedModel,
    role: InputRole,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, String> {
    let prefixed: Vec<String> = texts.iter().map(|text| with_prefix(role, text)).collect();
    let mut vectors = Vec::with_capacity(prefixed.len());
    for batch in prefixed.chunks(EMBED_BATCH_SIZE) {
        vectors.extend(embed_batch(runtime, batch)?);
    }
    Ok(vectors)
}

fn embed_batch(runtime: &LoadedModel, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    let encodings = runtime
        .tokenizer
        .encode_batch(texts.to_vec(), true)
        .map_err(|error| format!("Built-in tokenization failed: {error}"))?;
    let mut ids: Vec<Vec<i64>> = Vec::with_capacity(encodings.len());
    let mut mask: Vec<Vec<i64>> = Vec::with_capacity(encodings.len());
    let mut type_ids: Vec<Vec<i64>> = Vec::with_capacity(encodings.len());
    for encoding in &encodings {
        ids.push(encoding.get_ids().iter().map(|id| *id as i64).collect());
        mask.push(
            encoding
                .get_attention_mask()
                .iter()
                .map(|value| *value as i64)
                .collect(),
        );
        type_ids.push(
            encoding
                .get_type_ids()
                .iter()
                .map(|value| *value as i64)
                .collect(),
        );
    }
    let token_count = ids.first().map_or(0, Vec::len);
    let input_ids = Array2::from_shape_vec(
        (ids.len(), token_count),
        ids.into_iter().flatten().collect(),
    )
    .map_err(|error| format!("Failed to shape the token ids: {error}"))?;
    let attention_mask = Array2::from_shape_vec(
        (mask.len(), token_count),
        mask.clone().into_iter().flatten().collect(),
    )
    .map_err(|error| format!("Failed to shape the attention mask: {error}"))?;
    let token_type_ids = Array2::from_shape_vec(
        (type_ids.len(), token_count),
        type_ids.into_iter().flatten().collect(),
    )
    .map_err(|error| format!("Failed to shape the token type ids: {error}"))?;

    let input_ids = Tensor::from_array(input_ids)
        .map_err(|error| format!("Failed to build the token id tensor: {error}"))?;
    let attention_mask = Tensor::from_array(attention_mask)
        .map_err(|error| format!("Failed to build the attention mask tensor: {error}"))?;
    let token_type_ids = Tensor::from_array(token_type_ids)
        .map_err(|error| format!("Failed to build the token type tensor: {error}"))?;

    let mut session = runtime.session.lock().expect("embedding session lock");
    let outputs = session
        .run(ort::inputs![
            "input_ids" => input_ids,
            "attention_mask" => attention_mask,
            "token_type_ids" => token_type_ids,
        ])
        .map_err(|error| format!("Built-in embedding inference failed: {error}"))?;
    let hidden = outputs["last_hidden_state"]
        .try_extract_array::<f32>()
        .map_err(|error| format!("Failed to read the built-in model output: {error}"))?;
    let shape = hidden.shape().to_vec();
    if shape.len() != 3 {
        return Err(format!(
            "Unexpected built-in output rank {} (expected [batch, tokens, hidden])",
            shape.len()
        ));
    }
    let (batch, tokens, size) = (shape[0], shape[1], shape[2]);
    if batch != texts.len() {
        return Err(format!(
            "Built-in model returned {batch} rows for {} inputs",
            texts.len()
        ));
    }
    if size as u32 != MODEL_DIMENSIONS {
        return Err(format!(
            "Built-in model produced {size}-dimensional vectors, expected {MODEL_DIMENSIONS}"
        ));
    }
    let flat = hidden
        .as_slice()
        .ok_or_else(|| "Built-in output is not contiguous".to_string())?;

    let mut vectors = Vec::with_capacity(batch);
    for (row, attended_tokens) in mask.iter().enumerate().take(batch) {
        let mut pooled = vec![0f32; size];
        let mut counted = 0f32;
        for (token, attended) in attended_tokens.iter().enumerate().take(tokens) {
            if *attended == 0 {
                continue;
            }
            counted += 1.0;
            let offset = (row * tokens + token) * size;
            for (index, value) in pooled.iter_mut().enumerate() {
                *value += flat[offset + index];
            }
        }
        if counted > 0.0 {
            for value in &mut pooled {
                *value /= counted;
            }
        }
        let norm = pooled.iter().map(|value| value * value).sum::<f32>().sqrt();
        if norm > f32::EPSILON {
            for value in &mut pooled {
                *value /= norm;
            }
        }
        vectors.push(pooled);
    }
    Ok(vectors)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes_follow_the_model_card() {
        assert_eq!(
            with_prefix(InputRole::Query, " 语义检索 "),
            "query: 语义检索"
        );
        assert_eq!(
            with_prefix(InputRole::Passage, "vector search"),
            "passage: vector search"
        );
    }

    #[test]
    fn identity_covers_model_revision_dtype_dimensions_metric() {
        let identity = model_identity();
        assert!(identity.contains(MODEL_REPO));
        assert!(identity.contains(MODEL_REVISION));
        assert!(identity.contains(MODEL_DTYPE));
        assert!(identity.contains(&MODEL_DIMENSIONS.to_string()));
        assert!(identity.contains(MODEL_METRIC));
        assert_eq!(MODEL_DIMENSIONS, 384);
    }

    #[test]
    fn status_reports_missing_cache_before_download() {
        let state = EmbeddingState::new(Path::new("/nonexistent-nexnote-embedding-test"));
        let status = state.status();
        assert_eq!(status["downloaded"], Value::Bool(false));
        assert_eq!(status["loaded"], Value::Bool(false));
        assert_eq!(status["files"].as_array().map(Vec::len), Some(3));
        assert_eq!(status["identity"], Value::from(model_identity()));
        assert_eq!(status["dimensions"], json!(384));
    }

    #[test]
    fn runtime_refuses_to_load_without_verified_files() {
        let state = EmbeddingState::new(Path::new("/nonexistent-nexnote-embedding-test-2"));
        // `LoadedModel` holds non-Debug runtime handles, so unwrap the error by hand.
        let error = match state.runtime() {
            Ok(_) => panic!("a missing cache must not load"),
            Err(error) => error,
        };
        assert!(error.contains("not available"), "unexpected error: {error}");
    }

    #[test]
    fn single_flight_download_guard() {
        let state = EmbeddingState::new(Path::new("/tmp/nexnote-embedding-guard"));
        state.begin_download().expect("first download starts");
        assert!(state.is_downloading());
        assert!(state.begin_download().is_err());
        state.end_download();
        assert!(!state.is_downloading());
    }

    #[test]
    fn verify_file_rejects_length_mismatch() {
        let dir = std::env::temp_dir().join(format!(
            "nexnote-embedding-verify-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or_default()
        ));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("model_int8.onnx");
        fs::write(&path, b"too short").expect("write stub");
        let error = verify_file(&path, MODEL_FILE).expect_err("short file must fail");
        assert!(error.contains("expected"), "unexpected error: {error}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_removes_cache_and_unloads() {
        let dir = std::env::temp_dir().join(format!(
            "nexnote-embedding-delete-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or_default()
        ));
        let state = EmbeddingState::new(&dir);
        fs::create_dir_all(state.model_dir()).expect("create model dir");
        fs::write(state.model_dir().join("stale.bin"), b"stale").expect("write stale file");
        state.delete().expect("delete cache");
        assert!(!state.model_dir().exists());
        assert_eq!(state.status()["downloaded"], Value::Bool(false));
    }
}
