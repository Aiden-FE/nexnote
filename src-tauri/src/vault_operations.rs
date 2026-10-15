//! One-shot clone authorization and cancellable onboarding operations.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_TOKENS_PER_SENDER: usize = 8;
const TOKEN_TTL_MS: u64 = 5 * 60 * 1000;

#[derive(Debug)]
struct ClonePreflightToken {
    sender: String,
    url: String,
    target_dir: String,
    created_at: u64,
}

#[derive(Debug, Default)]
pub struct CloneTokenStore {
    tokens: HashMap<String, ClonePreflightToken>,
}

impl CloneTokenStore {
    pub fn create(&mut self, sender: &str, url: &str, target_dir: &str) -> String {
        self.sweep_expired();
        let by_sender = self
            .tokens
            .values()
            .filter(|token| token.sender == sender)
            .count();
        if by_sender >= MAX_TOKENS_PER_SENDER {
            if let Some(oldest) = self
                .tokens
                .iter()
                .filter(|(_, token)| token.sender == sender)
                .min_by_key(|(_, token)| token.created_at)
                .map(|(key, _)| key.clone())
            {
                self.tokens.remove(&oldest);
            }
        }
        let token = format!("clone-token-{}", unique_suffix());
        self.tokens.insert(
            token.clone(),
            ClonePreflightToken {
                sender: sender.to_owned(),
                url: url.to_owned(),
                target_dir: target_dir.to_owned(),
                created_at: now_ms(),
            },
        );
        token
    }

    pub fn consume(
        &mut self,
        token: &str,
        sender: &str,
        url: &str,
        target_dir: &str,
    ) -> Result<(), &'static str> {
        let Some(entry) = self.tokens.remove(token) else {
            return Err("INVALID_TOKEN");
        };
        if entry.sender != sender {
            return Err("SENDER_MISMATCH");
        }
        if now_ms().saturating_sub(entry.created_at) > TOKEN_TTL_MS {
            return Err("EXPIRED");
        }
        if entry.url != url || entry.target_dir != target_dir {
            return Err("PARAM_MISMATCH");
        }
        Ok(())
    }

    fn sweep_expired(&mut self) {
        let now = now_ms();
        self.tokens
            .retain(|_, token| now.saturating_sub(token.created_at) <= TOKEN_TTL_MS);
    }
}

#[derive(Debug)]
struct VaultOperation {
    cancelled: Arc<AtomicBool>,
}

#[derive(Debug, Default)]
pub struct VaultOperationRegistry {
    by_sender: HashMap<String, HashMap<String, VaultOperation>>,
}

impl VaultOperationRegistry {
    pub fn start(&mut self, sender: &str, operation_id: &str) -> Arc<AtomicBool> {
        let cancelled = Arc::new(AtomicBool::new(false));
        self.by_sender.entry(sender.to_owned()).or_default().insert(
            operation_id.to_owned(),
            VaultOperation {
                cancelled: Arc::clone(&cancelled),
            },
        );
        cancelled
    }

    pub fn cancel(&mut self, sender: &str, operation_id: &str) -> bool {
        let Some(operations) = self.by_sender.get_mut(sender) else {
            return false;
        };
        let Some(operation) = operations.get(operation_id) else {
            return false;
        };
        operation.cancelled.store(true, Ordering::SeqCst);
        true
    }

    pub fn finish(&mut self, sender: &str, operation_id: &str) {
        if let Some(operations) = self.by_sender.get_mut(sender) {
            operations.remove(operation_id);
            if operations.is_empty() {
                self.by_sender.remove(sender);
            }
        }
    }
}

pub fn run_git_with_timeout(
    args: &[&str],
    timeout: Duration,
) -> Result<std::process::Output, crate::git_service::GitProcessError> {
    let mut command = std::process::Command::new(crate::git_service::resolve_git_binary());
    command.args(args);
    crate::git_service::configure_git_command(&mut command);
    crate::git_service::run_command_with_timeout(&mut command, timeout)
}

pub fn run_git_with_cancel(
    args: &[&str],
    timeout: Duration,
    cancelled: Option<&AtomicBool>,
) -> Result<std::process::Output, crate::git_service::GitProcessError> {
    let mut command = std::process::Command::new(crate::git_service::resolve_git_binary());
    command.args(args);
    crate::git_service::configure_git_command(&mut command);
    crate::git_service::run_command_with_cancel(&mut command, timeout, cancelled)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

static UNIQUE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn unique_suffix() -> String {
    let sequence = UNIQUE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{:016x}-{}", now_ms(), sequence)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clone_tokens_are_sender_bound_one_shot_and_parameter_bound() {
        let mut tokens = CloneTokenStore::default();
        let token = tokens.create("main", "https://example.test/a.git", "/tmp/a");
        assert!(tokens
            .consume("other", &token, "https://example.test/a.git", "/tmp/a")
            .is_err());
        let url_token = tokens.create("main", "https://example.test/a.git", "/tmp/a");
        assert!(tokens
            .consume("main", &url_token, "https://example.test/b.git", "/tmp/a")
            .is_err());
        let target_token = tokens.create("main", "https://example.test/a.git", "/tmp/a");
        assert!(tokens
            .consume(
                "main",
                &target_token,
                "https://example.test/a.git",
                "/tmp/b"
            )
            .is_err());
        let valid_token = tokens.create("main", "https://example.test/a.git", "/tmp/a");
        assert!(tokens.tokens.contains_key(&valid_token));
        assert_eq!(
            tokens.consume(&valid_token, "main", "https://example.test/a.git", "/tmp/a"),
            Ok(())
        );
        assert!(tokens
            .consume("main", &valid_token, "https://example.test/a.git", "/tmp/a")
            .is_err());
        assert!(tokens
            .consume("main", &token, "https://example.test/a.git", "/tmp/a")
            .is_err());
    }

    #[test]
    fn operation_cancel_is_sender_and_id_bound() {
        let mut operations = VaultOperationRegistry::default();
        let cancelled = operations.start("main", "operation-1");
        assert!(!cancelled.load(Ordering::SeqCst));
        assert!(!operations.cancel("other", "operation-1"));
        assert!(!operations.cancel("main", "operation-2"));
        assert!(operations.cancel("main", "operation-1"));
        assert!(cancelled.load(Ordering::SeqCst));
        operations.finish("main", "operation-1");
        assert!(!operations.cancel("main", "operation-1"));
    }
}
