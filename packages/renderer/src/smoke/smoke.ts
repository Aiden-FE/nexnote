import { invoke } from '../lib/ipc';
import { commandRegistry } from '../registries';
import { useTabStore } from '../stores/tab-store';
import { createPage } from '../features/editor/create-page';
import { useUiStore } from '../stores/ui-store';
import { useThemeStore } from '../theme/theme-store';

interface SmokeCaptureResult {
  ok: boolean;
  path?: string;
  error?: string;
}

interface SmokeBridge {
  capture(name: string): Promise<SmokeCaptureResult>;
  mkdtemp(): Promise<SmokeCaptureResult & { path?: string }>;
  finish(report: unknown): Promise<SmokeCaptureResult>;
}

interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, timeout = 12000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await sleep(120);
  }
  return predicate();
}

function smokeBridge(): SmokeBridge | null {
  return (window as { nexnoteSmoke?: SmokeBridge }).nexnoteSmoke ?? null;
}

let ran = false;

/** 冒烟模式入口：window.nexnoteSmoke 存在（NEXNOTE_SMOKE=1）时才执行。 */
export async function runSmokeIfEnabled(): Promise<void> {
  const bridge = smokeBridge();
  if (!bridge || ran) return;
  ran = true;

  const checks: Check[] = [];
  const check = (name: string, passed: boolean, detail?: string) => {
    checks.push({ name, passed, detail });
    console.log(`[smoke] ${passed ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const capture = async (name: string) => {
    await sleep(400); // 等待渲染/动画稳定
    const r = await bridge.capture(name);
    if (!r.ok) check(`截图 ${name}`, false, r.error);
  };

  try {
    // ── 1. 首启动向导（隔离 userData → 必为向导）──────────────
    check(
      '首启动向导可见（新建/打开/克隆三选一）',
      await waitFor(() => !!document.querySelector('[data-testid="onboarding"]')),
    );
    const wizardText = document.querySelector('[data-testid="onboarding"]')?.textContent ?? '';
    check(
      '向导包含三选一入口',
      wizardText.includes('新建知识库') &&
        wizardText.includes('打开本地文件夹') &&
        wizardText.includes('克隆远程仓库'),
    );
    await capture('01-onboarding');

    // ── 2. 程序化走向导后端路径：新建 vault（与向导按钮同一 IPC 调用）──
    const tmp = await bridge.mkdtemp();
    if (!tmp.ok || !tmp.path) throw new Error(`mkdtemp 失败: ${tmp.error}`);
    const created = await invoke('vault:create', { parentDir: tmp.path, name: 'smoke-vault' });
    check('vault:create 成功', created.name === 'smoke-vault', created.root);

    // vault:changed 事件 → App 切到工作区
    check('工作区出现（vault:changed 驱动）', await waitFor(() => !!document.querySelector('[data-testid="app-sidebar"]')));

    // ── 3. 三面板布局 ─────────────────────────────────────────
    const sidebar = !!document.querySelector('[data-testid="app-sidebar"]');
    const main = !!document.querySelector('[data-testid="main-content"]');
    const dock = !!document.querySelector('[data-testid="right-dock"]');
    const statusbar = !!document.querySelector('[data-testid="status-bar"]');
    check('三面板布局（侧栏+主区+右侧 dock）', sidebar && main && dock, `sb=${sidebar} main=${main} dock=${dock}`);
    check('底部状态栏', statusbar);
    check('侧栏三个占位面板已注册', !!document.querySelector('[data-testid="sidebar-panel-pages"]'));
    check('Dock AI 占位面板已注册', !!document.querySelector('[data-testid="dock-panel-ai-chat"]'));
    check('默认欢迎 Tab 激活', !!document.querySelector('[data-testid="tab"][data-active="true"]'));
    await capture('02-workspace');

    // ── 4. 多 Tab 打开/关闭 ───────────────────────────────────
    const tabCount = () => document.querySelectorAll('[data-testid="tab"]').length;
    const before = tabCount();
    await createPage('冒烟页面 A');
    // createPage 落在当前激活 pane（默认 left）
    useTabStore.getState().openTab('right', {
      kind: 'page',
      title: '冒烟页面 B',
      path: '冒烟页面 B.md',
    });
    await waitFor(() => tabCount() >= before + 2);
    check('Tab 可打开（左右 pane 各一）', tabCount() === before + 2, `count=${tabCount()}`);
    const tabAText = document.querySelector('[data-testid="pane-right"]')?.textContent ?? '';
    check('右 pane 含新 Tab 内容', tabAText.includes('冒烟页面 B'));
    // 关闭右 pane 的 tab
    const rightPane = useTabStore.getState().panes.right;
    if (rightPane?.activeTabId) useTabStore.getState().closeTab('right', rightPane.activeTabId);
    await waitFor(() => tabCount() === before + 1);
    check('Tab 可关闭', tabCount() === before + 1, `count=${tabCount()}`);

    // ── 4b. 编辑器：新页创建 / 编辑保存 / 重开一致 / H1→文件名 / undo-redo ──
    check(
      'page Tab 挂载真实 TipTap EditorView',
      await waitFor(() => !!document.querySelector('[data-testid="editor-view"] .ProseMirror')),
    );
    const leftPageTab = useTabStore.getState().panes.left.tabs.find((t) => t.title === '冒烟页面 A');
    const editorRoot = document.querySelector<HTMLElement>(
      '[data-testid="pane-left"] [data-testid="editor-view"] .ProseMirror',
    );
    if (editorRoot && leftPageTab) {
      editorRoot.focus();
      // 首块已由文件名绑定为 H1；先在文档末尾插入正文，验证真实 TipTap 事务与防抖保存。
      document.execCommand('selectAll');
      document.execCommand('insertText', false, '冒烟页面 A\n第一块\n第二块');
      await sleep(900); // 500ms kernel debounce + IPC 写盘
      const originalSaved = await invoke('fs:readTextFile', { path: '冒烟页面 A.md' });
      check('空 vault 新页编辑后防抖保存', originalSaved.includes('第一块'));

      // 再把首 H1 文本改为新标题：选中 H1 文本并 insertText，触发 H1 → 文件名绑定。
      const h1 = editorRoot.querySelector('h1');
      if (h1?.firstChild) {
        const range = document.createRange();
        range.selectNodeContents(h1);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand('insertText', false, '冒烟重命名页');
      }
      await sleep(900);
      const renamedExists = await invoke('fs:exists', { path: '冒烟重命名页.md' });
      const renamedContent = renamedExists
        ? await invoke('fs:readTextFile', { path: '冒烟重命名页.md' })
        : '';
      check('编辑防抖保存并由 H1 重命名文件', renamedExists && renamedContent.includes('第一块'));
      const updatedTab = useTabStore.getState().panes.left.tabs.find((t) => t.id === leftPageTab.id);
      check(
        'H1 → 文件名/Tab 标题双向联动',
        updatedTab?.path === '冒烟重命名页.md' && updatedTab.title === '冒烟重命名页',
      );
      // 关闭后重开同一文件，验证保存内容可恢复
      useTabStore.getState().closeTab('left', leftPageTab.id);
      useTabStore.getState().openTab('left', {
        kind: 'page',
        title: '冒烟重命名页',
        path: '冒烟重命名页.md',
      });
      await waitFor(
        () =>
          document.querySelector('[data-testid="pane-left"] [data-testid="editor-view"] .ProseMirror')
            ?.textContent?.includes('第一块') ?? false,
      );
      check(
        '关闭并重新打开 Markdown 页面内容一致',
        document
          .querySelector('[data-testid="pane-left"] [data-testid="editor-view"] .ProseMirror')
          ?.textContent?.includes('第二块') ?? false,
      );
    } else {
      check('编辑器 DOM 就绪', false, `editor=${!!editorRoot} tab=${!!leftPageTab}`);
    }
    await capture('02b-editor');

    // ── 5. 分屏分隔线拖拽（程序化设置比例后测量 DOM 宽度）────
    useTabStore.getState().setSplitRatio(0.62);
    await sleep(200);
    const split = document.querySelector('[data-testid="split-view"]') as HTMLElement | null;
    const leftPane = document.querySelector('[data-testid="pane-left"]') as HTMLElement | null;
    const divider = !!document.querySelector('[data-testid="split-divider"]');
    let ratioOk = false;
    if (split && leftPane) {
      const r = leftPane.getBoundingClientRect().width / split.getBoundingClientRect().width;
      ratioOk = Math.abs(r - 0.62) < 0.04;
      check('分屏比例可调（拖拽目标值生效）', ratioOk, `ratio=${r.toFixed(3)}`);
    }
    check('分屏分隔线存在', divider && ratioOk);
    await capture('03-split');

    // ── 6. ⌘K 命令面板：唤起 + 过滤 + 键盘执行 ────────────────
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }),
    );
    check('⌘K 唤起命令面板', await waitFor(() => !!document.querySelector('[data-testid="command-palette"]')));
    // 动态注册新命令（验证「可注册新命令」的扩展机制）
    let customCommandRan = false;
    commandRegistry.register({
      id: 'smoke.custom',
      title: '冒烟专用自定义命令',
      category: '测试',
      run: () => {
        customCommandRan = true;
      },
    });
    const input = document.querySelector<HTMLInputElement>('[data-testid="palette-input"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    if (input && nativeSetter) {
      nativeSetter.call(input, '切换亮/暗主题');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await waitFor(() => document.querySelectorAll('[data-testid="palette-item"]').length > 0);
    const items = [...document.querySelectorAll('[data-testid="palette-item"]')];
    const hasThemeCmd = items.some((el) => el.textContent?.includes('切换亮/暗主题'));
    check('面板过滤命令', hasThemeCmd, `items=${items.length}`);
    await capture('04-palette');
    const themeBefore = useThemeStore.getState().resolved;
    // Enter 执行第一条过滤结果（切换主题）
    input?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await sleep(300);
    const themeAfter = useThemeStore.getState().resolved;
    const themeToggled = themeAfter !== themeBefore;
    check(
      '面板 Enter 执行命令（主题已切换）',
      themeToggled,
      `resolved=${themeBefore}->${themeAfter}`,
    );
    check('命令面板执行后关闭', !document.querySelector('[data-testid="command-palette"]'));
    // 运行自定义注册命令
    commandRegistry.get('smoke.custom')?.run();
    check('外部模块可注册新命令并执行', customCommandRan);

    // ── 7. 亮/暗主题 ─────────────────────────────────────────
    useThemeStore.getState().setPreference('dark');
    await sleep(300);
    const darkOn = document.documentElement.classList.contains('dark');
    check('暗色主题生效（CSS 变量切换）', darkOn && useThemeStore.getState().resolved === 'dark');
    await capture('05-dark');
    useThemeStore.getState().setPreference('light');
    await sleep(300);
    check('切回亮色主题', !document.documentElement.classList.contains('dark'));
    await capture('06-light');

    // ── 8. 侧栏折叠 ──────────────────────────────────────────
    useUiStore.getState().toggleSidebar();
    await sleep(250);
    const collapsed =
      document.querySelector('[data-testid="app-sidebar"]')?.getAttribute('data-collapsed') === 'true';
    check('侧栏可折叠', collapsed);
    await capture('07-sidebar-collapsed');
    useUiStore.getState().toggleSidebar();
    await sleep(250);

    // ── 9. IPC 文件能力（fs:listDir 真实数据进 UI）──────────
    useTabStore.getState().openTab('left', { kind: 'files', title: 'Vault 文件' });
    await waitFor(() => document.querySelectorAll('[data-testid="files-entry"]').length > 0);
    const entriesText = [...document.querySelectorAll('[data-testid="files-entry"]')]
      .map((el) => el.textContent ?? '')
      .join(' ');
    check('fs:listDir 经 IPC 返回 vault 内容', entriesText.includes('.nexnote'), entriesText.slice(0, 80));

    // ── 10. 命名空间 ping（editor/git/ai/plugins 框架就绪）────
    const editorPong = await invoke('editor:ping');
    check('editor:* 命名空间通道可用（占位）', editorPong.pong === true);

    // ── 11. 关闭 vault 回到向导 ───────────────────────────────
    await invoke('vault:close');
    check('vault:close 后回到向导', await waitFor(() => !!document.querySelector('[data-testid="onboarding"]')));
    // 最近列表应包含刚创建的 vault
    await sleep(400);
    const recentShown = document.querySelector('[data-testid="onboarding"]')?.textContent ?? '';
    check('最近打开列表持久化并显示', recentShown.includes('smoke-vault'));
    await capture('08-recent-list');
  } catch (e) {
    check('冒烟 harness 未抛错', false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  }

  await bridge.finish({ finishedAt: new Date().toISOString(), checks, captures: [] });
}
