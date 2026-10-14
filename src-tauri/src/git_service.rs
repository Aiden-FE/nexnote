//! DEV-120 core Git gateway.
//!
//! This module intentionally shells out to the Git executable rather than
//! linking `git2`.  The first slice covers the operations that the renderer
//! needs before sync/doctor are migrated: status, commits, timeline and vault
//! initialization.  IPC handlers and the dugite runtime resolver can be added
//! on top without changing these parsing functions.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fmt,
    path::Path,
    process::{Command, Output},
};

const AUTO_PREFIX: &str = "nexnote:auto:";
const MANUAL_PREFIX: &str = "nexnote:manual:";
const RESTORE_PREFIX: &str = "nexnote:restore:";
const INITIAL_MESSAGE: &str = "nexnote:init: 知识库初始化";
const USER_NAME_ARG: &str = "user.name=NexNote";
const USER_EMAIL_ARG: &str = "user.email=nexnote@localhost";
const TIMELINE_FIELD_SEPARATOR: char = '\u{1f}';
const TIMELINE_RECORD_SEPARATOR: char = '\u{1e}';
const MAX_TIMELINE_LIMIT: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub repository: bool,
    pub branch: Option<String>,
    pub changed: i64,
    pub ahead: i64,
    pub behind: i64,
    pub remote: Option<String>,
    pub conflict: bool,
    pub rebase_in_progress: bool,
    pub using_system_git: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub author_email: String,
    pub date: String,
    pub message: String,
    pub kind: GitCommitKind,
    pub is_head: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitCommitKind {
    Initial,
    Auto,
    Manual,
    Restore,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct GitRemote {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct GitRestorePreview {
    pub path: String,
    pub commit: String,
    pub current: Option<String>,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitError {
    pub code: String,
    pub message: String,
}

impl GitError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
        }
    }
}

impl fmt::Display for GitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} ({})", self.message, self.code)
    }
}

impl std::error::Error for GitError {}

/// The first runtime slice always uses the Git binary found through `PATH`.
/// Bundled dugite lookup belongs to the next runtime slice so that this module
/// can be tested independently of application packaging.
pub fn resolve_git_binary() -> String {
    "git".to_owned()
}

/// Values that would redirect Git outside the selected vault or inject an
/// unintended identity.  Normal user configuration remains available because
/// remote authentication (for example credential helpers) depends on it.
const CLEANED_GIT_ENV_VARS: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "GIT_CONFIG_COUNT",
];

fn prepare_git_command(root: &Path, env_overrides: &[(&str, Option<&str>)]) -> Command {
    let mut command = Command::new(resolve_git_binary());
    command.current_dir(root);
    command.env_remove("GIT_ASKPASS");
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.env("GIT_CONFIG_NOSYSTEM", "1");

    for variable in CLEANED_GIT_ENV_VARS {
        command.env_remove(variable);
    }
    for (variable, value) in env_overrides {
        match value {
            Some(value) => {
                command.env(variable, value);
            }
            None => {
                command.env_remove(variable);
            }
        }
    }
    command
}

/// Core process runner. stdout and stderr are always captured so parsing and
/// error reporting never attach Git to a desktop console.
pub fn run_git(root: &Path, args: &[&str]) -> Result<String, GitError> {
    run_git_env(root, args, &[])
}

pub fn run_git_env(
    root: &Path,
    args: &[&str],
    env_overrides: &[(&str, Option<&str>)],
) -> Result<String, GitError> {
    let mut command = prepare_git_command(root, env_overrides);
    command.args(args);

    let Output {
        status,
        stdout,
        stderr,
    } = command.output().map_err(|error| {
        GitError::new(
            "GIT_SPAWN_FAILED",
            format!("failed to execute git {}: {error}", args.join(" ")),
        )
    })?;

    let stdout = String::from_utf8_lossy(&stdout).into_owned();
    let stderr = String::from_utf8_lossy(&stderr).into_owned();
    if !status.success() {
        let message = if stderr.trim().is_empty() {
            stdout.trim().to_owned()
        } else {
            stderr.trim().to_owned()
        };
        let code = if status.code() == Some(128)
            && (message.contains("not a git repository") || message.contains("not found in git"))
        {
            "NOT_A_REPOSITORY"
        } else {
            "GIT_COMMAND_FAILED"
        };
        return Err(GitError::new(code, message));
    }
    Ok(stdout)
}

fn is_repository(root: &Path) -> bool {
    matches!(
        run_git(root, &["rev-parse", "--is-inside-work-tree"]),
        Ok(value) if value.trim() == "true"
    )
}

fn has_head(root: &Path) -> bool {
    run_git(root, &["rev-parse", "--verify", "HEAD"])
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn git_dir(root: &Path) -> Result<String, GitError> {
    run_git(root, &["rev-parse", "--absolute-git-dir"])
        .map(|value| value.trim().to_owned())
        .map_err(|error| GitError::new("GIT_DIR_FAILED", error.message))
}

fn is_rebase_or_merge_in_progress(root: &Path) -> bool {
    let Ok(git_dir) = git_dir(root) else {
        return false;
    };
    let git_dir = Path::new(&git_dir);
    ["rebase-merge", "rebase-apply", "MERGE_HEAD"]
        .iter()
        .any(|marker| git_dir.join(marker).exists())
}

fn parse_count(value: &str) -> Option<i64> {
    value.trim().parse().ok()
}

fn parse_branch_header(header: &str) -> (Option<String>, i64, i64) {
    let header = header.strip_prefix("## ").unwrap_or(header);
    if header.starts_with("No commits yet on ") || header.starts_with("No commits yet on branch ") {
        let branch = header
            .strip_prefix("No commits yet on branch ")
            .or_else(|| header.strip_prefix("No commits yet on "))
            .map(str::to_owned);
        return (branch, 0, 0);
    }

    let (branch_part, tracking_part) = match header.split_once(" [") {
        Some((branch, tracking)) => (branch, Some(tracking)),
        None => (header, None),
    };
    let branch = branch_part
        .split_once("...")
        .map_or_else(|| branch_part.to_owned(), |(local, _)| local.to_owned());
    let mut ahead = 0;
    let mut behind = 0;
    if let Some(tracking) = tracking_part {
        for item in tracking.trim_end_matches(']').split(", ") {
            if let Some(count) = item.strip_prefix("ahead ") {
                ahead = parse_count(count).unwrap_or(0);
            } else if let Some(count) = item.strip_prefix("behind ") {
                behind = parse_count(count).unwrap_or(0);
            }
        }
    }
    (Some(branch), ahead, behind)
}

fn is_conflict_code(line: &str) -> bool {
    matches!(
        line.get(..2),
        Some("UU") | Some("AA") | Some("DD") | Some("AU") | Some("UA") | Some("DU") | Some("UD")
    ) || line.as_bytes().first() == Some(&b'U')
}

fn configured_remote_for_branch(root: &Path, branch: &str) -> Option<String> {
    run_git(
        root,
        &["config", "--get", &format!("branch.{branch}.remote")],
    )
    .ok()
    .map(|value| value.trim().to_owned())
    .filter(|value| !value.is_empty())
    .or_else(|| {
        let remote_list = run_git(root, &["remote"]).unwrap_or_default();
        let remotes: Vec<&str> = remote_list
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect();
        remotes
            .iter()
            .find(|name| **name == "origin")
            .or_else(|| remotes.first())
            .map(|name| (*name).to_owned())
    })
}

fn status_with_porcelain(root: &Path, porcelain: &str) -> GitStatus {
    let mut lines = porcelain.lines().peekable();
    let header = lines.peek().filter(|line| line.starts_with("## ")).copied();
    if header.is_some() {
        lines.next();
    }
    let (branch, ahead, behind) = header.map_or((None, 0, 0), parse_branch_header);
    let entries: Vec<&str> = lines.filter(|line| !line.is_empty()).collect();
    let conflict = entries.iter().any(|line| is_conflict_code(line));
    let remote = branch
        .as_deref()
        .and_then(|branch| configured_remote_for_branch(root, branch));

    GitStatus {
        repository: true,
        branch,
        changed: entries.len() as i64,
        ahead,
        behind,
        remote,
        conflict,
        rebase_in_progress: is_rebase_or_merge_in_progress(root),
        using_system_git: true,
    }
}

fn empty_status() -> GitStatus {
    GitStatus {
        repository: false,
        branch: None,
        changed: 0,
        ahead: 0,
        behind: 0,
        remote: None,
        conflict: false,
        rebase_in_progress: false,
        using_system_git: true,
    }
}

/// `git status --porcelain -b --ahead-behind` is stable across Git versions and
/// provides all fields needed by the shared GitStatus contract in one call.
pub fn status(root: &Path) -> Result<Value, GitError> {
    if !root.exists() || !is_repository(root) {
        return serde_json::to_value(empty_status())
            .map_err(|error| GitError::new("SERIALIZATION_FAILED", error.to_string()));
    }
    let porcelain = run_git(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "status",
            "--porcelain",
            "-b",
            "--ahead-behind",
        ],
    )?;
    let status = status_with_porcelain(root, &porcelain);
    serde_json::to_value(status)
        .map_err(|error| GitError::new("SERIALIZATION_FAILED", error.to_string()))
}

fn prepare_commit(root: &Path, message: &str, allow_empty: bool) -> Result<(), GitError> {
    if !is_repository(root) {
        return Err(GitError::new(
            "NOT_A_REPOSITORY",
            "vault is not a Git repository",
        ));
    }
    if is_rebase_or_merge_in_progress(root) {
        return Err(GitError::new(
            "REBASE_IN_PROGRESS",
            "a rebase or merge is in progress",
        ));
    }
    if message.trim().is_empty() {
        return Err(GitError::new("EMPTY_MESSAGE", "commit message is empty"));
    }
    run_git(root, &["add", "--all"])?;
    if allow_empty {
        run_git(
            root,
            &[
                "-c",
                USER_NAME_ARG,
                "-c",
                USER_EMAIL_ARG,
                "commit",
                "--allow-empty",
                "-m",
                message,
            ],
        )?;
    } else {
        run_git(
            root,
            &[
                "-c",
                USER_NAME_ARG,
                "-c",
                USER_EMAIL_ARG,
                "commit",
                "-m",
                message,
            ],
        )?;
    }
    Ok(())
}

fn operation_result(
    root: &Path,
    message: &str,
    commit_hash: Option<&str>,
) -> Result<Value, GitError> {
    let status = status(root)?;
    Ok(json!({
        "message": message,
        "hash": commit_hash,
        "status": status,
    }))
}

pub fn commit(root: &Path, message: &str) -> Result<Value, GitError> {
    prepare_commit(root, message, false)?;
    let hash = run_git(root, &["rev-parse", "HEAD"])?;
    operation_result(root, "commit created", Some(hash.trim()))
}

pub fn record_auto_commit(root: &Path, summary: &str, debounce_ms: u64) -> Result<Value, GitError> {
    // The stateful editor debounce lives in the product layer.  The gateway
    // accepts the configured value so handlers can forward it today and move
    // the interval accounting into this core without changing call sites.
    let _ = debounce_ms;
    let current = status(root)?;
    if current
        .get("changed")
        .and_then(Value::as_i64)
        .unwrap_or_default()
        == 0
    {
        return operation_result(root, "no changes to commit", None);
    }
    let message = format!("{AUTO_PREFIX} {}", summary.trim());
    prepare_commit(root, &message, false)?;
    let hash = run_git(root, &["rev-parse", "HEAD"])?;
    operation_result(root, "auto commit created", Some(hash.trim()))
}

fn commit_kind(message: &str) -> GitCommitKind {
    if message.starts_with(INITIAL_MESSAGE) {
        GitCommitKind::Initial
    } else if message.starts_with(AUTO_PREFIX) {
        GitCommitKind::Auto
    } else if message.starts_with(MANUAL_PREFIX) {
        GitCommitKind::Manual
    } else if message.starts_with(RESTORE_PREFIX) {
        GitCommitKind::Restore
    } else {
        GitCommitKind::Other
    }
}

fn parse_timeline(root: &Path, raw: &str) -> Result<Value, GitError> {
    let head = if has_head(root) {
        run_git(root, &["rev-parse", "HEAD"])?.trim().to_owned()
    } else {
        String::new()
    };
    let commits: Vec<Value> = raw
        .split(TIMELINE_RECORD_SEPARATOR)
        .filter_map(|record| {
            let record = record.trim_start_matches('\n').trim_end();
            if record.is_empty() {
                return None;
            }
            let mut fields = record.split(TIMELINE_FIELD_SEPARATOR);
            let hash = fields.next()?.trim().to_owned();
            let short_hash = fields.next()?.trim().to_owned();
            let author = fields.next()?.trim().to_owned();
            let author_email = fields.next()?.trim().to_owned();
            let date = fields.next()?.trim().to_owned();
            let message = fields.next().unwrap_or_default().to_owned();
            let kind = commit_kind(&message);
            serde_json::to_value(GitCommit {
                is_head: !head.is_empty() && hash == head,
                hash,
                short_hash,
                author,
                author_email,
                date,
                kind,
                message,
            })
            .ok()
        })
        .collect();

    serde_json::to_value(commits)
        .map_err(|error| GitError::new("SERIALIZATION_FAILED", error.to_string()))
}

pub fn get_timeline(root: &Path, path: Option<String>, limit: usize) -> Result<Value, GitError> {
    if !is_repository(root) || !has_head(root) {
        return Ok(json!([]));
    }
    let limit = limit.clamp(1, MAX_TIMELINE_LIMIT);
    let limit_text = limit.to_string();
    let max_count = format!("--max-count={limit_text}");
    let format = format!(
        "--format=%H{TIMELINE_FIELD_SEPARATOR}%h{TIMELINE_FIELD_SEPARATOR}%an\
         {TIMELINE_FIELD_SEPARATOR}%ae{TIMELINE_FIELD_SEPARATOR}%aI\
         {TIMELINE_FIELD_SEPARATOR}%B{TIMELINE_RECORD_SEPARATOR}"
    );
    let mut args = vec!["log", max_count.as_str(), format.as_str()];
    if let Some(path) = path.as_deref() {
        args.push("--");
        args.push(path);
    }
    let raw = run_git(root, &args)?;
    parse_timeline(root, &raw)
}

pub fn init(root: &Path) -> Result<Value, GitError> {
    std::fs::create_dir_all(root)
        .map_err(|error| GitError::new("VAULT_CREATE_FAILED", error.to_string()))?;
    run_git(root, &["init", "-b", "main"])?;
    let mut created_initial_commit = false;
    if !has_head(root) {
        prepare_commit(root, INITIAL_MESSAGE, true)?;
        created_initial_commit = true;
    }
    operation_result(
        root,
        if created_initial_commit {
            "repository initialized"
        } else {
            "existing repository initialized"
        },
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_root(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nexnote-git-{label}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_file(root: &Path, name: &str, content: &str) {
        let path = root.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn read_status(root: &Path) -> GitStatus {
        serde_json::from_value(status(root).unwrap()).unwrap()
    }

    #[test]
    fn initializes_repo_and_reports_status() {
        let root = unique_temp_root("init");
        write_file(&root, "note.md", "# init\n");
        let result = init(&root).unwrap();
        assert_eq!(result["message"], "repository initialized");

        let value = status(&root).unwrap();
        assert_eq!(value["repository"], true);
        assert_eq!(value["branch"], "main");
        assert_eq!(value["conflict"], false);
        assert_eq!(value["rebaseInProgress"], json!(false));

        let timeline = get_timeline(&root, None, 10).unwrap();
        assert_eq!(timeline[0]["kind"], "initial");
        assert_eq!(timeline[0]["isHead"], true);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn commits_file_and_parses_timeline() {
        let root = unique_temp_root("commit");
        init(&root).unwrap();
        write_file(&root, "notes/index.md", "content\n");

        let result = record_auto_commit(&root, "保存笔记", 500).unwrap();
        assert_eq!(result["message"], "auto commit created");
        let current = read_status(&root);
        assert_eq!(current.changed, 0);
        assert_eq!(current.branch.as_deref(), Some("main"));

        let timeline_value = get_timeline(&root, None, 20).unwrap();
        assert_eq!(timeline_value[0]["kind"], "auto");
        assert_eq!(timeline_value[0]["message"], "nexnote:auto: 保存笔记");

        write_file(&root, "notes/manual.md", "manual\n");
        let manual = commit(&root, "manual update").unwrap();
        assert!(manual["hash"].is_string());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn detects_merge_conflict_and_paused_merge() {
        let root = unique_temp_root("conflict");
        init(&root).unwrap();
        write_file(&root, "conflict.md", "base\n");
        record_auto_commit(&root, "base", 500).unwrap();

        run_git(&root, &["checkout", "-b", "other"]).unwrap();
        write_file(&root, "conflict.md", "theirs\n");
        record_auto_commit(&root, "other side", 500).unwrap();
        run_git(&root, &["checkout", "-"]).unwrap();
        write_file(&root, "conflict.md", "ours\n");
        record_auto_commit(&root, "our side", 500).unwrap();

        assert!(run_git(&root, &["merge", "other"]).is_err());
        let value = status(&root).unwrap();
        assert_eq!(value["conflict"], true);
        assert_eq!(value["rebaseInProgress"], json!(true));
        assert!(value["changed"].as_i64().unwrap_or_default() > 0);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn status_outside_repository_uses_shared_empty_contract() {
        let root = unique_temp_root("plain");
        let value = status(&root).unwrap();
        assert_eq!(value["repository"], false);
        assert_eq!(value["usingSystemGit"], json!(true));
        assert!(get_timeline(&root, None, 10)
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
