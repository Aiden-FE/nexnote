// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SuggestionItem } from '@nexnote/kernel';
import { currentPageCandidates, createRedlinkPage } from '../src/editor/wikilink-page-ops';
import { useIndexStore } from '../src/stores/index-store';
import { usePageTreeStore } from '../src/stores/page-tree-store';

type BridgeResult =
  { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

function installBridge(invoke: (channel: string, payload?: unknown) => Promise<BridgeResult>) {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload });
      return invoke(channel, payload);
    }),
    on: () => () => undefined,
  };
  return calls;
}

beforeEach(() => {
  useIndexStore.getState().reset();
  usePageTreeStore.setState({ entries: [] });
});

describe('currentPageCandidates（块编辑与源码补全共用的页面候选）', () => {
  it('聚合页面树 .md 文件与索引别名，过滤目录', () => {
    usePageTreeStore.setState({
      entries: [
        { name: '计划.md', path: '项目/计划.md', kind: 'file' },
        { name: '随笔.md', path: '随笔.md', kind: 'file' },
        { name: '项目', path: '项目', kind: 'directory' },
        { name: '图片.png', path: '图片.png', kind: 'file' },
      ],
    });
    useIndexStore.setState({
      pageSummaries: { '项目/计划.md': { path: '项目/计划.md', title: '计划', aliases: ['日程'] } },
    });
    expect(currentPageCandidates()).toEqual([
      { path: '项目/计划.md', title: '计划', aliases: ['日程'] },
      { path: '随笔.md', title: '随笔', aliases: [] },
    ]);
  });
});

describe('createRedlinkPage（红链创建，落盘但不覆盖既有文件）', () => {
  it('uncreated 候选逐段清洗路径并原子创建初始页', () => {
    const calls = installBridge(async () => ({
      ok: true,
      data: { file: null, created: true },
    }));
    const item: SuggestionItem = {
      id: '我的 folder/新页',
      title: '新页',
      meta: 'uncreated',
      insert: { target: '我的 folder/新页', alias: '备注' },
    };
    createRedlinkPage(item);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      channel: 'fs:createTextFile',
      payload: { path: '我的 folder/新页.md', content: '# 新页\n\n', createParentDirs: true },
    });
  });

  it('非 uncreated 候选不触发创建', () => {
    const calls = installBridge(async () => ({ ok: true, data: null }));
    createRedlinkPage({ id: '项目/计划', title: '计划' });
    expect(calls).toHaveLength(0);
  });

  it('创建失败不抛出（链接仍指向未来页面），错误进 console.error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installBridge(async () => ({ ok: false, error: { code: 'EACCES', message: 'denied' } }));
    expect(() => createRedlinkPage({ id: '新页', title: '新页', meta: 'uncreated' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
