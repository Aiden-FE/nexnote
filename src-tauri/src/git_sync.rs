#![allow(dead_code)]

use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const TICKET_TTL: Duration = Duration::from_secs(5 * 60);
const DEFAULT_DEBOUNCE_MS: u64 = 30_000;
const MIN_DEBOUNCE_MS: u64 = 500;
const MAX_DEBOUNCE_MS: u64 = 10 * 60_000;
const REPAIR_ACTIONS: [&str; 7] = [
    "commit",
    "pull",
    "push",
    "abort-rebase-or-merge",
    "resolve-conflict-and-continue",
    "preserve-local-and-abort",
    "force-abort-rebase-or-merge",
];

#[derive(Debug, Clone, Serialize)]
pub struct GitRemote {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Debug)]
struct GitRun {
    stdout: String,
    stderr: String,
}

#[derive(Debug)]
struct StatusInfo {
    branch: Option<String>,
    changed: u64,
    ahead: u64,
    behind: u64,
    remote: Option<String>,
    upstream: Option<String>,
    porcelain_conflict: bool,
}

#[derive(Debug)]
struct RepairTicket {
    root: PathBuf,
    action: String,
    head_oid: Option<String>,
    remote_oid: Option<String>,
    porcelain: String,
    conflict_files: Vec<String>,
    expires_at: SystemTime,
}

static TICKETS: Mutex<Option<HashMap<String, RepairTicket>>> = Mutex::new(None);
static TICKET_COUNTER: AtomicU64 = AtomicU64::new(0);

fn ok(data: Value) -> Value {
    json!({ "ok": true, "data": data })
}

fn error(code: &str, message: &str) -> Value {
    json!({ "ok": false, "error": message, "code": code })
}

fn is_result(value: &Value) -> bool {
    value.get("ok").and_then(Value::as_bool).unwrap_or(false)
}

/// Strip host-injected interactive/external Git tooling, matching the Electron
/// runtime's safety rules without carrying over proxy credentials.
fn sanitize_env(command: &mut Command) {
    for variable in [
        "GIT_EDITOR",
        "GIT_SEQUENCE_EDITOR",
        "EDITOR",
        "GIT_PROXY_COMMAND",
        "GIT_EXTERNAL_DIFF",
        "GIT_CONFIG_COUNT",
    ] {
        command.env_remove(variable);
    }
}

fn run_git(root: &Path, args: &[&str]) -> Result<GitRun, Value> {
    run_git_env(root, args, &[])
}

fn run_git_env(root: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<GitRun, Value> {
    let mut command = Command::new("git");
    command
        .current_dir(root)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    sanitize_env(&mut command);
    for (key, value) in envs {
        command.env(key, value);
    }
    let output = match command.output() {
        Ok(value) => value,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(error("GIT_BINARY_MISSING", "git binary not found"))
        }
        Err(err) => return Err(error("GIT_SPAWN_FAILED", &sanitize_text(&err.to_string()))),
    };
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !output.status.success() {
        return Err(git_error(args, &stdout, &stderr));
    }
    Ok(GitRun { stdout, stderr })
}

fn git_ok(root: &Path, args: &[&str]) -> Option<GitRun> {
    run_git(root, args).ok()
}

fn git_error(args: &[&str], stdout: &str, stderr: &str) -> Value {
    let command = args.first().copied().unwrap_or("git");
    let text = sanitize_text(format!("{}\n{}", stdout.trim(), stderr.trim()).trim());
    let lower = text.to_ascii_lowercase();
    if lower.contains("conflict") || lower.contains("unmerged") {
        error("CONFLICT", &text)
    } else if lower.contains("authentication failed")
        || lower.contains("could not read from remote")
        || lower.contains("permission denied")
        || lower.contains("403")
    {
        error("AUTH_FAILED", &text)
    } else if lower.contains("could not resolve host")
        || lower.contains("connection refused")
        || lower.contains("timed out")
        || lower.contains("network")
        || lower.contains("offline")
    {
        error("NETWORK_ERROR", &text)
    } else if lower.contains("non-fast-forward")
        || lower.contains("rejected")
        || lower.contains("fetch first")
    {
        error("PUSH_REJECTED", &text)
    } else {
        error(
            "GIT_COMMAND_FAILED",
            &format!("git {command} failed: {text}"),
        )
    }
}

fn valid_remote_name(name: &str) -> bool {
    let mut chars = name.chars();
    if !matches!(chars.next(), Some(first) if first.is_ascii_alphabetic()) {
        return false;
    }
    name.chars()
        .skip(1)
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn require_repository(root: &Path) -> Result<(), Value> {
    let output = run_git(root, &["rev-parse", "--show-toplevel"])?;
    let top = PathBuf::from(output.stdout.trim());
    let actual = fs::canonicalize(&top)
        .map_err(|_| error("NOT_A_REPOSITORY", "Vault root is not a Git repository"))?;
    let expected =
        fs::canonicalize(root).map_err(|_| error("NO_VAULT", "Vault root does not exist"))?;
    if actual != expected {
        return Err(error(
            "NOT_A_REPOSITORY",
            "Vault root is not the top-level Git repository",
        ));
    }
    Ok(())
}

fn git_dir(root: &Path) -> Result<PathBuf, Value> {
    let output = run_git(root, &["rev-parse", "--git-dir"])?;
    let value = PathBuf::from(output.stdout.trim());
    Ok(if value.is_absolute() {
        value
    } else {
        root.join(value)
    })
}

fn status_info(root: &Path) -> Result<StatusInfo, Value> {
    let output = run_git(root, &["status", "--porcelain=v1", "--branch"])?;
    let mut branch = None;
    let mut remote = None;
    let mut upstream = None;
    let mut ahead = 0u64;
    let mut behind = 0u64;
    let mut changed = 0u64;
    let mut porcelain_conflict = false;

    for line in output.stdout.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            let mut sections = header.split("...");
            let local = sections.next().unwrap_or_default();
            if !local.is_empty() && local != "No commits yet on" {
                branch = Some(local.to_owned());
            }
            let tracking = sections.next().unwrap_or_default();
            let tracking = tracking
                .split(" [")
                .next()
                .unwrap_or_default()
                .trim()
                .to_owned();
            if !tracking.is_empty() {
                remote = tracking.split('/').next().map(ToOwned::to_owned);
                upstream = Some(tracking);
            }
            let bracket = header.split(" [").nth(1).unwrap_or_default();
            let bracket = bracket.trim_end_matches(']');
            for part in bracket.split(',') {
                let mut words = part.split_whitespace();
                if let (Some(kind), Some(count)) = (words.next(), words.next()) {
                    let count = count.parse().unwrap_or(0);
                    if kind == "ahead" {
                        ahead = count;
                    } else if kind == "behind" {
                        behind = count;
                    }
                }
            }
        } else if !line.trim().is_empty() {
            changed += 1;
            let bytes = line.as_bytes();
            if bytes.len() >= 2
                && (bytes[0] == b'U'
                    || bytes[1] == b'U'
                    || line.starts_with("AA ")
                    || line.starts_with("DD "))
            {
                porcelain_conflict = true;
            }
        }
    }

    Ok(StatusInfo {
        branch,
        changed,
        ahead,
        behind,
        remote,
        upstream,
        porcelain_conflict,
    })
}

fn porcelain_conflict_files(root: &Path) -> Result<Vec<String>, Value> {
    let output = run_git(root, &["status", "--porcelain=v1", "-z"])?;
    let mut files = Vec::new();
    for item in output.stdout.split('\0') {
        if item.len() < 4 {
            continue;
        }
        let bytes = item.as_bytes();
        if bytes[0] == b'U'
            || bytes[1] == b'U'
            || item.starts_with("AA ")
            || item.starts_with("DD ")
        {
            let path = item[3..].replace('\\', "/");
            if !files.contains(&path) {
                files.push(path);
            }
        }
    }
    Ok(files)
}

fn changed_files(root: &Path) -> Vec<String> {
    let Some(output) = git_ok(root, &["status", "--porcelain=v1"]) else {
        return Vec::new();
    };
    output
        .stdout
        .lines()
        .filter(|line| line.len() >= 4)
        .map(|line| line[3..].replace('\\', "/"))
        .collect()
}

fn conflict_marker_files(root: &Path) -> Vec<String> {
    let mut marked = Vec::new();
    for file in changed_files(root) {
        let Ok(content) = fs::read_to_string(root.join(&file)) else {
            continue;
        };
        if content
            .lines()
            .any(|line| line.starts_with("<<<<<<< ") || line.starts_with(">>>>>>> "))
        {
            marked.push(file);
        }
    }
    marked
}

fn resolve_remote(root: &Path, branch: Option<&str>) -> Option<String> {
    if let Some(branch) = branch {
        if let Some(output) = git_ok(root, &["config", &format!("branch.{branch}.remote")]) {
            let value = output.stdout.trim();
            if !value.is_empty() {
                return Some(value.to_owned());
            }
        }
    }
    if let Some(remote) = git_remotes(root).into_iter().find(|r| r.name == "origin") {
        return Some(remote.name);
    }
    git_remotes(root).into_iter().next().map(|r| r.name)
}

fn upstream_ref(root: &Path, branch: Option<&str>) -> Option<String> {
    let branch = branch?;
    if let Some(output) = git_ok(
        root,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    ) {
        let value = output.stdout.trim();
        if !value.is_empty() {
            return Some(value.to_owned());
        }
    }
    let remote = resolve_remote(root, Some(branch))?;
    Some(format!("{remote}/{branch}"))
}

fn head_oid(root: &Path) -> Option<String> {
    git_ok(root, &["rev-parse", "--verify", "HEAD"])
        .map(|output| output.stdout.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn remote_oid(root: &Path, branch: Option<&str>) -> Option<String> {
    let upstream = upstream_ref(root, branch)?;
    git_ok(
        root,
        &["rev-parse", "--verify", &format!("refs/remotes/{upstream}")],
    )
    .map(|output| output.stdout.trim().to_owned())
    .filter(|value| !value.is_empty())
}

fn git_remotes(root: &Path) -> Vec<GitRemote> {
    let Some(output) = git_ok(root, &["remote", "-v"]) else {
        return Vec::new();
    };
    let mut remotes: Vec<GitRemote> = Vec::new();
    for line in output.stdout.lines() {
        let mut parts = line.split('\t');
        let name = parts.next().unwrap_or_default().trim().to_owned();
        let tail = parts.next().unwrap_or_default().trim();
        if name.is_empty() || tail.is_empty() {
            continue;
        }
        let (url, kind) = match tail.rsplit_once(" (") {
            Some((url, kind)) => (url.trim(), kind.trim_end_matches(')')),
            None => (tail, ""),
        };
        let url = sanitize_text(url);
        if let Some(existing) = remotes.iter_mut().find(|r| r.name == name) {
            if kind == "push" {
                existing.push_url = url;
            } else {
                existing.fetch_url = url;
            }
        } else {
            let (fetch_url, push_url) = if kind == "push" {
                (String::new(), url)
            } else {
                (url.clone(), url)
            };
            remotes.push(GitRemote {
                name,
                fetch_url,
                push_url,
            });
        }
    }
    remotes
}

pub fn add_remote(root: &Path, name: &str, url: &str) -> Value {
    if let Err(err) = require_repository(root) {
        return err;
    }
    if !valid_remote_name(name) {
        return error(
            "INVALID_REMOTE",
            "Remote name must start with a letter and contain only letters, digits, dot, dash, or underscore",
        );
    }
    let url = url.trim();
    if url.is_empty() {
        return error("INVALID_REMOTE", "Remote URL must not be empty");
    }
    if git_remotes(root).iter().any(|remote| remote.name == name) {
        return error("REMOTE_EXISTS", "Remote already exists");
    }
    match run_git(root, &["remote", "add", name, url]) {
        Ok(_) => ok(json!({ "name": name, "url": sanitize_text(url) })),
        Err(err) => err,
    }
}

pub fn list_remotes(root: &Path) -> Vec<GitRemote> {
    git_remotes(root)
}

pub fn remove_remote(root: &Path, name: &str) -> Value {
    if let Err(err) = require_repository(root) {
        return err;
    }
    if !valid_remote_name(name) {
        return error("INVALID_REMOTE", "Invalid remote name");
    }
    match run_git(root, &["remote", "remove", name]) {
        Ok(_) => ok(json!({ "removed": name })),
        Err(err) => err,
    }
}

pub fn pull(root: &Path, force: bool) -> Value {
    if let Err(err) = require_repository(root) {
        return err;
    }
    let status = match status_info(root) {
        Ok(value) => value,
        Err(err) => return err,
    };
    if status.changed > 0 && !force {
        return error(
            "WORKTREE_DIRTY",
            "Refusing to pull a dirty worktree without force",
        );
    }
    let branch = status.branch.clone();
    let Some(remote) = resolve_remote(root, branch.as_deref()) else {
        return error("NO_REMOTE", "No remote is configured for pull");
    };
    let Some(branch) = branch else {
        return error("NO_BRANCH", "HEAD is detached");
    };
    let mut args = vec!["pull".to_owned(), "--rebase".to_owned()];
    if force {
        args.push("--force".to_owned());
    }
    args.push(remote);
    args.push(branch);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    match run_git(root, &arg_refs) {
        Ok(_) => ok(json!({ "message": "pull completed" })),
        Err(err) => err,
    }
}

pub fn push(root: &Path) -> Value {
    if let Err(err) = require_repository(root) {
        return err;
    }
    let status = match status_info(root) {
        Ok(value) => value,
        Err(err) => return err,
    };
    let branch = status.branch.clone();
    let Some(remote) = resolve_remote(root, branch.as_deref()) else {
        return error("NO_REMOTE", "No remote is configured for push");
    };
    let Some(branch) = branch else {
        return error("NO_BRANCH", "HEAD is detached");
    };
    match run_git(root, &["push", "-u", &remote, &branch]) {
        Ok(_) => ok(json!({ "message": "push completed" })),
        Err(err) => err,
    }
}

pub fn fetch(root: &Path) -> Value {
    if let Err(err) = require_repository(root) {
        return err;
    }
    match run_git(root, &["fetch", "--all", "--prune"]) {
        Ok(_) => ok(json!({ "message": "fetch completed" })),
        Err(err) => err,
    }
}

pub fn sync(root: &Path) -> Value {
    if let Err(err) = require_repository(root) {
        return err;
    }
    let fetched = fetch(root);
    if !is_result(&fetched) {
        return fetched;
    }
    let status = match status_info(root) {
        Ok(value) => value,
        Err(err) => return err,
    };
    let branch = status.branch.clone();
    let Some(remote) = resolve_remote(root, branch.as_deref()) else {
        return error("NO_REMOTE", "No remote is configured for sync");
    };
    let Some(branch) = branch else {
        return error("NO_BRANCH", "HEAD is detached");
    };
    if status.behind > 0 {
        let upstream = format!("{remote}/{branch}");
        if let Err(err) = run_git(root, &["rebase", &upstream]) {
            return err;
        }
    }
    let status = match status_info(root) {
        Ok(value) => value,
        Err(err) => return err,
    };
    if status.ahead > 0 {
        let pushed = push(root);
        if !is_result(&pushed) {
            return pushed;
        }
    }
    ok(json!({ "message": "sync completed" }))
}

fn diagnose_data(root: &Path) -> Result<Value, Value> {
    let status = status_info(root)?;
    let git_dir = git_dir(root)?;
    let rebase_in_progress =
        git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists();
    let merge_in_progress = git_dir.join("MERGE_HEAD").exists();
    let mut conflict_files = porcelain_conflict_files(root)?;
    for file in conflict_marker_files(root) {
        if !conflict_files.contains(&file) {
            conflict_files.push(file);
        }
    }
    let conflict = status.porcelain_conflict || !conflict_files.is_empty();
    Ok(json!({
        "repository": true,
        "branch": status.branch,
        "changed": status.changed,
        "ahead": status.ahead,
        "behind": status.behind,
        "remote": status.remote,
        "conflict": conflict,
        "rebaseInProgress": rebase_in_progress,
        "mergeInProgress": merge_in_progress,
        "conflictFiles": conflict_files,
    }))
}

pub fn diagnose(root: &Path) -> Value {
    if let Err(err) = require_repository(root) {
        return err;
    }
    match diagnose_data(root) {
        Ok(data) => ok(data),
        Err(err) => err,
    }
}

type FingerprintParts = (Option<String>, Option<String>, String, Vec<String>);

fn fingerprint(root: &Path) -> Result<FingerprintParts, Value> {
    let diagnosis = diagnose_data(root)?;
    let branch = diagnosis
        .get("branch")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let porcelain = git_ok(root, &["status", "--porcelain=v1"])
        .map(|output| output.stdout)
        .unwrap_or_default();
    let conflict_files = diagnosis
        .get("conflictFiles")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();
    Ok((
        head_oid(root),
        remote_oid(root, branch.as_deref()),
        porcelain,
        conflict_files,
    ))
}

fn same_fingerprint(
    left: &(Option<String>, Option<String>, String, Vec<String>),
    right: &(Option<String>, Option<String>, String, Vec<String>),
) -> bool {
    left.0 == right.0 && left.1 == right.1 && left.2 == right.2 && left.3 == right.3
}

pub fn repair_prepare(root: &Path, action: &str) -> Value {
    if let Err(err) = require_repository(root) {
        return err;
    }
    if !REPAIR_ACTIONS.contains(&action) {
        return error("INVALID_ACTION", "Unknown repair action");
    }
    let diagnosis = match diagnose_data(root) {
        Ok(value) => value,
        Err(err) => return err,
    };
    let conflict = diagnosis
        .get("conflict")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let rebase_in_progress = diagnosis
        .get("rebaseInProgress")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if conflict && !rebase_in_progress {
        return error(
            "CONFLICT_PRESENT",
            "Resolve conflicts before preparing a repair",
        );
    }
    let fingerprint = match fingerprint(root) {
        Ok(value) => value,
        Err(err) => return err,
    };
    let expires_at = SystemTime::now() + TICKET_TTL;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let ticket = format!(
        "git-repair-{nanos}-{:08x}",
        TICKET_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let mut tickets = TICKETS.lock().expect("git repair ticket lock");
    tickets.get_or_insert_with(HashMap::new).insert(
        ticket.clone(),
        RepairTicket {
            root: root.to_path_buf(),
            action: action.to_owned(),
            head_oid: fingerprint.0,
            remote_oid: fingerprint.1,
            porcelain: fingerprint.2,
            conflict_files: fingerprint.3,
            expires_at,
        },
    );
    let expires_at_ms = expires_at
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default();
    ok(json!({
        "diagnosis": diagnosis,
        "ticket": ticket,
        "ticketExpiresAt": expires_at_ms,
    }))
}

pub fn repair_execute(root: &Path, ticket: &str) -> Value {
    let entry = {
        let mut tickets = TICKETS.lock().expect("git repair ticket lock");
        tickets.as_mut().and_then(|map| map.remove(ticket))
    };
    let Some(entry) = entry else {
        return error("INVALID_TICKET", "Repair ticket does not exist");
    };
    if entry.root != root {
        return error("ROOT_CHANGED", "Repair ticket belongs to a different vault");
    }
    if SystemTime::now() > entry.expires_at {
        return error("TICKET_EXPIRED", "Repair ticket has expired");
    }
    let current = match fingerprint(root) {
        Ok(value) => value,
        Err(err) => return err,
    };
    let prepared = (
        entry.head_oid.clone(),
        entry.remote_oid.clone(),
        entry.porcelain.clone(),
        entry.conflict_files.clone(),
    );
    if !same_fingerprint(&prepared, &current) {
        return error(
            "STATE_DRIFT",
            "Repository state changed after ticket was prepared",
        );
    }

    let diagnosis = match diagnose_data(root) {
        Ok(value) => value,
        Err(err) => return err,
    };
    let conflict = diagnosis
        .get("conflict")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let rebase_in_progress = diagnosis
        .get("rebaseInProgress")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let abort_family = matches!(
        entry.action.as_str(),
        "abort-rebase-or-merge"
            | "resolve-conflict-and-continue"
            | "preserve-local-and-abort"
            | "force-abort-rebase-or-merge"
    );
    if !abort_family && conflict {
        return error("CONFLICT_PRESENT", "Conflicts must be resolved first");
    }
    if abort_family && !rebase_in_progress {
        return error("NO_OPERATION", "No paused rebase or merge is in progress");
    }

    let result = match entry.action.as_str() {
        "commit" => {
            if let Err(err) = run_git(root, &["add", "-A"]) {
                return err;
            }
            run_git(
                root,
                &["commit", "-m", "nexnote:manual: doctor pre-sync commit"],
            )
            .map(|_| ok(json!({ "message": "commit completed" })))
        }
        "pull" => Ok(pull(root, false)),
        "push" => Ok(push(root)),
        "abort-rebase-or-merge" | "force-abort-rebase-or-merge" => abort_in_progress(root)
            .map(|kind| ok(json!({ "message": format!("{kind} aborted"), "kind": kind }))),
        "resolve-conflict-and-continue" => resolve_self_owned_conflicts(root),
        "preserve-local-and-abort" => preserve_local_and_abort(root),
        _ => Err(error("INVALID_ACTION", "Unknown repair action")),
    };
    match result {
        Ok(value) => {
            let after = match diagnose_data(root) {
                Ok(data) => data,
                Err(err) => return err,
            };
            let mut data = match value {
                Value::Object(map) => map,
                _ => Map::new(),
            };
            data.insert("status".to_owned(), after);
            ok(Value::Object(data))
        }
        Err(err) => err,
    }
}

pub fn dismiss(root: &Path) -> Value {
    let _ = root;
    let mut tickets = TICKETS.lock().expect("git repair ticket lock");
    *tickets = None;
    ok(json!({ "dismissed": true }))
}

fn abort_in_progress(root: &Path) -> Result<&'static str, Value> {
    let dir = git_dir(root)?;
    if dir.join("rebase-merge").exists() || dir.join("rebase-apply").exists() {
        run_git(root, &["rebase", "--abort"])?;
        Ok("rebase")
    } else if dir.join("MERGE_HEAD").exists() {
        run_git(root, &["merge", "--abort"])?;
        Ok("merge")
    } else {
        Err(error(
            "NO_OPERATION",
            "No paused rebase or merge is in progress",
        ))
    }
}

fn resolve_self_owned_conflicts(root: &Path) -> Result<Value, Value> {
    let files = porcelain_conflict_files(root)?;
    if files.is_empty() {
        return Err(error("NO_OPERATION", "No conflict files remain"));
    }
    if files.iter().any(|file| file != ".gitignore") {
        return Err(error(
            "CONFLICT_NOT_SELF_RESOLVABLE",
            "Only .gitignore conflicts can be resolved automatically",
        ));
    }
    run_git(root, &["checkout", "--theirs", "--", ".gitignore"])?;
    run_git(root, &["add", "--", ".gitignore"])?;
    run_git_env(
        root,
        &["rebase", "--continue"],
        &[("GIT_EDITOR", "true"), ("GIT_SEQUENCE_EDITOR", "true")],
    )?;
    let status = status_info(root)?;
    if status.ahead > 0 {
        let push_result = push(root);
        if !push_result
            .get("ok")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Err(push_result);
        }
    }
    Ok(ok(json!({ "message": "conflict resolved" })))
}

fn preserve_local_and_abort(root: &Path) -> Result<Value, Value> {
    let dir = git_dir(root)?;
    let rebase_dir = if dir.join("rebase-merge").exists() {
        Some(dir.join("rebase-merge"))
    } else if dir.join("rebase-apply").exists() {
        Some(dir.join("rebase-apply"))
    } else {
        None
    };
    if rebase_dir.is_none() {
        run_git(root, &["merge", "--abort"])?;
        return Ok(ok(json!({
            "message": "merge aborted without local commit preservation",
            "aheadCount": 0,
            "exported": 0,
            "recoveryDir": "",
        })));
    }
    let rebase_dir = rebase_dir.expect("rebase directory checked");
    let original_head = fs::read_to_string(rebase_dir.join("orig-head"))
        .map_err(|_| error("STATE_DRIFT", "Missing rebase orig-head"))?
        .trim()
        .to_owned();
    let onto = fs::read_to_string(rebase_dir.join("onto"))
        .map_err(|_| error("STATE_DRIFT", "Missing rebase onto target"))?
        .trim()
        .to_owned();
    let merge_base = run_git(root, &["merge-base", &original_head, &onto])?
        .stdout
        .trim()
        .to_owned();
    let ahead_shas = run_git(
        root,
        &[
            "rev-list",
            "--reverse",
            &format!("{merge_base}..{original_head}"),
        ],
    )?
    .stdout
    .lines()
    .filter(|line| !line.trim().is_empty())
    .count();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| format!("{}-{:09}", value.as_secs(), value.subsec_nanos()))
        .unwrap_or_else(|_| "unknown".to_owned());
    let recovery_dir = root
        .join(".nexnote")
        .join(".rebase-recovery")
        .join(timestamp);
    fs::create_dir_all(&recovery_dir).map_err(|err| {
        error(
            "PRESERVE_LOCAL_FAILED",
            &format!("create recovery directory failed: {err}"),
        )
    })?;
    run_git(
        root,
        &[
            "format-patch",
            "-o",
            recovery_dir.to_string_lossy().as_ref(),
            &format!("{merge_base}..{original_head}"),
        ],
    )?;
    let exported = fs::read_dir(&recovery_dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "patch"))
                .count()
        })
        .unwrap_or(0);
    run_git(root, &["rebase", "--abort"])?;
    let restored = head_oid(root).unwrap_or_default();
    if restored != original_head {
        return Err(error(
            "PRESERVE_LOCAL_FAILED",
            "HEAD was not restored after abort",
        ));
    }
    if exported != ahead_shas {
        return Err(error(
            "PRESERVE_LOCAL_FAILED",
            "Patch export count did not match local commits",
        ));
    }
    let relative = recovery_dir
        .strip_prefix(root)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| recovery_dir.to_string_lossy().into_owned());
    Ok(ok(json!({
        "message": "local commits preserved and rebase aborted",
        "aheadCount": ahead_shas,
        "exported": exported,
        "recoveryDir": relative,
    })))
}

fn load_config(root: &Path) -> Value {
    let path = root.join(".nexnote").join("config.json");
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!({ "version": 1, "settings": { "git": {} } }))
}

fn save_config(root: &Path, config: &Value) -> Result<(), Value> {
    let path = root.join(".nexnote").join("config.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            error(
                "CONFIG_WRITE_FAILED",
                &format!("create vault config directory failed: {err}"),
            )
        })?;
    }
    let serialized = serde_json::to_vec_pretty(config).map_err(|err| {
        error(
            "CONFIG_WRITE_FAILED",
            &format!("serialize vault config failed: {err}"),
        )
    })?;
    fs::write(path, serialized).map_err(|err| {
        error(
            "CONFIG_WRITE_FAILED",
            &format!("write vault config failed: {err}"),
        )
    })
}

fn settings_git_mut(config: &mut Value) -> &mut Map<String, Value> {
    if !config.is_object() {
        *config = json!({});
    }
    let object = config.as_object_mut().expect("config checked as object");
    let settings = object.entry("settings").or_insert_with(|| json!({}));
    if !settings.is_object() {
        *settings = json!({});
    }
    let settings = settings
        .as_object_mut()
        .expect("settings checked as object");
    let git = settings.entry("git").or_insert_with(|| json!({}));
    if !git.is_object() {
        *git = json!({});
    }
    git.as_object_mut().expect("git settings checked as object")
}

fn debounce_value(config: &Value) -> u64 {
    config
        .get("settings")
        .and_then(|settings| settings.get("git"))
        .and_then(|git| git.get("autoCommitIntervalMs"))
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_DEBOUNCE_MS)
        .clamp(MIN_DEBOUNCE_MS, MAX_DEBOUNCE_MS)
}

pub fn configure_auto_sync(root: &Path, enabled: bool, interval_sec: u64, strategy: &str) -> Value {
    if strategy != "rebase" && strategy != "merge" {
        return error("INVALID_STRATEGY", "Sync strategy must be rebase or merge");
    }
    let mut config = load_config(root);
    {
        let git = settings_git_mut(&mut config);
        git.insert("autoSyncEnabled".to_owned(), Value::Bool(enabled));
        git.insert(
            "autoSyncIntervalSec".to_owned(),
            Value::from(if enabled { interval_sec } else { 0 }),
        );
        git.insert(
            "syncStrategy".to_owned(),
            Value::String(strategy.to_owned()),
        );
    }
    if let Err(err) = save_config(root, &config) {
        return err;
    }
    ok(json!({
        "enabled": enabled,
        "intervalSec": if enabled { interval_sec } else { 0 },
        "strategy": strategy,
    }))
}

pub fn get_auto_commit_debounce(root: &Path) -> Value {
    let config = load_config(root);
    ok(json!({ "milliseconds": debounce_value(&config) }))
}

pub fn set_auto_commit_debounce(root: &Path, milliseconds: u64) -> Value {
    let value = milliseconds.clamp(MIN_DEBOUNCE_MS, MAX_DEBOUNCE_MS);
    let mut config = load_config(root);
    settings_git_mut(&mut config).insert("autoCommitIntervalMs".to_owned(), Value::from(value));
    if let Err(err) = save_config(root, &config) {
        return err;
    }
    ok(json!({ "milliseconds": value }))
}

const SENSITIVE_KEYS: [&str; 13] = [
    "refresh_token",
    "access_token",
    "client_secret",
    "secret_key",
    "private_key",
    "auth_token",
    "api_key",
    "apikey",
    "authorization",
    "password",
    "passwd",
    "token",
    "secret",
];

fn sanitize_text(input: &str) -> String {
    let masked_urls = mask_url_userinfo(input);
    mask_sensitive_assignments(&masked_urls)
}

fn mask_url_userinfo(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = String::with_capacity(input.len());
    let mut index = 0;
    while index < bytes.len() {
        if !bytes[index..].starts_with(b"://") {
            let ch = input[index..].chars().next().expect("valid UTF-8 slice");
            output.push(ch);
            index += ch.len_utf8();
            continue;
        }
        let colon = index;
        let mut scheme_start = colon;
        while scheme_start > 0 {
            let previous = input[..scheme_start]
                .chars()
                .next_back()
                .expect("valid UTF-8 slice");
            if previous.is_ascii_alphanumeric() || matches!(previous, '+' | '-' | '.') {
                scheme_start -= previous.len_utf8();
            } else {
                break;
            }
        }
        output.push_str(&input[colon..colon + 3]);
        let authority_start = colon + 3;
        let mut authority_end = authority_start;
        while authority_end < bytes.len() {
            let byte = bytes[authority_end];
            if byte.is_ascii_whitespace()
                || matches!(byte, b'/' | b'?' | b'#' | b'"' | b'\'' | b'<' | b'>')
            {
                break;
            }
            authority_end += 1;
        }
        let authority = &input[authority_start..authority_end];
        if let Some(at) = authority.find('@') {
            output.push_str("***@");
            output.push_str(&authority[at + 1..]);
        } else {
            output.push_str(authority);
        }
        index = authority_end;
    }
    output
}

fn mask_sensitive_assignments(input: &str) -> String {
    let lower_bytes = input.to_ascii_lowercase();
    let lower = lower_bytes.as_bytes();
    let bytes = input.as_bytes();
    let mut ranges = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        let mut matched = None;
        for key in SENSITIVE_KEYS {
            if !lower[index..].starts_with(key.as_bytes()) {
                continue;
            }
            let boundary_ok = index == 0
                || !(lower[index - 1].is_ascii_alphanumeric() || lower[index - 1] == b'_');
            let after = index + key.len();
            let separator_ok =
                after < bytes.len() && (bytes[after] == b'=' || bytes[after] == b':');
            if boundary_ok && separator_ok {
                matched = Some((index, after, key));
                break;
            }
        }
        if let Some((key_start, key_end, key)) = matched {
            let mut cursor = key_end;
            while cursor < bytes.len() && matches!(bytes[cursor], b' ' | b'\t') {
                cursor += 1;
            }
            if key == "authorization" {
                for scheme in ["bearer", "basic", "token"] {
                    if lower[cursor..].starts_with(scheme.as_bytes()) {
                        cursor += scheme.len();
                        while cursor < bytes.len() && matches!(bytes[cursor], b' ' | b'\t') {
                            cursor += 1;
                        }
                        break;
                    }
                }
            }
            let mut quote = 0u8;
            if cursor < bytes.len() && (bytes[cursor] == b'"' || bytes[cursor] == b'\'') {
                quote = bytes[cursor];
                cursor += 1;
            }
            let value_start = cursor;
            while cursor < bytes.len() {
                let byte = bytes[cursor];
                if quote != 0 && byte == quote {
                    break;
                }
                if quote == 0
                    && matches!(
                        byte,
                        b' ' | b'\t'
                            | b'&'
                            | b';'
                            | b','
                            | b'"'
                            | b'\''
                            | b'\n'
                            | b'\r'
                            | b')'
                            | b'>'
                    )
                {
                    break;
                }
                cursor += 1;
            }
            if cursor > value_start {
                ranges.push((value_start, cursor));
            }
            index = cursor.max(key_start + 1);
        } else {
            let ch = input[index..].chars().next().expect("valid UTF-8 slice");
            index += ch.len_utf8();
        }
    }
    let mut output = input.to_owned();
    for (start, end) in ranges.iter().rev() {
        output.replace_range(start..end, "***");
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::id;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_repo() -> PathBuf {
        let unique = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or_default();
        let root =
            std::env::temp_dir().join(format!("nexnote-git-sync-test-{}-{nanos}-{unique}", id()));
        fs::create_dir_all(&root).expect("create temp repo");
        let status = Command::new("git")
            .arg("init")
            .current_dir(&root)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("git must be installed for tests");
        assert!(status.success());
        root
    }

    #[test]
    fn adds_and_lists_remotes() {
        let root = temp_repo();
        let result = add_remote(&root, "origin", "https://example.com/repo.git");
        assert_eq!(result.get("ok"), Some(&Value::Bool(true)));
        let remotes = list_remotes(&root);
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].name, "origin");
        assert_eq!(remotes[0].fetch_url, "https://example.com/repo.git");
        assert_eq!(remotes[0].push_url, "https://example.com/repo.git");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_invalid_remote_name() {
        let root = temp_repo();
        let result = add_remote(&root, "1bad", "https://example.com/repo.git");
        assert_eq!(result.get("ok"), Some(&Value::Bool(false)));
        assert_eq!(
            result.get("code").and_then(Value::as_str),
            Some("INVALID_REMOTE")
        );
        assert!(list_remotes(&root).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn masks_remote_credentials_in_list() {
        let root = temp_repo();
        let result = add_remote(
            &root,
            "secret",
            "https://user:token123@example.com/repo.git?access_token=abc123",
        );
        assert_eq!(result.get("ok"), Some(&Value::Bool(true)));
        let remotes = list_remotes(&root);
        let serialized = serde_json::to_string(&remotes).expect("serialize remotes");
        assert!(!serialized.contains("token123"));
        assert!(!serialized.contains("abc123"));
        assert!(serialized.contains("***"));
        let _ = fs::remove_dir_all(root);
    }
}
