// @vitest-environment happy-dom
//
// ADR-0023 阶段②已迁移模块契约（第一批 + 第二批）。
//
// 原则：只断言真实迁移到消息目录的界面，不把未迁移区域（命令条目、
// 面板内部、AI 提示词）误计入。真实渲染、真实 store → bootstrap effect 链路。
//
// 完成门槛是「切到 en-US 后全 UI 无中文残留」；本测试只锁定已迁移部分，
// 不代表整体门槛（票据已诚实登记未完成模块）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultGlobalSettings, type VaultInfo } from '@nexnote/shared';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/ipc', () => ({ invoke, onEvent: () => () => {} }));

// 装配真实功能模块（注册表登记）。含未迁移模块，所以断言只取已迁移子树。
import '../src/features/bootstrap';
import { WelcomePage } from '../src/pages/WelcomePage';
import { OnboardingWizard } from '../src/onboarding/OnboardingWizard';
import { Sidebar } from '../src/shell/Sidebar';
import { DockHost } from '../src/shell/DockHost';
import { StatusBar } from '../src/shell/StatusBar';
import { CommandPalette } from '../src/palette/CommandPalette';
import { VaultContext } from '../src/shell/vault-context';
import { useSettingsStore } from '../src/stores/settings-store';
import { useSettingsNav } from '../src/lib/open-settings';
import { usePaletteStore } from '../src/stores/palette-store';
import { useUiStore } from '../src/stores/ui-store';
import { useIndexStore } from '../src/stores/index-store';
import { setLanguage } from '../src/lib/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vault: VaultInfo = {
  root: '/tmp/i18n-vault',
  name: 'i18n-vault',
  configPath: '/tmp/i18n-vault/.nexnote/config.json',
};

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  const global = defaultGlobalSettings();
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'settings:getAll') return global;
    if (channel === 'app:getInfo')
      return { version: '0.0.34', platform: 'test', arch: 'arm64', electronVersion: '44.0.0' };
    if (channel === 'index:status')
      return { phase: 'ready', pagesIndexed: 3, pagesTotal: 3, mode: 'full' };
    return null;
  });
  useSettingsStore.setState({ global: null, vault: null, loading: false, error: null });
  useSettingsNav.setState({ activeId: 'general' });
  useUiStore.setState({
    sidebarWidth: 260,
    sidebarCollapsed: false,
    activeSidebarPanelId: 'pages',
    dockVisible: false,
    dockWidth: 320,
    activeDockPanelId: null,
    treeCollapsedDirs: [],
    treeShowAllFiles: false,
    treeShowExtensions: false,
    guideCompleted: false,
    tourOpen: false,
    searchOpen: false,
    searchRoute: { kind: 'fulltext' },
    jumpResults: [],
  });
  useIndexStore.getState().reset();
  setLanguage('en-US');
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

async function render(node: React.ReactNode): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(node);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ADR-0023 阶段②：已迁移模块真实渲染为 en-US', () => {
  it('欢迎页：标题/按钮/亮点/能力行全部为英文', async () => {
    await render(
      <VaultContext.Provider value={vault}>
        <WelcomePage />
      </VaultContext.Provider>,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Your local knowledge base');
    expect(text).toContain('Getting started');
    expect(text).toContain('Command palette');
    expect(text).toContain('Switch freely between source, split, and preview');
    // 欢迎页不含语言列表，可直接做整页 CJK 扫描
    expect(text).not.toMatch(/[一-鿿]/);
  });

  it('首启动向导：标题/三个选项/最近区/创建步骤为英文', async () => {
    await render(<OnboardingWizard recent={[]} onRecentsChanged={() => {}} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Welcome to NexNote');
    expect(text).toContain('New knowledge base');
    expect(text).toContain('Open a local folder');
    expect(text).toContain('Clone a remote repository');
    expect(text).not.toMatch(/[一-鿿]/);
  });

  it('侧栏框架：折叠/设置/切换入口与内置面板的标签为英文（titleIsKey 真实链路）', async () => {
    await render(
      <VaultContext.Provider value={vault}>
        <Sidebar />
      </VaultContext.Provider>,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Pages');
    expect(text).toContain('Settings');
    expect(text).toContain('Switch knowledge base');
    // 四个内置侧栏面板标签都在注册表里，逐个核验 titleIsKey → 成文
    for (const label of ['Pages', 'Linked Mentions', 'Tags', 'Graph'])
      expect(text).toContain(label);
    // 侧栏框架自身（按钮/底栏）无中文；面板内部内容不在本断言
    expect(
      container.querySelector('[data-testid="app-sidebar"] > .border-b, [data-tour="settings"]')
        ?.textContent,
    ).toBeTruthy();
    expect(
      container.querySelector('[data-tour="settings"]')?.closest('div')?.textContent,
    ).not.toMatch(/[一-鿿]/);
  });

  it('命令面板：骨架与全部命令条目在 en-US 下成文（含空态）', async () => {
    usePaletteStore.setState({ open: true });
    await render(<CommandPalette />);
    const palette = container.querySelector('[data-testid="command-palette"]');
    expect(palette).not.toBeNull();
    expect(
      container.querySelector('[data-testid="palette-input"]')?.getAttribute('placeholder'),
    ).toBe('Search commands…');
    expect(container.textContent).toContain('select');

    // 输入一个无匹配的查询词，让空态出现（空态文案属已迁移骨架）
    const input = container.querySelector<HTMLInputElement>('[data-testid="palette-input"]');
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'zzz-no-such-command');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain('No matching commands');
    // 切回空查询：命令列表全部展示，条目已随消息目录成文，整面板无中文残留
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const paletteText = palette.textContent ?? '';
    // 命令标题/分类/骨架全部成文；key 不出现在渲染文本中
    expect(paletteText).not.toContain('command.');
    expect(paletteText).not.toMatch(/[一-鿿]/);
  });

  it('状态栏：主题切换条目在 en-US 下成文（状态）', async () => {
    await render(
      <VaultContext.Provider value={vault}>
        <StatusBar />
      </VaultContext.Provider>,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Light'); // 主题切换标签（默认非 dark → Light）
    // 状态栏右区主题/版本条目无中文
    const right = container.querySelector('.ml-auto');
    expect(right?.textContent).not.toMatch(/[一-鿿]/);
  });

  it('右侧 Dock 框架消费 titleIsKey（折叠/空态成文）', async () => {
    useUiStore.setState({
      dockVisible: true,
      activeDockPanelId: 'ai-chat',
    });
    await render(
      <VaultContext.Provider value={vault}>
        <DockHost />
      </VaultContext.Provider>,
    );
    const text = container.textContent ?? '';
    // DockHost 头部标题来自 dockPanelRegistry 的 titleIsKey → 消息目录
    expect(text).toContain('AI chat');
    expect(container.querySelector('[data-testid="right-dock"] > div')?.textContent).not.toMatch(
      /[一-鿿]/,
    );
  });
});
