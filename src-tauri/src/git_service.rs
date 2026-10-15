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
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::OnceLock,
    time::{Duration, Instant},
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
const GIT_PROCESS_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug)]
pub enum GitProcessError {
    Spawn(std::io::Error),
    Timeout,
    Aborted,
}

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

#[derive(Clone)]
struct BundledGitRuntime {
    binary: PathBuf,
    exec_path: PathBuf,
    config_system: PathBuf,
    template_dir: PathBuf,
}

static BUNDLED_GIT: OnceLock<BundledGitRuntime> = OnceLock::new();

pub fn install_bundled_git(resource_root: &Path) -> bool {
    let payload = resource_root.join("git");
    let binary = if cfg!(windows) {
        payload.join("cmd/git.exe")
    } else {
        payload.join("bin/git")
    };
    if !binary.is_file() {
        return false;
    }
    let runtime = BundledGitRuntime {
        binary: binary.clone(),
        exec_path: payload.join("libexec/git-core"),
        config_system: payload.join("etc/gitconfig"),
        template_dir: payload.join("share/git-core/templates"),
    };
    BUNDLED_GIT.set(runtime).is_ok()
        || BUNDLED_GIT
            .get()
            .is_some_and(|current| current.binary == binary)
}

pub fn configure_git_command(command: &mut Command) {
    let Some(runtime) = BUNDLED_GIT.get() else {
        return;
    };
    command
        .env("GIT_EXEC_PATH", &runtime.exec_path)
        .env("GIT_CONFIG_SYSTEM", &runtime.config_system)
        .env("GIT_TEMPLATE_DIR", &runtime.template_dir);
}

pub fn resolve_git_binary() -> String {
    BUNDLED_GIT
        .get()
        .map(|runtime| runtime.binary.display().to_string())
        .unwrap_or_else(|| "git".to_owned())
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
    configure_git_command(&mut command);
    if BUNDLED_GIT.get().is_none() {
        command.env("GIT_CONFIG_NOSYSTEM", "1");
    }

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

pub fn run_command_with_timeout(
    command: &mut Command,
    timeout: Duration,
) -> Result<Output, GitProcessError> {
    run_command_with_cancel(command, timeout, None)
}

pub fn run_command_with_cancel(
    command: &mut Command,
    timeout: Duration,
    cancelled: Option<&std::sync::atomic::AtomicBool>,
) -> Result<Output, GitProcessError> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(GitProcessError::Spawn)?;
    let deadline = Instant::now() + timeout;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            if let Some(mut pipe) = child.stdout.take() {
                std::io::Read::read_to_end(&mut pipe, &mut stdout)
                    .map_err(GitProcessError::Spawn)?;
            }
            if let Some(mut pipe) = child.stderr.take() {
                std::io::Read::read_to_end(&mut pipe, &mut stderr)
                    .map_err(GitProcessError::Spawn)?;
            }
            return Ok(Output {
                status,
                stdout,
                stderr,
            });
        }
        let timed_out = Instant::now() >= deadline;
        let aborted = cancelled.is_some_and(|flag| flag.load(std::sync::atomic::Ordering::SeqCst));
        if timed_out || aborted {
            kill_process_tree(child.id());
            let _ = child.wait();
            return Err(if aborted {
                GitProcessError::Aborted
            } else {
                GitProcessError::Timeout
            });
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn kill_process_tree(process_id: u32) {
    let result = if cfg!(windows) {
        Command::new("taskkill")
            .args(["/PID", &process_id.to_string(), "/T", "/F"])
            .status()
    } else {
        Command::new("kill")
            .args(["-9", &format!("-{process_id}")])
            .status()
    };
    let _ = result;
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
    } = run_command_with_timeout(&mut command, GIT_PROCESS_TIMEOUT).map_err(
        |error| match error {
            GitProcessError::Spawn(error) => GitError::new(
                "GIT_SPAWN_FAILED",
                format!("failed to execute git {}: {error}", args.join(" ")),
            ),
            GitProcessError::Timeout => {
                GitError::new("GIT_TIMEOUT", format!("git {} timed out", args.join(" ")))
            }
            GitProcessError::Aborted => GitError::new(
                "GIT_ABORTED",
                format!("git {} was cancelled", args.join(" ")),
            ),
        },
    )?;

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

fn validate_path(path: &str) -> Result<&str, GitError> {
    if path.trim().is_empty() {
        return Err(GitError::new("INVALID_PATH", "file path is empty"));
    }
    let path = Path::new(path);
    if !path.is_relative() {
        return Err(GitError::new("INVALID_PATH", "file path must be relative"));
    }
    let only_normal_components = path
        .components()
        .all(|component| matches!(component, std::path::Component::Normal(_)));
    if !only_normal_components {
        return Err(GitError::new(
            "INVALID_PATH",
            "file path must stay inside the vault",
        ));
    }
    path.to_str()
        .ok_or_else(|| GitError::new("INVALID_PATH", "file path is not valid Unicode"))
}

pub fn preview_restore(root: &Path, path: &str, commit: &str) -> Result<Value, GitError> {
    let path = validate_path(path)?;
    if commit.trim().is_empty() {
        return Err(GitError::new("INVALID_COMMIT", "commit is empty"));
    }
    if !is_repository(root) || !has_head(root) {
        return Err(GitError::new(
            "NOT_A_REPOSITORY",
            "vault is not a Git repository with HEAD",
        ));
    }

    let object = format!("{commit}:{path}");
    let target = run_git(root, &["show", &object])?;
    let current = std::fs::read_to_string(root.join(path)).ok();
    let preview = GitRestorePreview {
        path: path.to_owned(),
        commit: commit.to_owned(),
        current,
        target,
    };
    serde_json::to_value(preview)
        .map_err(|error| GitError::new("SERIALIZATION_FAILED", error.to_string()))
}

pub fn restore_file(root: &Path, path: &str, commit: &str) -> Result<Value, GitError> {
    let path = validate_path(path)?;
    if commit.trim().is_empty() {
        return Err(GitError::new("INVALID_COMMIT", "commit is empty"));
    }
    if !is_repository(root) || !has_head(root) {
        return Err(GitError::new(
            "NOT_A_REPOSITORY",
            "vault is not a Git repository with HEAD",
        ));
    }
    run_git(root, &["checkout", commit, "--", path])?;
    operation_result(root, "file restored", None)
}

pub fn set_use_system_git(_root: &Path, enabled: bool) -> Result<Value, GitError> {
    // The first Tauri runtime slice always uses the system Git binary.  The
    // argument is accepted now so packaging a bundled runtime later does not
    // require an IPC contract change.
    let _ = enabled;
    Ok(json!({ "message": "ok", "usingSystemGit": true }))
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
    fn bundled_git_runtime_resolves_and_executes() {
        let resource = std::env::current_dir()
            .ok()
            .map(|cwd| cwd.join("resources/git"))
            .filter(|path| path.join("git/bin/git").is_file());
        let Some(resource) = resource else {
            return;
        };
        assert!(install_bundled_git(&resource), "valid payload must install");
        let mut command = Command::new(resolve_git_binary());
        configure_git_command(&mut command);
        let output = command
            .arg("--version")
            .output()
            .expect("execute bundled git");
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).starts_with("git version"));
    }

    #[test]
    fn process_runner_times_out_and_aborts_without_leaking_the_child() {
        let started = std::time::Instant::now();
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 5"]);
        let result = run_command_with_timeout(&mut command, Duration::from_millis(20));
        assert!(matches!(result, Err(GitProcessError::Timeout)));
        assert!(started.elapsed() < Duration::from_secs(2));

        let cancelled = std::sync::atomic::AtomicBool::new(true);
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 5"]);
        let result =
            run_command_with_cancel(&mut command, Duration::from_secs(5), Some(&cancelled));
        assert!(matches!(result, Err(GitProcessError::Aborted)));
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
    fn previews_and_restores_file_contents() {
        let root = unique_temp_root("restore");
        init(&root).unwrap();
        write_file(&root, "doc.md", "original\n");
        record_auto_commit(&root, "original", 500).unwrap();
        let original_hash = run_git(&root, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_owned();

        write_file(&root, "doc.md", "changed\n");
        record_auto_commit(&root, "changed", 500).unwrap();
        let preview = preview_restore(&root, "doc.md", &original_hash).unwrap();
        assert_eq!(preview["path"], "doc.md");
        assert_eq!(preview["target"], "original\n");
        assert_eq!(preview["current"], "changed\n");

        let restored = restore_file(&root, "doc.md", &original_hash).unwrap();
        assert_eq!(restored["message"], "file restored");
        assert_eq!(restored["status"]["changed"], json!(1));
        assert_eq!(
            fs::read_to_string(root.join("doc.md")).unwrap(),
            "original\n"
        );
        assert!(preview_restore(&root, "../escape.md", &original_hash).is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preview_marks_missing_file_current_null() {
        let root = unique_temp_root("restore-new");
        init(&root).unwrap();
        write_file(&root, "new.md", "old\n");
        record_auto_commit(&root, "old", 500).unwrap();
        let hash = run_git(&root, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_owned();
        fs::remove_file(root.join("new.md")).unwrap();
        record_auto_commit(&root, "deleted", 500).unwrap();

        let preview = preview_restore(&root, "new.md", &hash).unwrap();
        assert_eq!(preview["current"], Value::Null);
        assert_eq!(preview["target"], "old\n");

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
