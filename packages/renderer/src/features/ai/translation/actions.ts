/**
 * 临时翻译动作 id（DEV-041）。
 *
 * 与划词 AI 下拉/工具栏动作表共用同一命名空间：
 * - selection：划词翻译，结果在选区旁只读浮层展示
 * - document：全文翻译，打开临时只读视图
 * 两者都没有写回路径——渲染层不存在把译文写进文档的动作。
 */
export const TRANSLATE_SELECTION_ACTION_ID = 'translate:selection';
export const TRANSLATE_DOCUMENT_ID = 'translate:document';
export const OPEN_TRANSLATION_WORKBENCH_ID = 'translate:workbench';
