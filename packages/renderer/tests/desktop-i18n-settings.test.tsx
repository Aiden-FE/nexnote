// @vitest-environment happy-dom
//
// ADR-0023 接缝测试：
// 设置里的「语言」不再只是改 `<html lang>`，而是真的驱动消息目录 ——
// 切到 English 后设置面板的分区标题与行标签全部变为英文。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultGlobalSettings, type GlobalSettings } from '@nexnote/shared';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/ipc', () => ({ invoke, onEvent: () => () => {} }));

import '../src/features/settings';
import { GeneralSection } from '../src/features/settings';
import { SettingsPage } from '../src/pages/SettingsPage';
import { useSettingsNav } from '../src/lib/open-settings';
import { useSettingsStore } from '../src/stores/settings-store';
import { setLanguage } from '../src/lib/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;
let global: GlobalSettings;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  global = defaultGlobalSettings();
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'settings:getAll') return global;
    if (channel === 'app:getInfo') return { version: '0.0.34' };
    return null;
  });
  useSettingsStore.setState({ global: null, vault: null, loading: false, error: null });
  useSettingsNav.setState({ activeId: 'general' });
  setLanguage('zh-CN');
  act(() => {
    root = createRoot(container);
    root.render(<GeneralSection />);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderPage(node: React.ReactNode): Promise<void> {
  act(() => {
    root?.unmount();
    root = createRoot(container);
    root.render(node);
  });
  await flush();
}

describe('桌面端界面双语（ADR-0023）', () => {
  it('中文界面显示中文文案', async () => {
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('外观');
    expect(text).toContain('主题');
    expect(text).toContain('帮助');
    expect(text).toContain('打开产品文档');
  });

  it('切到 en-US 后设置面板无中文残留（完成门槛的局部验证）', async () => {
    await flush();
    await act(async () => {
      setLanguage('en-US');
      useSettingsStore.setState({ global });
    });
    await flush();

    const text = container.textContent ?? '';
    expect(text).toContain('Appearance');
    expect(text).toContain('Theme');
    expect(text).toContain('Help');
    expect(text).toContain('Open docs');

    // 翻译目标语言列表是语言名称数据（简体中文 / 繁體中文 / 日本語 / 한국어 …），
    // 属知识数据而非界面文案，按 ADR-0023 既定边界不翻译。
    const languageNames = [
      '简体中文',
      '繁體中文',
      '日本語',
      '한국어',
      'English',
      'Français',
      'Deutsch',
      'Español',
      'Русский',
    ];
    let stripped = text;
    for (const name of languageNames) stripped = stripped.replaceAll(name, '');
    expect(stripped).not.toMatch(/[一-鿿]/);
  });
});

describe('设置页整体（分区导航与页面标题）', () => {
  it('中文界面显示中文分区标题', async () => {
    await renderPage(<SettingsPage />);
    const nav = container.querySelector('[data-testid="settings-nav"]');
    const text = nav?.textContent ?? '';
    expect(text).toContain('常规');
    expect(text).toContain('编辑器');
    expect(text).toContain('快捷键');
    expect(text).toContain('关于');
  });

  it('切到 en-US 后分区导航与页面标题全部为英文', async () => {
    await renderPage(<SettingsPage />);
    await act(async () => {
      setLanguage('en-US');
    });
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('General');
    expect(text).toContain('Editor');
    expect(text).toContain('Shortcuts');
    expect(text).toContain('About');
    expect(text).toContain('Settings');
    const languageNames = [
      '简体中文',
      '繁體中文',
      '日本語',
      '한국어',
      'English',
      'Français',
      'Deutsch',
      'Español',
      'Русский',
    ];
    let stripped = text;
    for (const name of languageNames) stripped = stripped.replaceAll(name, '');
    expect(stripped).not.toMatch(/[一-鿿]/);
  });
});
