// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocxView } from '../src/pages/DocxView';
import type { DocxEditDocument } from '@nexnote/shared';
import type { TabDescriptor } from '../src/stores/tab-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Renderer/IPC 集成测试：模拟 docx:openEdit / docx:save 的 structured-clone 语义——
 * 主进程对入参 document 的任何突变都不会回传 renderer；renderer 必须用
 * docx:save 响应中的刷新模型替换本地 loaded.document，否则同一 UI 会话内
 * 连续保存不同段落会丢前次编辑。
 */

const BASE_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p><w:p><w:r><w:t>第三段</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格单元格</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';

/** 真实 open/serialize 逻辑由主进程测试覆盖；这里模拟其 IPC 可观察行为。 */
function documentFor(xml: string): DocxEditDocument {
  const blocks: DocxEditDocument['blocks'] = [];
  for (const m of xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)) {
    blocks.push({
      type: 'table',
      text: [...m[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => t[1] ?? '').join(' '),
      originalXml: m[0],
    });
  }
  for (const m of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    if (xml.slice(xml.indexOf(m[0]), xml.indexOf(m[0]) + m[0].length).includes('<w:tbl')) continue;
    const fragment = m[0];
    if (/<w:tbl/.test(xml.slice(0, m.index ?? 0).slice(-fragment.length))) continue;
    blocks.push({
      text: [...fragment.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((t) => t[1] ?? '')
        .join(''),
      runs: [],
      heading: null,
      list: false,
      editable: !fragment.includes('<w:drawing'),
      originalXml: fragment,
    });
  }
  // 按文档顺序重排（上面分别收集了段落与表格）。
  const ordered: DocxEditDocument['blocks'] = [];
  const positions: Array<{ index: number; block: DocxEditDocument['blocks'][number] }> = [];
  for (const block of blocks) positions.push({ index: xml.indexOf(block.originalXml), block });
  positions.sort((a, b) => a.index - b.index);
  for (const { block } of positions) ordered.push(block);
  return { blocks: ordered, unsupportedCount: 0, originalXml: xml };
}

function replaceParagraphXml(xml: string, originalXml: string, text: string): string {
  const replacement = originalXml.replace(
    /<w:t\b[^>]*>[\s\S]*?<\/w:t>/,
    () => `<w:t>${text}</w:t>`,
  );
  return xml.replace(originalXml, replacement);
}

function paragraphBlocks(document: DocxEditDocument) {
  return document.blocks.filter((b) => b.type !== 'table');
}

type Handler = (payload: Record<string, unknown>) => unknown;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let savedDocuments: DocxEditDocument[] = [];

function installBridge(handlers: Record<string, Handler>): void {
  (
    window as unknown as {
      nexnote: {
        invoke(channel: string, payload: Record<string, unknown>): Promise<unknown>;
        on(): () => void;
      };
    }
  ).nexnote = {
    async invoke(channel, payload) {
      const handler = handlers[channel];
      if (!handler) throw new Error(`unexpected IPC channel: ${channel}`);
      const data = handler(payload);
      return { ok: true, data };
    },
    on() {
      return () => undefined;
    },
  };
}

async function mountDocxView(pagePath: string): Promise<void> {
  const tab = {
    id: 'tab-1',
    kind: 'docx',
    title: 'a.docx',
    pagePath,
    createdAt: 0,
  } as TabDescriptor;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<DocxView tab={tab} />);
  });
}

function paragraphTextarea(index: number): HTMLTextAreaElement {
  const el = document.querySelector(`[data-testid="docx-paragraph-${index}"]`);
  if (!(el instanceof HTMLTextAreaElement)) throw new Error(`paragraph ${index} not mounted`);
  return el;
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new Error('textarea value setter unavailable');
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickSave(): void {
  const save = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('保存'),
  );
  if (!save) throw new Error('save button not found');
  save.dispatchEvent(new Event('click', { bubbles: true }));
}

/** 主进程 docx:save 的最小模拟：刷新模型随响应返回。 */
function saveHandler(payload: Record<string, unknown>): {
  document: DocxEditDocument;
  sha256: string;
} {
  const document = structuredClone(payload.document as DocxEditDocument);
  const expected = payload.expectedSha256 as string;
  if (expected !== currentXml) throw new Error('sha mismatch');
  let xml = document.originalXml;
  let changed = false;
  for (const block of document.blocks) {
    if (block.type === 'table') continue;
    if (block.modified) {
      xml = replaceParagraphXml(xml, block.originalXml, block.text);
      changed = true;
    }
  }
  if (!changed) return { document: documentFor(document.originalXml), sha256: currentXml };
  currentXml = xml;
  // 主进程语义：响应携带基于保存后 XML 重建的刷新模型（modified 全部清除）。
  return { document: documentFor(xml), sha256: xml };
}

let currentXml = '';

beforeEach(() => {
  savedDocuments = [];
  currentXml = BASE_XML;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

describe('DocxView renderer/IPC 连续保存', () => {
  it('连续保存不同段落：用响应刷新模型后前次编辑不丢失', async () => {
    installBridge({
      'docx:openEdit': () => ({ document: documentFor(currentXml), sha256: currentXml }),
      'docx:save': (payload) => {
        const result = saveHandler(payload);
        savedDocuments.push(structuredClone(result.document));
        return result;
      },
    });
    await mountDocxView('a.docx');

    // 第一次：编辑段落 1 并保存。
    await act(async () => {
      setTextareaValue(paragraphTextarea(1), '第一次保存的段落');
    });
    await act(async () => {
      clickSave();
    });
    await act(async () => {});
    expect(paragraphTextarea(1).value).toBe('第一次保存的段落');
    expect(savedDocuments).toHaveLength(1);
    expect(paragraphBlocks(savedDocuments[0]!)[1]!.text).toBe('第一次保存的段落');
    expect(paragraphBlocks(savedDocuments[0]!)[1]!.modified).toBeUndefined();

    // 第二次：不重载页面，编辑另一段并保存。
    await act(async () => {
      setTextareaValue(paragraphTextarea(2), '第二次保存的段落');
    });
    await act(async () => {
      clickSave();
    });
    await act(async () => {});
    expect(currentXml).toContain('<w:t>第一次保存的段落</w:t>');
    expect(currentXml).toContain('<w:t>第二次保存的段落</w:t>');
    expect(paragraphTextarea(1).value).toBe('第一次保存的段落');
    expect(paragraphTextarea(2).value).toBe('第二次保存的段落');
  });

  it('表格以只读形式呈现，且保存不改变表格 XML', async () => {
    installBridge({
      'docx:openEdit': () => ({ document: documentFor(currentXml), sha256: currentXml }),
      'docx:save': (payload) => saveHandler(payload),
    });
    await mountDocxView('a.docx');

    const table = document.querySelector('[data-testid^="docx-table-"]');
    expect(table).not.toBeNull();
    expect(table!.getAttribute('aria-readonly')).toBe('true');
    expect(table!.textContent).toContain('表格单元格');
    // 表格区域内不含任何输入控件。
    expect(table!.querySelector('textarea, input, [contenteditable]')).toBeNull();

    await act(async () => {
      setTextareaValue(paragraphTextarea(0), '表格前的段落改动');
    });
    await act(async () => {
      clickSave();
    });
    await act(async () => {});
    expect(currentXml).toContain(
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格单元格</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    );
    expect(currentXml).toContain('<w:t>表格前的段落改动</w:t>');
  });
});
