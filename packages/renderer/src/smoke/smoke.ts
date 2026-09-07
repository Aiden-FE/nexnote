import { invoke } from '../lib/ipc';
import { commandRegistry } from '../registries';
import { useTabStore, openPageInActivePane } from '../stores/tab-store';
import { createPage } from '../features/editor/create-page';
import { useUiStore } from '../stores/ui-store';
import { useThemeStore } from '../theme/theme-store';
import { dockPanelRegistry } from '../registries';
import { getActiveEditor } from '../editor/active-editor';
import { openSettings } from '../lib/open-settings';
import { BUILTIN_PLUGIN_IDS } from '@nexnote/shared';

interface SmokeCaptureResult {
  ok: boolean;
  path?: string;
  error?: string;
}

interface SmokeBridge {
  capture(name: string): Promise<SmokeCaptureResult>;
  mkdtemp(): Promise<SmokeCaptureResult & { path?: string }>;
  writeFile(root: string, rel: string, content: string): Promise<SmokeCaptureResult & { path?: string }>;
  seedGraph(root: string): Promise<SmokeCaptureResult & { pages?: number; links?: number }>;
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
    check(
      '工作区出现（vault:changed 驱动）',
      await waitFor(() => !!document.querySelector('[data-testid="app-sidebar"]')),
    );

    // ── 3. 三面板布局 ─────────────────────────────────────────
    const sidebar = !!document.querySelector('[data-testid="app-sidebar"]');
    const main = !!document.querySelector('[data-testid="main-content"]');
    const dock = !!document.querySelector('[data-testid="right-dock"]');
    const statusbar = !!document.querySelector('[data-testid="status-bar"]');
    check(
      '三面板布局（侧栏+主区+右侧 dock）',
      sidebar && main && dock,
      `sb=${sidebar} main=${main} dock=${dock}`,
    );
    check('底部状态栏', statusbar);
    check(
      '侧栏至少一个面板已注册（按合并后 DEV-003 实际面板为准）',
      document.querySelectorAll('[data-testid^="sidebar-panel-"]').length >= 1,
    );
    check('Dock AI 占位面板已注册', !!document.querySelector('[data-testid="dock-panel-ai-chat"]'));
    check('Dock Git 时间线面板已注册（DEV-007）', dockPanelRegistry.get('git-timeline') !== undefined);
    check('状态栏 Git 状态项（分支可见）', !!document.querySelector('[data-testid="status-git-branch"]'));
    const statusText = document.querySelector('[data-testid="status-git"]')?.textContent ?? '';
    check('状态栏在 vault 创建后即显示分支与变更数', /main|master/.test(statusText), statusText.slice(0, 80));
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
      pagePath: '冒烟页面 B.md',
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
    const leftPageTab = useTabStore
      .getState()
      .panes.left.tabs.find((t) => t.title === '冒烟页面 A');
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
      const updatedTab = useTabStore
        .getState()
        .panes.left.tabs.find((t) => t.id === leftPageTab.id);
      check(
        'H1 → 文件名/Tab 标题双向联动',
        updatedTab?.pagePath === '冒烟重命名页.md' && updatedTab.title === '冒烟重命名页',
      );
      // 关闭后重开同一文件，验证保存内容可恢复
      useTabStore.getState().closeTab('left', leftPageTab.id);
      useTabStore.getState().openTab('left', {
        kind: 'page',
        title: '冒烟重命名页',
        pagePath: '冒烟重命名页.md',
      });
      await waitFor(
        () =>
          document
            .querySelector('[data-testid="pane-left"] [data-testid="editor-view"] .ProseMirror')
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
    check(
      '⌘K 唤起命令面板',
      await waitFor(() => !!document.querySelector('[data-testid="command-palette"]')),
    );
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
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
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
      document.querySelector('[data-testid="app-sidebar"]')?.getAttribute('data-collapsed') ===
      'true';
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
    check(
      'fs:listDir 经 IPC 返回 vault 内容',
      entriesText.includes('.nexnote'),
      entriesText.slice(0, 80),
    );

    // ── 9.5 DEV-003 页面树与文件操作 ─────────────────────
    const treeRow = (rel: string): Element | null =>
      document.querySelector(`[data-testid="tree-row"][data-path="${CSS.escape(rel)}"]`);

    // 关闭 FilesPage tab（smoke 前序步骤打开的），避免新 tab 不在前台
    const filesTab = document.querySelector('[data-testid="tab"][data-page-path]') as HTMLElement | null;
    if (filesTab) {
      const tabs = document.querySelectorAll('[data-pane="left"] [data-testid="tab"]');
      void tabs;
    }
    // 关闭之前为了冒烟 section 9 打开的 Vault 文件 tab
    {
      const leftPane = (window as unknown as { __store: unknown }).__store;
      void leftPane;
    }
    {
      const state = (useTabStore as unknown as { getState: () => { panes: { left: { tabs: { id: string; title: string; kind: string }[] } } } }).getState();
      const fileTab = state.panes.left.tabs.find((t) => t.title === 'Vault 文件');
      if (fileTab) useTabStore.getState().closeTab('left', fileTab.id);
    }

    // 新建笔记（IPC）→ fs:changed 事件回流 → 树出现 + tab 打开（带 frontmatter）
    await invoke('fs:createNote', { parentDir: '', name: '冒烟首页' });
    openPageInActivePane('冒烟首页.md');
    check(
      '新建笔记：树实时出现（fs:changed 驱动）',
      await waitFor(() => !!treeRow('冒烟首页.md')),
    );
    check(
      '新建笔记：打开 tab，frontmatter 含 created/id',
      await waitFor(() => {
        const bc = document.querySelector('[data-testid="page-breadcrumb"]');
        const body = document.querySelector('.nexnote-editor-scope')?.textContent ?? '';
        return !!bc && bc.textContent?.includes('冒烟首页') && body.includes('created:') && body.includes('id:');
      }),
    );
    check(
      '面包屑含 vault 根与页面名',
      (document.querySelector('[data-testid="page-breadcrumb"]')?.textContent ?? '').includes('smoke-vault'),
    );
    await capture('09-page-tree');

    // 外部进程写文件（主进程直接落盘，不经 fs IPC）→ chokidar 同步
    const ext = await bridge.writeFile(created.root, '研究/外部笔记.md', '# 外部\n\n#inbox');
    check('外部写入成功', ext.ok, ext.error);
    check(
      '外部创建文件实时反映到树（含目录自动创建）',
      await waitFor(() => !!treeRow('研究/外部笔记.md'), 15000),
    );

    // 搜索过滤
    const search = document.querySelector<HTMLInputElement>('[data-testid="tree-search-input"]');
    const nativeInputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (search && nativeInputSetter) {
      nativeInputSetter.call(search, '外部');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await waitFor(() => !!treeRow('研究/外部笔记.md'));
    await sleep(200);
    const visibleRows = [...document.querySelectorAll('[data-testid="tree-row"]')].filter(
      (el) => (el as HTMLElement).offsetParent !== null,
    );
    // 搜索命中：1 个文件 + 1 个祖先目录（暴露命中），无其他未匹配文件
    const visibleFileRows = visibleRows.filter((el) => el.getAttribute('data-kind') === 'file');
    check(
      '搜索实时过滤：仅命中页面与祖先目录可见',
      visibleFileRows.length === 1 && visibleFileRows[0]?.getAttribute('data-path') === '研究/外部笔记.md',
      `fileRows=${visibleFileRows.length} total=${visibleRows.length}`,
    );
    if (search && nativeInputSetter) {
      nativeInputSetter.call(search, '');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(150);

    // 标签聚合（frontmatter + 内联，防抖重扫）
    await invoke('fs:createNote', {
      parentDir: '',
      name: '带标签',
      content: '# 带标签\n\n#项目/inbox 和 #冒烟专用',
    });
    await bridge.writeFile(created.root, 'frontmatter标签.md', '---\ntags:\n  - 冒烟专用\n---\n\n# 页');
    // 切换到「标签」面板（chip 只有面板挂载时才会出现在 DOM）
    useUiStore.getState().setActiveSidebarPanel('tags');
    check(
      '标签面板聚合 frontmatter + 内联标签（计数=2）',
      await waitFor(() => {
        const chip = document.querySelector('[data-testid="tag-chip"][data-tag="冒烟专用"]');
        return !!chip && chip.textContent?.includes('2');
      }, 15000),
    );
    await capture('10-tags');
    // 点击标签 → 过滤树
    (
      document.querySelector('[data-testid="tag-chip"][data-tag="冒烟专用"]') as HTMLButtonElement | null
    )?.click();
    await sleep(400);
    // 切回页面面板查看过滤效果
    useUiStore.getState().setActiveSidebarPanel('pages');
    await sleep(250);
    const tagFilteredRows = [...document.querySelectorAll('[data-testid="tree-row"][data-kind="file"]')];
    check(
      '点击标签过滤页面树（仅含标签页面 + 过滤 chip）',
      tagFilteredRows.length === 2 && !!document.querySelector('[data-testid="tree-tag-filter-chip"]'),
      `rows=${tagFilteredRows.length}`,
    );
    (
      document.querySelector('[data-testid="tree-tag-filter-chip"]') as HTMLButtonElement | null
    )?.click();
    await sleep(150);

    // 先清掉标签过滤，避免重命名被过滤掉
    (
      document.querySelector('[data-testid="tree-tag-filter-chip"]') as HTMLButtonElement | null
    )?.click();
    await sleep(200);
    // 重命名 + wikilink 更新（端到端：主进程替换 + tab retarget + 树刷新）
    await invoke('fs:createNote', { parentDir: '', name: '链接源', content: '看 [[外部笔记]]' });
    await waitFor(() => !!treeRow('链接源.md'));
    // 先打开「外部笔记」tab，再重命名以验证 retarget
    openPageInActivePane('研究/外部笔记.md');
    const renameRes = await invoke('fs:renameLinked', {
      from: '研究/外部笔记.md',
      to: '研究/改名后.md',
    });
    // UI 的右键/拖拽操作成功后会调用同一 retarget；这里直接 invoke，显式模拟该视图层联动
    useTabStore.getState().retargetTabs('研究/外部笔记.md', '研究/改名后.md', '改名后');
    check(
      '重命名：树实时更新，wikilink 已替换',
      (await waitFor(() => !!treeRow('研究/改名后.md'), 15000)) &&
        !treeRow('研究/外部笔记.md') &&
        renameRes.updatedFiles.includes('链接源.md'),
      `updated=${renameRes.updatedFiles.join(',')}`,
    );
    const renamedTab = document.querySelector('[data-testid="tab"][data-page-path="研究/改名后.md"]');
    check('重命名：已打开 tab 的路径与标题联动', !!renamedTab);

    // 移动（目录拖拽走同一 IPC）
    await invoke('fs:renameLinked', { from: '研究/改名后.md', to: '改名后.md' });
    check(
      '移动：树刷新到新位置',
      await waitFor(() => !!treeRow('改名后.md') && !treeRow('研究/改名后.md'), 15000),
    );

    // 删除（回收站）：自动接受 confirm
    const origConfirm = window.confirm;
    window.confirm = () => true;
    await invoke('fs:delete', { path: '改名后.md', toTrash: true });
    window.confirm = origConfirm;
    check(
      '删除：树移除 + 指向它的 tab 关闭',
      (await waitFor(() => !treeRow('改名后.md'), 15000)) &&
        !document.querySelector('[data-testid="tab"][data-page-path="改名后.md"]'),
    );

    // 折叠记忆：新建目录 → 折叠 → 写入 vault 配置
    await invoke('fs:mkdir', { path: '折叠测试', recursive: false });
    await waitFor(() => !!treeRow('折叠测试'));
    check('外部 mkdir 也实时同步', !!treeRow('折叠测试'));
    (
      treeRow('折叠测试')?.querySelector('button[aria-label="折叠"]') as HTMLButtonElement | null
    )?.click();
    await sleep(900); // 布局防抖写回
    const configRaw = await invoke('fs:readTextFile', { path: '.nexnote/config.json' });
    check(
      '折叠状态持久化到 vault 配置（treeCollapsedDirs）',
      configRaw.includes('"treeCollapsedDirs"') && configRaw.includes('折叠测试'),
    );

    // 侧栏宽度可调（验收：宽度可调）
    const widthBefore =
      document.querySelector('[data-testid="app-sidebar"]')?.getBoundingClientRect().width ?? 0;
    useUiStore.getState().setSidebarWidth(widthBefore + 40);
    await sleep(200);
    const widthAfter =
      document.querySelector('[data-testid="app-sidebar"]')?.getBoundingClientRect().width ?? 0;
    check('侧栏宽度可调', Math.abs(widthAfter - (widthBefore + 40)) < 2, `${widthBefore} -> ${widthAfter}`);
    await capture('11-tree-final');

    // tab 右键菜单——先确保至少有一个 page tab 可被选中（不依赖默认 welcome 标签）
    openPageInActivePane('冒烟首页.md');
    await sleep(200);
    const pageTab = document.querySelector('[data-testid="tab"][data-page-path]') as HTMLElement | null;
    if (pageTab) {
      // 点击以激活
      pageTab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    await sleep(150);
    const firstTab = pageTab ?? document.querySelector('[data-testid="tab"]');
    firstTab?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 60 }),
    );
    const tabMenuVisible = await waitFor(() => !!document.querySelector('[data-testid="tab-context-menu"]'));
    check('tab 右键菜单弹出', tabMenuVisible);
    const menuText = document.querySelector('[data-testid="tab-context-menu"]')?.textContent ?? '';
    check(
      '菜单含 关闭其他/关闭右侧/复制路径',
      menuText.includes('关闭其他') && menuText.includes('关闭右侧') && menuText.includes('复制路径'),
    );
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await sleep(150);

    // ── 10a. DEV-006 图谱：真实 500/2000 索引、过滤、点击、局部跳数与 FPS ──
    const graphSeed = await bridge.seedGraph(created.root);
    check('图谱性能种子写入 500 页 / 2000 链接', graphSeed.ok, graphSeed.error);
    await invoke('index:rebuild');
    useTabStore.getState().openTab('left', { kind: 'graph', title: '知识图谱' });
    const graphText = () => document.querySelector('[data-testid="global-graph-view"]')?.textContent ?? '';
    check(
      '全局图谱展示 500 页 / 2000 链接快照',
      await waitFor(() => graphText().includes('2000 链接') && document.querySelectorAll('.react-flow__node').length >= 500, 20_000),
      graphText().slice(0, 100),
    );
    check(
      'React Flow 渲染全部图谱节点',
      await waitFor(() => document.querySelectorAll('.react-flow__node').length >= 500, 20_000),
    );

    const graphSurface = document.querySelector<HTMLElement>('.react-flow__renderer');
    if (graphSurface) {
      await sleep(400); // 500 节点初次布局后进入稳定交互阶段
      let frames = 0;
      let sampling = true;
      const countFrame = () => {
        frames += 1;
        if (sampling) requestAnimationFrame(countFrame);
      };
      requestAnimationFrame(countFrame);
      const durationMs = 2_000;
      const startedAt = performance.now();
      let wheels = 0;
      while (performance.now() - startedAt < durationMs) {
        wheels += 1;
        const pane = document.querySelector<HTMLElement>('.react-flow__pane') ?? graphSurface;
        pane.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: 650,
            clientY: 380,
            deltaY: wheels % 2 ? 90 : -90,
          }),
        );
        await sleep(16);
      }
      sampling = false;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const sample = { frames, wheels };
      const fps = sample.frames / 2;
      check(
        '500 节点 / 2000 边连续交互 FPS ≥ 30',
        fps >= 30 && sample.wheels >= 50,
        `fps=${fps.toFixed(1)} wheels=${sample.wheels}`,
      );
    } else {
      check('React Flow 交互 surface 存在', false);
    }

    const nativeOptionSetter = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'selected')?.set;
    const folderSelect = document.querySelector<HTMLSelectElement>('[data-testid="graph-folder-filter"]');
    const groupOption = [...(folderSelect?.options ?? [])].find((option) => option.value === 'graph/group-a');
    if (folderSelect && groupOption && nativeOptionSetter) {
      nativeOptionSetter.call(groupOption, true);
      folderSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    check(
      '文件夹子树过滤生效',
      await waitFor(() => graphText().includes('250 页面 · 1000 链接'), 10_000),
      graphText().slice(0, 100),
    );
    await capture('16-global-graph');
    const graphNode = document.querySelector<HTMLElement>('.react-flow__node');
    graphNode?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    check(
      '点击图谱节点跳转页面',
      await waitFor(() => {
        const activeTab = document.querySelector('[data-testid="tab"][data-active="true"]');
        return activeTab?.getAttribute('data-page-path')?.startsWith('graph/group-a/group-a-node-') ?? false;
      }, 10_000),
    );

    useUiStore.getState().setActiveSidebarPanel('graph');
    check(
      '局部图谱面板随当前页面更新',
      await waitFor(
        () => !!document.querySelector('[data-testid="sidebar-panel-graph"] .react-flow__node'),
        10_000,
      ),
    );
    document.querySelector<HTMLButtonElement>('[data-testid="graph-hops-2"]')?.click();
    const localNodeCount = () =>
      document.querySelectorAll('[data-testid="sidebar-panel-graph"] .react-flow__node').length;
    check('局部图谱支持 2 跳扩展', await waitFor(() => localNodeCount() > 9, 10_000), `nodes=${localNodeCount()}`);
    await capture('17-local-graph');

    const activePath = document.querySelector('[data-testid="tab"][data-active="true"]')?.getAttribute('data-page-path');
    const activeSummary = activePath ? await invoke('index:pageSummary', { path: activePath }) : null;
    check(
      'DEV-008 IPC pageSummary 返回图谱页面',
      !!activeSummary,
      JSON.stringify({ activePath, activeSummary }),
    );
    const activeConfidence = activeSummary
      ? await invoke('index:confidence', { pageId: activeSummary.pageId })
      : null;
    check(
      'DEV-008 IPC getConfidence 返回缓存分数',
      !!activeConfidence,
      JSON.stringify({ pageId: activeSummary?.pageId, activeConfidence }),
    );

    useUiStore.getState().setActiveDockPanel('document-properties');
    const confidenceReady = await waitFor(() => {
      const panel = document.querySelector('[data-testid="properties-panel"]');
      return !!panel && panel.querySelectorAll('[data-testid^="confidence-factor-"]').length === 6;
    }, 20_000);
    const propertiesPanel = document.querySelector('[data-testid="properties-panel"]');
    const confidenceText = propertiesPanel?.textContent ?? '';
    check(
      'DEV-008 属性面板显示真实置信度总分与六个因子',
      confidenceReady && /\/ 100/.test(confidenceText),
      confidenceText.slice(0, 120),
    );
    const firstFactor = propertiesPanel?.querySelector('[data-testid^="confidence-factor-"]');
    check(
      'DEV-008 因子悬停解释 tooltip 已提供',
      !!firstFactor?.getAttribute('title')?.includes('改动'),
      firstFactor?.getAttribute('title') ?? 'missing title',
    );
    await capture('18-confidence-properties');

    // ── 10. 命名空间 ping（editor/git/ai/plugins 框架就绪）────
    const editorPong = await invoke('editor:ping');
    check('editor:* 命名空间通道可用（占位）', editorPong.pong === true);

    // ── 10b. DEV-007 Git 底座：状态栏 + 时间线 + 手动提交 ──
    const status = await invoke('git:getStatus');
    check(
      'git:getStatus 报告真实仓库',
      status.repository === true && (status.branch === 'master' || status.branch === 'main'),
    );
    const initial = await invoke('git:getTimeline', {});
    check('git:getTimeline 返回 ≥1 提交', initial.length >= 1);
    check('git:getTimeline 首条为 initial', (initial[0]?.kind ?? '') === 'initial');
    await invoke('fs:writeTextFile', { path: 'smoke-note.md', content: '冒烟笔记' });
    // 自动提交走 30s 防抖；这里用手动提交验证提交链路，随后时间线刷新。
    const manual = await invoke('git:commit', { message: 'smoke manual commit' });
    check('手动提交成功（commitManual）', manual.status.changed === 0);
    const after = await invoke('git:getTimeline', {});
    check('手动提交形成新 HEAD（kind=manual）', (after[0]?.kind ?? '') === 'manual');
    // 切换 dock 到 git 时间线
    useUiStore.getState().setActiveDockPanel('git-timeline');
    await waitFor(() => !!document.querySelector('[data-testid="git-timeline"]'));
    const timelineText = document.querySelector('[data-testid="git-timeline"]')?.textContent ?? '';
    check('版本时间线 dock 面板渲染 commit 列表', timelineText.includes('smoke manual commit'), timelineText.slice(0, 80));
    await capture('09-git-timeline');

    // ── 10c. DEV-015 内置插件：Mermaid + KaTeX 真实渲染与 Obsidian 兼容写盘 ──
    // 用全新独立页面，确保它是当前活动编辑器，避免历史 tab 干扰。
    await createPage('内置插件演示');
    const builtinEditor = await waitFor(
      () => !![...document.querySelectorAll('[data-testid="pane-left"] [data-testid="editor-view"] .ProseMirror')].pop(),
      12_000,
    );
    check('DEV-015 编辑器就绪', builtinEditor);
    // 显式聚焦活动编辑器（注册聚焦监听会激活对应内核）。
    const builtinEl = [...document.querySelectorAll('[data-testid="pane-left"] [data-testid="editor-view"] .ProseMirror')].pop() as HTMLElement | undefined;
    builtinEl?.focus();
    builtinEl?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(150);
    const activeKernel = getActiveEditor();
    check(
      'DEV-015 活动编辑器可用',
      !!activeKernel,
      `editors=${document.querySelectorAll('[data-testid="editor-view"]').length} pm=${document.querySelectorAll('.ProseMirror').length}`,
    );
    if (activeKernel) {
      activeKernel.editor.commands.insertMermaidBlock({
        source: 'graph TD\n  A["开始"] --> B["结束"]',
      });
      activeKernel.editor.commands.insertMathBlock({ source: 'E = mc^2' });
      activeKernel.editor.commands.insertMathInline({ source: 'a^2 + b^2 = c^2' });
      await waitFor(() => !!document.querySelector('.nexnote-mermaid-view svg'), 15_000);
      const mermaidSvg = document.querySelector('.nexnote-mermaid-view svg');
      const mermaidError = document.querySelector('.nexnote-mermaid-view .nexnote-mermaid-preview.is-error');
      check(
        'DEV-015 Mermaid 真实渲染 SVG（flowchart）',
        !!mermaidSvg && !mermaidError,
        mermaidError?.textContent?.slice(0, 80) ?? `svg=${!!mermaidSvg}`,
      );
      await waitFor(
        () => document.querySelectorAll('.nexnote-math-view .katex, .nexnote-math-inline-view .katex').length >= 2,
        10_000,
      );
      const blockKatex = !!document.querySelector('.nexnote-math-view .katex');
      const inlineKatex = !!document.querySelector('.nexnote-math-inline-view .katex');
      const katexError = document.querySelector('[data-math-view] .nexnote-math-preview')?.textContent ?? '';
      check(
        'DEV-015 KaTeX 块级与行内均渲染',
        blockKatex && inlineKatex,
        `block=${blockKatex} inline=${inlineKatex}${katexError ? ` · ${katexError.slice(0, 60)}` : ''}`,
      );
      await capture('19-builtin-mermaid-katex');
      // 防抖保存后读盘验证 Obsidian 原生语法。
      await sleep(1_200);
      const saved = await invoke('fs:readTextFile', { path: '内置插件演示.md' });
      check(
        'DEV-015 保存文件为 Obsidian 原生语法（围栏/$$/$）',
        saved.includes('```mermaid') &&
          saved.includes('graph TD') &&
          saved.includes('$$\nE = mc^2\n$$') &&
          saved.includes('$a^2 + b^2 = c^2$'),
        saved.slice(-400),
      );
    }

    // ── 10d. DEV-015 设置页：内置插件可见/内置标记/禁启切换 ──
    openSettings('plugins');
    check(
      'DEV-015 设置页插件分区可见',
      await waitFor(() => !!document.querySelector('[data-testid="plugins-settings"]')),
    );
    const pluginListText = document.querySelector('[data-testid="plugin-list"]')?.textContent ?? '';
    const hasMermaid = pluginListText.includes('Mermaid 图表（内置）');
    const hasKatex = pluginListText.includes('KaTeX 数学公式（内置）');
    check('DEV-015 设置页列出两个内置插件', hasMermaid && hasKatex, `mermaid=${hasMermaid} katex=${hasKatex}`);
    const detailBuiltin = document.querySelector('[data-testid="plugin-detail"]')?.textContent ?? '';
    check(
      'DEV-015 详情页标注内置且隐藏卸载按钮',
      detailBuiltin.includes('内置插件') && !document.querySelector('[data-testid="plugin-uninstall"]'),
    );
    // 禁用 Mermaid → 状态变已停用；再启用恢复。
    await invoke('plugins:setEnabled', { pluginId: BUILTIN_PLUGIN_IDS.mermaid, enabled: false });
    await sleep(600);
    await invoke('plugins:setEnabled', { pluginId: BUILTIN_PLUGIN_IDS.mermaid, enabled: true });
    await sleep(600);
    const toggled = await invoke('plugins:list');
    const mermaidState = (toggled as { id: string; state: string }[]).find(
      (p) => p.id === BUILTIN_PLUGIN_IDS.mermaid,
    )?.state;
    check('DEV-015 内置插件可禁用并重新启用', mermaidState === 'active', `state=${mermaidState}`);
    await capture('20-builtin-plugins-settings');

    // ── 11. 关闭 vault 回到向导 ───────────────────────────────
    await invoke('vault:close');
    check(
      'vault:close 后回到向导',
      await waitFor(() => !!document.querySelector('[data-testid="onboarding"]')),
    );
    // 最近列表应包含刚创建的 vault
    await sleep(400);
    const recentShown = document.querySelector('[data-testid="onboarding"]')?.textContent ?? '';
    check('最近打开列表持久化并显示', recentShown.includes('smoke-vault'));
    await capture('08-recent-list');
  } catch (e) {
    check(
      '冒烟 harness 未抛错',
      false,
      e instanceof Error ? `${e.message}\n${e.stack}` : String(e),
    );
  }

  await bridge.finish({ finishedAt: new Date().toISOString(), checks, captures: [] });
}
