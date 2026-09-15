import { describe, expect, it, vi } from 'vitest';
import { createBuiltinTools } from '../src/agent/builtin-tools';
import { ToolRegistry } from '../src/agent/tool-registry';

describe('DEV-040 document write tools', () => {
  it('replaces a unique selection and appends at document end', async () => {
    let text = 'before\nselected\nafter';
    const document = { read: vi.fn(async () => text), write: vi.fn(async (_path: string, next: string) => { text = next; }) };
    const registry = new ToolRegistry(createBuiltinTools({ retrieve: async () => ({ sources: [], degraded: false }), listPages: () => [], document }));
    await registry.execute('edit_current_selection', { path: 'note.md', expectedText: 'selected', content: 'updated' }, { runId: 'r', scenario: 'chat', permissionMode: 'full' });
    expect(text).toBe('before\nupdated\nafter');
    await registry.execute('append_to_document', { path: 'note.md', content: 'tail' }, { runId: 'r', scenario: 'chat', permissionMode: 'full' });
    expect(text).toBe('before\nupdated\nafter\ntail');
    expect(document.write).toHaveBeenCalledTimes(2);
  });

  it('uses the shared transaction seam for a single undo boundary', async () => {
    let text = 'before\nselected\nafter';
    const writeTransaction = vi.fn(async (writes: Array<{ path: string; content: string }>) => {
      text = writes[0]!.content;
    });
    const document = { read: vi.fn(async () => text), write: vi.fn(), writeTransaction };
    const registry = new ToolRegistry(createBuiltinTools({ retrieve: async () => ({ sources: [], degraded: false }), listPages: () => [], document }));
    await registry.execute('edit_current_selection', { path: 'note.md', expectedText: 'selected', content: 'updated' }, { runId: 'r', scenario: 'chat', permissionMode: 'full' });
    expect(text).toBe('before\nupdated\nafter');
    expect(writeTransaction).toHaveBeenCalledOnce();
    expect(document.write).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous selection without writing', async () => {
    const document = { read: vi.fn(async () => 'x selected x selected'), write: vi.fn() };
    const registry = new ToolRegistry(createBuiltinTools({ retrieve: async () => ({ sources: [], degraded: false }), listPages: () => [], document }));
    await expect(registry.execute('edit_current_selection', { path: 'note.md', expectedText: 'selected', content: 'new' }, { runId: 'r', scenario: 'chat', permissionMode: 'full' })).rejects.toMatchObject({ code: 'STALE_SELECTION' });
    expect(document.write).not.toHaveBeenCalled();
  });
});
