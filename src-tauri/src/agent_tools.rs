//! Agent tool registry for the Tauri product core (DEV-121).
//!
//! Mirrors `packages/main/src/agent/builtin-tools.ts` + `tool-registry.ts`:
//! each scenario exposes an allowlist of controlled tools, every definition
//! declares its access level, and execution happens against the same Rust
//! services the IPC channels use (retrieval, index, vault fs, git sync
//! doctor). There is deliberately no shell/command tool and no arbitrary file
//! bridge — the registry only knows the five tools below.

use std::path::Path;

use serde_json::{json, Value};

/// Whether a tool may modify the vault, and whether the gateway must park an
/// approval before running it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolAccess {
    Read,
    Write,
}

/// One registered tool definition.
#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: &'static str,
    pub description: &'static str,
    pub access: ToolAccess,
    pub requires_approval: bool,
    /// JSON Schema sent to the provider as `function.parameters`.
    pub parameters: Value,
}

impl ToolDefinition {
    /// Provider-facing function-tool shape.
    pub fn to_provider_tool(&self) -> Value {
        json!({
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        })
    }
}

/// All registered tools. Built once at first use because the schemas are
/// assembled with `json!`, which is not const-evaluable.
fn all() -> &'static [ToolDefinition] {
    static REGISTRY: std::sync::OnceLock<Vec<ToolDefinition>> = std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| {
        vec![
            ToolDefinition {
                name: "search_notes",
                description: "在当前知识库内做三阶段检索（FTS + 双链 + 向量重排），返回相关页面片段。",
                access: ToolAccess::Read,
                requires_approval: false,
                parameters: json!({
                    "type": "object",
                    "properties": { "query": { "type": "string" }, "topK": { "type": "number" } },
                    "required": ["query"],
                }),
            },
            ToolDefinition {
                name: "list_pages",
                description: "列出当前知识库的全部页面（相对路径与标题），用于了解库结构。",
                access: ToolAccess::Read,
                requires_approval: false,
                parameters: json!({ "type": "object", "properties": {} }),
            },
            ToolDefinition {
                name: "edit_current_selection",
                description: "将当前上下文文档中的指定选区替换为 Markdown 文本。",
                access: ToolAccess::Write,
                requires_approval: true,
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "expectedText": { "type": "string" },
                        "content": { "type": "string" },
                    },
                    "required": ["path", "expectedText", "content"],
                }),
            },
            ToolDefinition {
                name: "append_to_document",
                description: "向当前上下文文档末尾追加 Markdown 文本。",
                access: ToolAccess::Write,
                requires_approval: true,
                parameters: json!({
                    "type": "object",
                    "properties": { "path": { "type": "string" }, "content": { "type": "string" } },
                    "required": ["path", "content"],
                }),
            },
            ToolDefinition {
                name: "git_doctor_repair",
                description:
                    "执行医生已批准的 git 修复动作（commit / pull / push / abort-rebase-or-merge / \
                     resolve-conflict-and-continue / preserve-local-and-abort / force-abort-rebase-or-merge）。\
                     resolve-conflict-and-continue 会真正完成同步；其余 abort 系动作只会中止 rebase、同步并未完成。\
                     调用前必须先有医生的诊断结果（医生推荐的 action），不要自行决定 action。",
                access: ToolAccess::Write,
                requires_approval: true,
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": crate::git_sync::REPAIR_ACTIONS,
                            "description": "医生已批准的 GitRepairAction（来自医生诊断的 plan.action 字段）。",
                        },
                    },
                    "required": ["action"],
                }),
            },
        ]
    })
}

/// Per-scenario allowlist, matching `AGENT_SCENARIO_PROFILES` in the Electron
/// gateway. Translation is read-only with no tools at all.
pub fn allowed_tools(scenario: &str) -> Vec<&'static ToolDefinition> {
    let allowed: &[&str] = match scenario {
        "chat" => &[
            "search_notes",
            "list_pages",
            "edit_current_selection",
            "append_to_document",
            "git_doctor_repair",
        ],
        "writing" | "debug" => &[
            "search_notes",
            "list_pages",
            "edit_current_selection",
            "append_to_document",
        ],
        // Translation is a pure text transform: no document write capability.
        _ => &[],
    };
    all()
        .iter()
        .filter(|definition| allowed.contains(&definition.name))
        .collect()
}

/// Provider-facing tool declarations for one scenario.
pub fn provider_tools(scenario: &str) -> Vec<Value> {
    allowed_tools(scenario)
        .into_iter()
        .map(ToolDefinition::to_provider_tool)
        .collect()
}

/// Tool execution failure with the stable code the gateway reports upstream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolError {
    pub code: String,
    pub message: String,
}

impl ToolError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

/// Services the tools execute against. Supplied by the dispatch layer so this
/// module stays independent of Tauri state plumbing.
pub struct ToolDeps<'a> {
    pub root: &'a Path,
    /// Three-stage retrieval over the open vault.
    pub retrieve: &'a dyn Fn(&str, Option<usize>) -> Value,
}

/// Executes one tool after the gateway already approved it.
pub fn execute(
    deps: &ToolDeps<'_>,
    name: &str,
    input: &Value,
    approved: bool,
) -> Result<Value, ToolError> {
    match name {
        "search_notes" => {
            let query = input
                .get("query")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|query| !query.is_empty())
                .ok_or_else(|| ToolError::new("INVALID_SEARCH_INPUT", "query is required"))?
                .to_owned();
            let top_k = input
                .get("topK")
                .and_then(Value::as_u64)
                .map(|top| top as usize);
            Ok((deps.retrieve)(&query, top_k))
        }
        "list_pages" => Ok(list_pages(deps.root)),
        "edit_current_selection" => {
            let (path, expected, content) = write_inputs(input)?;
            if !approved {
                return Err(ToolError::new(
                    "APPROVAL_REQUIRED",
                    "edit_current_selection requires an approved write",
                ));
            }
            let current = read_document(deps.root, &path)?;
            let Some(index) = unique_index(&current, &expected) else {
                return Err(ToolError::new(
                    "STALE_SELECTION",
                    "expectedText is missing or not unique in the document",
                ));
            };
            let next = format!(
                "{}{}{}",
                &current[..index],
                content,
                &current[index + expected.len()..]
            );
            write_document(deps.root, &path, &next)?;
            Ok(json!({
                "path": path,
                "operation": "replace",
                "chars": content.chars().count(),
            }))
        }
        "append_to_document" => {
            let (path, content) = append_inputs(input)?;
            if !approved {
                return Err(ToolError::new(
                    "APPROVAL_REQUIRED",
                    "append_to_document requires an approved write",
                ));
            }
            let current = read_document(deps.root, &path)?;
            let separator = if current.is_empty() || current.ends_with('\n') {
                ""
            } else {
                "\n"
            };
            write_document(deps.root, &path, &format!("{current}{separator}{content}"))?;
            Ok(json!({
                "path": path,
                "operation": "append",
                "chars": content.chars().count(),
            }))
        }
        "git_doctor_repair" => {
            let action = input
                .get("action")
                .and_then(Value::as_str)
                .ok_or_else(|| ToolError::new("INVALID_DOCTOR_INPUT", "action is required"))?;
            if !approved {
                return Err(ToolError::new(
                    "DOCTOR_REQUIRES_APPROVAL",
                    "git_doctor_repair requires an approved write",
                ));
            }
            doctor_repair(deps.root, action)
        }
        _ => Err(ToolError::new(
            "TOOL_NOT_FOUND",
            format!("Unknown agent tool: {name}"),
        )),
    }
}

fn list_pages(root: &Path) -> Value {
    let response = crate::index_service::page_summaries(root);
    let pages: Vec<Value> = response
        .get("data")
        .and_then(Value::as_array)
        .map(|pages| {
            pages
                .iter()
                .map(|page| {
                    json!({
                        "path": page.get("path").cloned().unwrap_or(Value::Null),
                        "title": page.get("title").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    json!({ "pages": pages })
}

fn write_inputs(input: &Value) -> Result<(String, String, String), ToolError> {
    let path = required_string(input, "path")?;
    let expected = required_string(input, "expectedText")?;
    let content = required_string(input, "content")?;
    Ok((path, expected, content))
}

fn append_inputs(input: &Value) -> Result<(String, String), ToolError> {
    Ok((
        required_string(input, "path")?,
        required_string(input, "content")?,
    ))
}

fn required_string(input: &Value, field: &str) -> Result<String, ToolError> {
    input
        .get(field)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| ToolError::new("INVALID_EDIT_INPUT", format!("{field} is required")))
}

fn read_document(root: &Path, path: &str) -> Result<String, ToolError> {
    let response = crate::vault_fs::read_text_file(root, &json!({ "path": path }));
    if response.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(response
            .get("data")
            .and_then(|data| data.get("content"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned());
    }
    Err(ToolError::new("READ_FAILED", response_error(&response)))
}

fn write_document(root: &Path, path: &str, content: &str) -> Result<(), ToolError> {
    let response =
        crate::vault_fs::write_text_file(root, &json!({ "path": path, "content": content }));
    if response.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(())
    } else {
        Err(ToolError::new("WRITE_FAILED", response_error(&response)))
    }
}

fn doctor_repair(root: &Path, action: &str) -> Result<Value, ToolError> {
    if !crate::git_sync::is_repair_action(action) {
        return Err(ToolError::new(
            "INVALID_DOCTOR_ACTION",
            format!("Unknown repair action: {action}"),
        ));
    }
    // TOCTOU + TTL safety live in prepare/execute; the agent path reuses them
    // instead of re-deriving the action or executing git itself.
    let prepared = crate::git_sync::repair_prepare(root, action);
    if prepared.get("ok").and_then(Value::as_bool) != Some(true) {
        let code = prepared
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("REPAIR_PREPARE_FAILED")
            .to_owned();
        return Err(ToolError::new(code, response_error(&prepared)));
    }
    let ticket = prepared
        .get("data")
        .and_then(|data| data.get("ticket"))
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError::new("REPAIR_PREPARE_FAILED", "repair ticket is missing"))?
        .to_owned();
    let executed = crate::git_sync::repair_execute(root, &ticket);
    if executed.get("ok").and_then(Value::as_bool) != Some(true) {
        let code = executed
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("REPAIR_EXECUTE_FAILED")
            .to_owned();
        return Err(ToolError::new(code, response_error(&executed)));
    }
    let data = executed.get("data").cloned().unwrap_or(json!({}));
    Ok(json!({
        "ticket": ticket,
        "action": action,
        "message": data.get("message").cloned().unwrap_or(Value::Null),
        "preserve": data.get("preserve").cloned().unwrap_or(Value::Bool(false)),
    }))
}

fn response_error(response: &Value) -> String {
    response
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("tool call failed")
        .to_owned()
}

/// Byte offset of `needle` when it occurs exactly once; `None` for missing or
/// ambiguous matches protects against stale-selection overwrites.
fn unique_index(haystack: &str, needle: &str) -> Option<usize> {
    if needle.is_empty() {
        return None;
    }
    let first = haystack.find(needle)?;
    (!haystack[first + needle.len()..].contains(needle)).then_some(first)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scenario_allowlists_match_the_reference_profiles() {
        fn names(scenario: &str) -> Vec<&str> {
            allowed_tools(scenario)
                .into_iter()
                .map(|definition| definition.name)
                .collect()
        }
        assert_eq!(
            names("chat"),
            vec![
                "search_notes",
                "list_pages",
                "edit_current_selection",
                "append_to_document",
                "git_doctor_repair",
            ]
        );
        assert_eq!(
            names("writing"),
            vec![
                "search_notes",
                "list_pages",
                "edit_current_selection",
                "append_to_document",
            ]
        );
        assert!(names("translation").is_empty(), "translation has no tools");
    }

    #[test]
    fn provider_tools_use_the_function_shape() {
        let tools = provider_tools("debug");
        assert_eq!(tools.len(), 4);
        let first = &tools[0];
        assert_eq!(first.get("type").and_then(Value::as_str), Some("function"));
        assert_eq!(
            first.pointer("/function/name").and_then(Value::as_str),
            Some("search_notes")
        );
    }

    #[test]
    fn unique_index_rejects_missing_and_ambiguous_text() {
        assert_eq!(unique_index("aXaX", "X"), None);
        assert_eq!(unique_index("hello world", "world"), Some(6));
        assert_eq!(unique_index("hello world", "nope"), None);
        assert_eq!(unique_index("abc", ""), None);
    }

    #[test]
    fn write_tools_refuse_to_run_without_approval() {
        let root = Path::new("/nonexistent-nexnote-vault");
        let deps = ToolDeps {
            root,
            retrieve: &|_, _| json!({}),
        };
        let error = execute(
            &deps,
            "append_to_document",
            &json!({ "path": "a.md", "content": "x" }),
            false,
        )
        .expect_err("unapproved writes must be refused");
        assert_eq!(error.code, "APPROVAL_REQUIRED");
    }

    #[test]
    fn unknown_tools_and_bad_input_report_stable_codes() {
        let deps = ToolDeps {
            root: Path::new("/nonexistent-nexnote-vault"),
            retrieve: &|_, _| json!({}),
        };
        assert_eq!(
            execute(&deps, "nope", &json!({}), false)
                .expect_err("unknown tool")
                .code,
            "TOOL_NOT_FOUND"
        );
        assert_eq!(
            execute(&deps, "search_notes", &json!({}), false)
                .expect_err("query is required")
                .code,
            "INVALID_SEARCH_INPUT"
        );
    }
}
