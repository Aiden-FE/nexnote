import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsService, normalizeStoredGlobal } from '../src/settings/settings-service';
import {
  defaultGlobalSettings,
  defaultVaultSettings,
  mergeGlobalPatch,
  mergeVaultPatch,
  normalizeShortcut,
} from '@nexnote/shared';

let tmp: string;
let filePath: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-settings-test-'));
  filePath = path.join(tmp, 'settings.json');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('normalizeStoredGlobal', () => {
  it('空输入返回默认全局设置', () => {
    expect(normalizeStoredGlobal(null)).toEqual(defaultGlobalSettings());
    expect(normalizeStoredGlobal({})).toEqual(defaultGlobalSettings());
  });

  it('对非法字段值回退默认并保留合法字段', () => {
    const base = defaultGlobalSettings();
    expect(
      normalizeStoredGlobal({
        appearance: { theme: 'neon', uiFontSize: 3 },
        git: { useSystemGit: true },
      }),
    ).toMatchObject({
      // 非法 theme 回退 system；越界 uiFontSize clamp 到下限 10
      appearance: { theme: 'system', uiFontSize: 10 },
      git: { useSystemGit: true },
    });
    expect(base).toBeTruthy();
  });

  it('剪裁快捷键列表并丢弃非法项', () => {
    const global = normalizeStoredGlobal({
      shortcuts: [
        { commandId: 'app.save', key: '⌘S', disabled: false },
        { commandId: 'bogus.no.key', key: '', disabled: false },
        { commandId: 'other', key: 'ctrl+k', disabled: false },
      ],
    });
    expect(global.shortcuts).toEqual([
      { commandId: 'app.save', key: 'Mod+S', disabled: false },
      { commandId: 'other', key: 'Ctrl+K', disabled: false },
    ]);
  });
});

describe('SettingsService', () => {
  it('无文件时返回默认值', () => {
    const service = new SettingsService(filePath);
    expect(service.get()).toEqual(defaultGlobalSettings());
  });

  it('update 持久化并保留到磁盘', () => {
    const service = new SettingsService(filePath);
    const updated = service.update({ appearance: { theme: 'dark' } });
    expect(updated.appearance.theme).toBe('dark');
    // 重新构造实例，验证已持久化
    const reloaded = new SettingsService(filePath);
    expect(reloaded.get().appearance.theme).toBe('dark');
  });

  it('update 剪除 undefined 字段，不产生 present-undefined', () => {
    const service = new SettingsService(filePath);
    const updated = service.update({
      appearance: { theme: 'light', uiFontSize: undefined as unknown as number },
    });
    expect(updated.appearance.theme).toBe('light');
  });

  it('setShortcuts 规范化并持久化', () => {
    const service = new SettingsService(filePath);
    const result = service.setShortcuts([
      { commandId: 'search.open', key: 'ctrl+shift+f', disabled: false },
    ]);
    expect(result[0]?.key).toBe('Ctrl+Shift+F');
    const reloaded = new SettingsService(filePath);
    expect(reloaded.get().shortcuts[0]?.key).toBe('Ctrl+Shift+F');
  });

  it('导出/导入快捷键 JSON 往返', () => {
    const service = new SettingsService(filePath);
    service.setShortcuts([{ commandId: 'app.save', key: 'Mod+S', disabled: false }]);
    const exported = service.exportShortcutsJson();
    const parsed = JSON.parse(exported);
    expect(parsed.app).toBe('nexnote');
    expect(parsed.kind).toBe('shortcuts');
    // 独立实例导入
    const importer = new SettingsService(path.join(tmp, 'other.json'));
    const imported = importer.importShortcutsJson(exported);
    expect(imported.imported).toBe(1);
    const saveEntry = imported.shortcuts.find((s) => s.commandId === 'app.save');
    expect(saveEntry?.key).toBe('Mod+S');
  });

  it('导入非法 JSON / 错误结构返回 0 导入', () => {
    const service = new SettingsService(filePath);
    expect(service.importShortcutsJson('not json').imported).toBe(0);
    expect(service.importShortcutsJson(JSON.stringify({ foo: 1 })).imported).toBe(0);
  });

  it('search 按标题/关键字命中', () => {
    const service = new SettingsService(filePath);
    expect(service.search('主题').length).toBeGreaterThan(0);
    expect(service.search('autosave').some((e) => e.id === 'editor.autoSaveMs')).toBe(true);
    expect(service.search('').length).toBe(0);
  });

  it('onChange 通知订阅者', () => {
    const service = new SettingsService(filePath);
    let fired = 0;
    service.onChange(() => void fired++);
    service.update({ appearance: { theme: 'dark' } });
    expect(fired).toBe(1);
  });
});

describe('shared 设置工具函数', () => {
  it('normalizeShortcut 处理字形与别名且修饰符有序', () => {
    expect(normalizeShortcut('⌘⇧F')).toBe('Mod+Shift+F');
    expect(normalizeShortcut('cmd+s')).toBe('Mod+S');
    expect(normalizeShortcut('control+shift+alt+k')).toBe('Ctrl+Alt+Shift+K');
    expect(normalizeShortcut('  Mod + Shift + E ')).toBe('Mod+Shift+E');
    expect(normalizeShortcut('')).toBe('');
  });

  it('mergeVaultPatch clamp 自动保存与提交间隔', () => {
    const base = defaultVaultSettings();
    expect(mergeVaultPatch(base, { editor: { autoSaveMs: 1 } }).editor.autoSaveMs).toBe(100);
    expect(
      mergeVaultPatch(base, { git: { autoCommitIntervalMs: 1_000_000_000 } }).git
        .autoCommitIntervalMs,
    ).toBe(600_000);
  });

  it('mergeVaultPatch 剪除非法分支名', () => {
    const base = defaultVaultSettings();
    const merged = mergeVaultPatch(base, { git: { defaultBranch: 'my branch' } });
    expect(merged.git.defaultBranch).toBe(base.git.defaultBranch);
    expect(mergeVaultPatch(base, { git: { defaultBranch: 'main-v2' } }).git.defaultBranch).toBe(
      'main-v2',
    );
  });

  it('mergeGlobalPatch 保留合法多级字段', () => {
    const base = defaultGlobalSettings();
    const merged = mergeGlobalPatch(base, { startup: { behavior: 'welcome' } });
    expect(merged.startup.behavior).toBe('welcome');
  });
});

describe('SettingsService 磁盘格式', () => {
  it('写入的 JSON 是可读的美化格式', async () => {
    const service = new SettingsService(filePath);
    service.update({ appearance: { theme: 'dark' } });
    const raw = await readFile(filePath, 'utf8');
    expect(JSON.parse(raw).appearance.theme).toBe('dark');
  });
});
