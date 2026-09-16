import {
  MERMAID_FLOWCHART_SOURCE,
  MERMAID_GANTT_SOURCE,
  MERMAID_LANGUAGE,
  TABLE_OF_CONTENTS_MARKER,
} from '@nexnote/kernel';

/** 源码与块模式一致的 2×2 表格（两列、含表头共两行）。 */
export const MARKDOWN_TABLE_SNIPPET = ['| 列 1 | 列 2 |', '| --- | --- |', '|  |  |'].join('\n');

/** 直接复用 kernel 协议与模板，避免源码/块模式字面量漂移。 */
export { MERMAID_FLOWCHART_SOURCE, MERMAID_GANTT_SOURCE, TABLE_OF_CONTENTS_MARKER };

export function mermaidFence(source: string): string {
  return `\`\`\`${MERMAID_LANGUAGE}\n${source}\n\`\`\``;
}
