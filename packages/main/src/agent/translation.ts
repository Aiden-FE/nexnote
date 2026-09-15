import type { AgentTranslationRequest, ChatMessage, ChatParams } from '@nexnote/shared';

/**
 * 临时翻译（DEV-041）主进程侧定义：prompt 模板在此持有，渲染层只提供原文与目标语言。
 *
 * - reasoning 固定关闭：{@link withTranslationParams} 覆盖任何请求级/Profile 级 reasoning 设置，
 *   渲染层无法为翻译打开 reasoning（请求层不变量，非界面约定）。
 * - 目标语言只进 system prompt：字符集与长度受 {@link TARGET_LANGUAGE_PATTERN} 限制，
 *   缩小 prompt 注入面。
 */

/** 供应商无关的「关闭 reasoning」取值（适配层翻译为 provider 参数）。 */
export const TRANSLATION_REASONING_EFFORT = 'none';

/** 目标语言白名单字符集：字母/数字/空格/括号与常见连接符，最长 40 字符。 */
export const TARGET_LANGUAGE_PATTERN = /^[\p{L}\p{N} ()·\-+]{1,40}$/u;

/** 翻译原文长度上限（IPC 边界护栏，避免无界 payload）。 */
export const TRANSLATION_MAX_TEXT_CHARS = 200_000;

const TRANSLATION_BASE =
  '你是 NexNote 内置翻译助手。' +
  '把用户提供的文本完整翻译成目标语言，只输出译文本身，不要任何解释、前后缀或代码围栏。' +
  '保持 Markdown 结构（标题、列表、表格、代码块）以及其中的 [[双链]]、#tag 与 ^id 块锚点语法。';

/** translation 场景的 system 基础提示（场景 profile 与消息组装共用）。 */
export const TRANSLATION_SYSTEM_PROMPT = TRANSLATION_BASE;

/** 组装翻译消息：目标语言进 system，原文进 user。 */
export function buildTranslationMessages(translation: AgentTranslationRequest): ChatMessage[] {
  const scope = translation.mode === 'document' ? '整篇文档' : '选中片段';
  return [
    { role: 'system', content: `${TRANSLATION_BASE}\n目标语言：${translation.targetLanguage}。` },
    { role: 'user', content: `请翻译下面的${scope}（Markdown 原文）：\n\n${translation.text}` },
  ];
}

/**
 * 翻译请求参数：强制关闭 reasoning，其余参数保留。
 * 返回新对象，绝不修改调用方传引用。
 */
export function withTranslationParams(params: ChatParams | undefined): ChatParams {
  return { ...params, reasoningEffort: TRANSLATION_REASONING_EFFORT };
}
