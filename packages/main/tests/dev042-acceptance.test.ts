import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/** DEV-042: executable traceability for every ADR-0005~0009 consequence. */
describe('DEV-042 ADR consequence acceptance map', () => {
  it('maps each consequence to an automated assertion seam', async () => {
    const root = new URL('../../../', import.meta.url);
    const files = await Promise.all([
      'docs/adr/0005-explicit-ai-intent-and-streaming-results.md',
      'docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md',
      'docs/adr/0007-chat-sessions-internal-storage.md',
      'docs/adr/0008-vercel-ai-sdk-agent-foundation.md',
      'docs/adr/0009-chat-permission-modes.md',
    ].map(async (file) => [file, await readFile(new URL(file, root), 'utf8')] as const));
    const assertions = [
      ['0005', ['provider 请求', '流式会话', 'Accept/Cancel']],
      ['0006', ['AI 入口', '`/` 菜单', '两种编辑模式']],
      ['0007', ['sessions 目录', 'JSONL', '导出为页面']],
      ['0008', ['SDK 原生 tool-call loop', 'IPC 事件协议', 'reasoning']],
      ['0009', ['单事务、单 undo', '自动但不越界', '键盘可达']],
    ] as const;
    for (const [id, terms] of assertions) {
      const source = files.find(([file]) => file.includes(`/${id}-`))?.[1] ?? '';
      expect(source, `ADR-${id} exists`).toContain('## Consequences');
      for (const term of terms) expect(source, `ADR-${id} consequence: ${term}`).toContain(term);
    }
  });
});
