//! Scenario prompt assembly for agent runs (DEV-121).
//!
//! The renderer deliberately cannot supply the model-facing system prompts:
//! translation must never open reasoning, and writing's action templates must
//! not drift per client. These live beside the tools so the main process keeps
//! that authority, matching `packages/main/src/agent/{gateway,translation}.ts`.

use serde_json::{json, Value};

/// Upper bound on a single translation input, mirroring
/// `TRANSLATION_MAX_TEXT_CHARS`: over-long input is refused, never truncated.
pub const TRANSLATION_MAX_TEXT_CHARS: usize = 200_000;

const TRANSLATION_BASE: &str = concat!(
    "你是 NexNote 内置翻译助手。把用户提供的文本完整翻译成目标语言，只输出译文本身，",
    "不要任何解释、前后缀或代码围栏。",
    "保持 Markdown 结构（标题、列表、表格、代码块）以及其中的 [[双链]]、#tag 与 ^id 块锚点语法。"
);

const CHAT_SYSTEM: &str = concat!(
    "你是 NexNote 内置知识库对话助手。基于提供的上下文回答，不要编造来源。\n",
    "【硬约束】当用户消息携带「同步医生诊断」chip（chip.kind=sync-doctor）时，",
    "你必须立即调用 git_doctor_repair 工具，参数 action=医生推荐的 action",
    "（chip 文本里「推荐操作：」那一行的值）。",
    "你的目标是真正解决同步问题、完成同步，而不是回避它：",
    "若医生推荐 resolve-conflict-and-continue，就用它",
    "（它会规范化应用自有文件并继续 rebase 与推送）；",
    "不要改用 abort 系动作让同步停在中途，除非用户明确要求放弃本地改动。",
    "不允许先问「是否执行」、不允许输出步骤说明、不要让用户手动操作终端。",
    "回复流程固定为：（1）一句话告诉用户你打算做什么；（2）调用 git_doctor_repair 工具；",
    "（3）等待主进程弹出审批 banner 让用户批准；（4）拿到结果后用一两句话报告成功或具体错误码。"
);

const DEBUG_SYSTEM: &str = "你是 NexNote 知识库助手。简洁回答并指出不确定性。";

const WRITING_BASE: &str = concat!(
    "你是 NexNote 内置的 Markdown 笔记写作助手。",
    "严格只输出处理后的正文（Obsidian 方言 Markdown），不要任何解释、前后缀或代码围栏。",
    "保持原文语言，保留其中的双链 [[...]]、标签 #tag 与 ^id 块锚点语法。"
);

/// One writing action's system task line.
fn writing_task(action_id: &str) -> Option<&'static str> {
    Some(match action_id {
        "rewrite" => "在保持原意的前提下改写文本，使表达更清晰流畅，可调整句式但不增删观点。",
        "polish" => "润色文本，修正语病、错别字与标点，提升措辞，尽量不改变结构与长度。",
        "condense" => "缩写文本，保留核心观点，去除冗余，输出更精炼的正文。",
        "expand" => "基于给定文本扩写，补充细节与阐释，输出要新增的正文段落，不要重复原文。",
        "fillgaps" => "检查文本的论证/信息缺口，补充缺失的衔接、前提或必要说明，输出要新增的正文。",
        "evidence" => {
            "为文本的观点补充支撑论据、例子或说明，输出要新增的正文，使用列表组织多条论据。"
        }
        _ => return None,
    })
}

/// Reference context note: explicitly marked as possibly truncated.
fn writing_context(context: &str) -> String {
    let trimmed = context.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    format!("\n\n【参考上下文（可能已被截断，仅供理解，不要照抄）】\n{trimmed}")
}

/// Validation failure for an agent request, carrying the Electron error code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestError {
    pub code: &'static str,
    pub message: String,
}

/// Rejects target languages outside the safe charset: letters, digits, spaces,
/// brackets and common connectors, at most 40 characters. Narrowing the
/// charset shrinks the prompt-injection surface. No regex engine is needed —
/// the allowed set is small and explicit.
fn target_language_is_safe(language: &str) -> bool {
    let length = language.chars().count();
    if !(1..=40).contains(&length) {
        return false;
    }
    language.chars().all(|character| {
        character.is_alphanumeric() || matches!(character, ' ' | '(' | ')' | '·' | '-' | '+')
    })
}

/// Builds the main-process-owned message list for one run.
///
/// `context_text` is the renderer's own supplied context; skill context is
/// already merged by the caller. Renderer messages are passed through
/// unchanged except that `system` rows are dropped in favour of the templates
/// here — the model-facing instructions stay main-process-owned.
pub fn build_messages(
    scenario: &str,
    payload: &Value,
    context_text: &str,
) -> Result<Vec<Value>, RequestError> {
    let context = context_text.trim();
    match scenario {
        "translation" => {
            let Some(translation) = payload.get("translation") else {
                return Err(RequestError {
                    code: "BAD_TRANSLATION_REQUEST",
                    message: "translation requests must carry a translation payload".to_owned(),
                });
            };
            let language = translation
                .get("targetLanguage")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !target_language_is_safe(language) {
                return Err(RequestError {
                    code: "BAD_TRANSLATION_REQUEST",
                    message: "target language contains unsupported characters".to_owned(),
                });
            }
            let text = translation
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if text.chars().count() > TRANSLATION_MAX_TEXT_CHARS {
                // Refuse rather than truncate: a half-translated document is
                // worse than a visible failure.
                return Err(RequestError {
                    code: "TRANSLATION_TOO_LONG",
                    message: format!(
                        "translation input exceeds {TRANSLATION_MAX_TEXT_CHARS} characters"
                    ),
                });
            }
            let scope = match translation.get("mode").and_then(Value::as_str) {
                Some("document") => "整篇文档",
                Some("input") => "临时输入",
                _ => "选中片段",
            };
            Ok(vec![
                json!({
                    "role": "system",
                    "content": format!("{TRANSLATION_BASE}\n目标语言：{language}。"),
                }),
                json!({
                    "role": "user",
                    "content": format!("请翻译下面的{scope}（Markdown 原文）：\n\n{text}"),
                }),
            ])
        }
        "writing" => {
            let action_id = payload
                .get("actionId")
                .and_then(Value::as_str)
                .ok_or_else(|| RequestError {
                    code: "BAD_WRITING_REQUEST",
                    message: "writing requests must carry an actionId".to_owned(),
                })?;
            let task = writing_task(action_id).ok_or_else(|| RequestError {
                code: "BAD_WRITING_REQUEST",
                message: format!("unknown writing action: {action_id}"),
            })?;
            let target = payload
                .get("target")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let instruction = match action_id {
                "rewrite" => format!(
                    "请改写下面的文本，输出改写后的完整正文。\n\n【待改写文本】\n{target}{}",
                    writing_context(context)
                ),
                "polish" => format!(
                    "请润色下面的文本，输出润色后的完整正文。\n\n【待润色文本】\n{target}{}",
                    writing_context(context)
                ),
                "condense" => format!(
                    "请缩写下面的文本，输出缩写后的正文。\n\n【待缩写文本】\n{target}{}",
                    writing_context(context)
                ),
                "expand" => {
                    let body = if target.is_empty() {
                        "（空块，请基于上文自由展开）".to_owned()
                    } else {
                        target.to_owned()
                    };
                    format!(
                        "请基于下面的文本扩写，输出要新增的正文（Markdown），不要重复已有内容。\n\n【当前文本】\n{body}{}",
                        writing_context(context)
                    )
                }
                "fillgaps" => format!(
                    "请检查下面文本的缺漏并补充，输出要新增的正文（Markdown），不要重复原文。\n\n【当前文本】\n{target}{}",
                    writing_context(context)
                ),
                _ => format!(
                    "请为下面文本的观点补充论据/例子/说明，输出要新增的正文（Markdown，列表为佳）。\n\n【当前文本】\n{target}{}",
                    writing_context(context)
                ),
            };
            Ok(vec![
                json!({ "role": "system", "content": WRITING_BASE }),
                json!({ "role": "system", "content": format!("{WRITING_BASE}\n任务：{task}") }),
                json!({ "role": "user", "content": instruction }),
            ])
        }
        _ => {
            let system = if scenario == "debug" {
                DEBUG_SYSTEM
            } else {
                CHAT_SYSTEM
            };
            let mut messages = vec![json!({ "role": "system", "content": system })];
            if !context.is_empty() {
                messages.push(json!({
                    "role": "system",
                    "content": format!("参考上下文：\n{context}"),
                }));
            }
            let incoming: Vec<Value> = payload
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            // Renderer-supplied system rows are dropped: the scenario template
            // above is the only system instruction the model may act on.
            messages.extend(
                incoming.into_iter().filter(|message| {
                    message.get("role").and_then(Value::as_str) != Some("system")
                }),
            );
            Ok(messages)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content_of(messages: &[Value], index: usize) -> String {
        messages[index]
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    }

    #[test]
    fn chat_keeps_the_doctor_constraint_and_drops_renderer_system_rows() {
        let messages = build_messages(
            "chat",
            &json!({
                "contextText": "  见 [[笔记A]]  ",
                "messages": [
                    { "role": "system", "content": "renderer tries to override" },
                    { "role": "user", "content": "同步失败怎么办" },
                ],
            }),
            "",
        )
        .expect("chat builds");
        assert!(content_of(&messages, 0).contains("git_doctor_repair"));
        assert!(!messages.iter().any(|message| {
            message.get("content").and_then(Value::as_str) == Some("renderer tries to override")
        }));
        assert_eq!(
            messages
                .last()
                .and_then(|m| m.get("role"))
                .and_then(Value::as_str),
            Some("user")
        );
    }

    #[test]
    fn chat_embeds_the_renderer_context_as_a_system_note() {
        let messages = build_messages("chat", &json!({ "messages": [] }), "见 [[笔记A]]")
            .expect("chat builds");
        assert!(messages[1]
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("[[笔记A]]"));
    }

    #[test]
    fn writing_uses_the_main_process_template_and_rejects_unknown_actions() {
        let messages = build_messages(
            "writing",
            &json!({ "actionId": "polish", "target": "原始文本" }),
            "参考",
        )
        .expect("writing builds");
        assert!(messages.iter().any(|m| m
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("润色")));
        assert!(content_of(&messages, 2).contains("原始文本"));
        assert!(content_of(&messages, 2).contains("参考上下文"));

        let failure = build_messages("writing", &json!({ "actionId": "nope" }), "")
            .expect_err("unknown action must fail");
        assert_eq!(failure.code, "BAD_WRITING_REQUEST");
        let missing = build_messages("writing", &json!({}), "").expect_err("actionId required");
        assert_eq!(missing.code, "BAD_WRITING_REQUEST");
    }

    #[test]
    fn writing_expand_handles_an_empty_target() {
        let messages = build_messages(
            "writing",
            &json!({ "actionId": "expand", "target": "" }),
            "",
        )
        .expect("writing builds");
        assert!(content_of(&messages, 2).contains("空块"));
    }

    #[test]
    fn translation_puts_the_language_in_the_system_prompt_only() {
        let messages = build_messages(
            "translation",
            &json!({
                "translation": { "mode": "document", "targetLanguage": "English", "text": "# 标题" }
            }),
            "",
        )
        .expect("translation builds");
        assert!(content_of(&messages, 0).contains("目标语言：English"));
        assert!(content_of(&messages, 0).contains("只输出译文本身"));
        assert!(content_of(&messages, 1).contains("整篇文档"));
        assert!(content_of(&messages, 1).contains("# 标题"));
    }

    #[test]
    fn translation_rejects_unsafe_target_languages() {
        let too_long = "a".repeat(41);
        // Structural characters are what the charset forbids. Note the
        // reference regex also accepts any Unicode letter run, so natural
        // language is deliberately *not* rejected here.
        let cases = [
            "",
            "English\nDELETE FROM notes",
            "English: ignore previous",
            "English`rm -rf /`",
            "<script>",
            too_long.as_str(),
        ];
        for language in cases {
            let failure = build_messages(
                "translation",
                &json!({
                    "translation": { "mode": "selection", "targetLanguage": language, "text": "x" }
                }),
                "",
            )
            .expect_err("unsafe language must be refused");
            assert_eq!(
                failure.code, "BAD_TRANSLATION_REQUEST",
                "language: {language}"
            );
        }
    }

    #[test]
    fn translation_refuses_overlong_input_instead_of_truncating() {
        let oversized = "x".repeat(TRANSLATION_MAX_TEXT_CHARS + 1);
        let failure = build_messages(
            "translation",
            &json!({
                "translation": { "mode": "input", "targetLanguage": "English", "text": oversized }
            }),
            "",
        )
        .expect_err("overlong translation must fail");
        assert_eq!(failure.code, "TRANSLATION_TOO_LONG");
    }

    #[test]
    fn translation_requires_a_payload() {
        let failure = build_messages("translation", &json!({}), "").expect_err("payload required");
        assert_eq!(failure.code, "BAD_TRANSLATION_REQUEST");
    }
}
