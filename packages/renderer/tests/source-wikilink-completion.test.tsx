// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  selectedCompletionIndex,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import {
  createWikilinkCompletionSource,
  sourceWikilinkCompletion,
  wikilinkInsertText,
  wikilinkQueryBefore,
  type WikilinkCompletionDeps,
} from '../src/editor/source/wikilink-completion';
import { createSourceEditor, type SourceEditorHandle } from '../src/editor/source/codemirror-host';
import type { SuggestionItem } from '@nexnote/kernel';

// 测试环境剥离：候选数据由注入的 getPages 提供，不触碰真实 vault / IPC。
const pages = [
  { path: '项目/计划.md', title: '计划' },
  { path: '项目/总结.md', title: '总结' },
  { path: '随笔.md', title: '随笔' },
];
const deps = (): WikilinkCompletionDeps & { onPick: ReturnType<typeof vi.fn> } => ({
  getPages: () => pages,
  onPick: vi.fn(),
});

describe('wikilinkQueryBefore（光标前触发串识别）', () => {
  it('`[[` 后的查询词为触发上下文', () => {
    expect(wikilinkQueryBefore('链接到[[')).toBe('');
    expect(wikilinkQueryBefore('链接到[[计')).toBe('计');
    expect(wikilinkQueryBefore('[[目标|别名')).toBe('目标|别名');
  });
  it('无触发串 / 已闭合返回 null；再次 `[[` 重新触发（与块编辑一致）', () => {
    expect(wikilinkQueryBefore('普通文本')).toBeNull();
    expect(wikilinkQueryBefore('[[已闭合]]后')).toBeNull();
    expect(wikilinkQueryBefore('[[半闭合]')).toBeNull();
    expect(wikilinkQueryBefore('[[a][[')).toBe('');
  });
});

describe('wikilinkInsertText（确认后写入源码的文本）', () => {
  it('无别名/锚点载荷时使用 id 并闭合 ]]', () => {
    expect(wikilinkInsertText({ id: '项目/计划', title: '计划' })).toBe('项目/计划]]');
  });
  it('携带别名语法 [[目标|别名]]', () => {
    const item: SuggestionItem = {
      id: '计划',
      title: '计划',
      insert: { target: '项目/计划', alias: '日程' },
    };
    expect(wikilinkInsertText(item)).toBe('项目/计划|日程]]');
  });
  it('携带锚点语法 [[目标#锚点]]', () => {
    const item: SuggestionItem = { id: '随笔', title: '随笔', insert: { target: '随笔#第二节' } };
    expect(wikilinkInsertText(item)).toBe('随笔#第二节]]');
  });
  it('红链以标题为创建目标', () => {
    const item: SuggestionItem = { id: '新页', title: '新页', meta: 'uncreated' };
    expect(wikilinkInsertText(item)).toBe('新页]]');
  });
});

describe('createWikilinkCompletionSource（补全源）', () => {
  const source = createWikilinkCompletionSource({ getPages: () => pages });
  const run = (doc: string, pos = doc.length): CompletionResult | null =>
    source({
      state: EditorState.create({ doc, selection: { anchor: pos } }),
      pos,
      explicit: false,
    } as unknown as CompletionContext);

  it('`[[` 立即弹出全部页面候选（无红链）', () => {
    const result = run('见 [[');
    expect(result).not.toBeNull();
    expect(result?.from).toBe('见 [['.length);
    const labels = (result?.options ?? []).map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(['计划', '总结', '随笔']));
    expect(result?.options.every((o) => o.detail !== '创建新页面')).toBe(true);
  });
  it('查询词模糊过滤已有页面（未精确命中时红链候选殿后）', () => {
    const result = run('见 [[计');
    expect(result?.from).toBe('见 [['.length);
    const labels = (result?.options ?? []).map((o) => o.label);
    expect(labels).toEqual(['计划', '计']);
    expect(result?.options[0]?.detail).not.toBe('创建新页面');
    expect(result?.options[1]?.detail).toBe('创建新页面');
  });
  it('未命中页面追加「创建新页面」红链候选', () => {
    const result = run('[[全新页');
    const uncreated = result?.options.find((o) => o.detail === '创建新页面');
    expect(uncreated?.label).toBe('全新页');
  });
  it('无触发串返回 null', () => {
    expect(run('无触发')).toBeNull();
    expect(run('[已闭合]]', 3)).toBeNull();
  });
});

const flush = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (predicate: () => boolean, timeout = 3000): Promise<void> => {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeout) await flush(40);
  expect(predicate()).toBe(true);
};
/**
 * 补全打开后等待 CM 的 interactionDelay（75ms）过去再按键：
 * 打开后立即 Enter/↑↓ 会被 CM 视为连击输入而忽略（真实用户打字间隔远大于此）。
 */
const settle = async (view: EditorView): Promise<void> => {
  await waitFor(() => completionStatus(view.state) === 'active');
  await flush(160);
};

function mount(initialText: string) {
  const context = deps();
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor: SourceEditorHandle = createSourceEditor(parent, {
    initialText,
    onChange: () => undefined,
    extraExtensions: [sourceWikilinkCompletion(context)],
  });
  // 初始光标移到文末，模拟用户从末尾续写
  editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
  const type = (insert: string) => {
    const view = editor.view;
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert },
      selection: { anchor: view.state.selection.main.head + insert.length },
      userEvent: 'input.type',
    });
  };
  const key = (key: string) => {
    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  };
  return { editor, context, type, key };
}

describe('源码模式 [[ 补全（真实 CodeMirror 装配）', () => {
  it('输入 `[[` 打开补全，输入过滤词后 Enter 插入双链语法', async () => {
    const { editor, type, key } = mount('# 页\n\n链接到');
    const view: EditorView = editor.view;
    type('[[');
    await settle(view);
    expect(currentCompletions(view.state).map((o) => o.label)).toContain('随笔');
    type('计划');
    await waitFor(() => currentCompletions(view.state).length === 1);
    await flush(160);
    key('Enter');
    expect(editor.getText()).toBe('# 页\n\n链接到[[项目/计划]]');
    editor.destroy();
  });
  it('↑↓ 键盘导航切换高亮候选，Esc 关闭且不改动文本', async () => {
    const { editor, type, key } = mount('正文 ');
    const view: EditorView = editor.view;
    type('[[随');
    await settle(view);
    key('Escape');
    expect(completionStatus(view.state)).toBeNull();
    expect(editor.getText()).toBe('正文 [[随');
    // Esc 后继续输入可重新激活（activateOnTyping）
    type('笔');
    await settle(view);
    const labels = currentCompletions(view.state).map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(['随笔']));
    key('Enter');
    expect(editor.getText()).toBe('正文 [[随笔]]');
    editor.destroy();
  });
  it('已输入 `|别名` 时确认生成别名语法；红链确认触发 onPick（红链创建）', async () => {
    const { editor, context, type, key } = mount('');
    type('参考 [[计划|日程');
    await settle(editor.view);
    key('Enter');
    expect(editor.getText()).toBe('参考 [[项目/计划|日程]]');

    type(' 见 [[全新页');
    await settle(editor.view);
    const uncreated = currentCompletions(editor.view.state).find((o) => o.detail === '创建新页面');
    expect(uncreated).toBeTruthy();
    await flush(160);
    acceptCompletion(editor.view, uncreated!);
    expect(editor.getText()).toBe('参考 [[项目/计划|日程]] 见 [[全新页]]');
    expect(context.onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: '全新页', meta: 'uncreated' }),
    );
    editor.destroy();
  });
  it('↑↓ 在候选间移动高亮并按 Enter 确认所选项', async () => {
    const { editor, type, key } = mount('');
    const view: EditorView = editor.view;
    type('[[');
    await settle(view);
    expect(currentCompletions(view.state).length).toBeGreaterThanOrEqual(3);
    // 打开即选中首项（selectOnOpen）；↑↓ 在候选间移动
    expect(selectedCompletionIndex(view.state)).toBe(0);
    key('ArrowDown');
    expect(selectedCompletionIndex(view.state)).toBe(1);
    key('ArrowUp');
    expect(selectedCompletionIndex(view.state)).toBe(0);
    key('Enter');
    const inserted = editor.getText().replace(/^\[\[/, '').replace(/\]\]$/, '');
    expect(['项目/计划', '项目/总结', '随笔']).toContain(inserted);
    expect(editor.getText()).toBe(`[[${inserted}]]`);
    editor.destroy();
  });
  it('非 [[ 上下文不弹出补全', async () => {
    const { editor, type } = mount('');
    type('普通 #输入 [ 单括号');
    await flush(200);
    expect(completionStatus(editor.view.state)).toBeNull();
    editor.destroy();
  });
});

describe('光标后已有闭合符时不重复插入 ]]', () => {
  it('显式补全确认会吞掉紧跟的 ]] 而非产生三连闭合', async () => {
    const { editor } = mount('写 [[计划]]');
    // 光标移到 query 末尾（`[[计划` 之后），显式触发补全（query 精确命中已有页，仅 1 项）
    editor.view.dispatch({ selection: { anchor: '写 [[计划'.length } });
    startCompletion(editor.view);
    await settle(editor.view);
    acceptCompletion(editor.view);
    expect(editor.getText()).toBe('写 [[项目/计划]]');
    editor.destroy();
  });
});
