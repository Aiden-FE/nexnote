import { invoke } from '../lib/ipc';
import { openDocumentTab } from '../lib/open-document';
import { commandRegistry } from '../registries';
import { useTabStore, openPage } from '../stores/tab-store';
import { createPage } from '../features/editor/create-page';
import { SIDEBAR_MAX_WIDTH, useUiStore } from '../stores/ui-store';
import { useTagStore } from '../stores/tag-store';
import { usePageTreeStore } from '../stores/page-tree-store';
import { useThemeStore } from '../theme/theme-store';
import { dockPanelRegistry } from '../registries';
import { getActiveEditor } from '../editor/active-editor';
import { getActiveSourceEditor } from '../editor/source/active-source-editor';
import { currentPageCandidates } from '../editor/wikilink-page-ops';
import { applySourceFormat } from '../editor/source/source-formatting';
import { FORMAT_WIKILINK, runFormatAction } from '../editor/interactions/formatting';
import { TextSelection } from '@tiptap/pm/state';
import { redo, undo } from '@codemirror/commands';
import { sourceFoldState } from '../editor/source/heading-fold';
import { openSettings } from '../lib/open-settings';
import { deleteEntry, moveEntry } from '../features/sidebar/page-tree/ops';
import { BUILTIN_PLUGIN_IDS, type ChatSession } from '@nexnote/shared';
import { useChatStore } from '../features/ai/chat/chat-store';

interface SmokeCaptureResult {
  ok: boolean;
  path?: string;
  error?: string;
}

interface SmokeBridge {
  capture(name: string): Promise<SmokeCaptureResult>;
  mkdtemp(): Promise<SmokeCaptureResult & { path?: string }>;
  writeFile(
    root: string,
    rel: string,
    content: string,
  ): Promise<SmokeCaptureResult & { path?: string }>;
  seedGraph(root: string): Promise<SmokeCaptureResult & { pages?: number; links?: number }>;
  setWindowSize(width: number, height: number): Promise<SmokeCaptureResult>;
  typeText(text: string): Promise<SmokeCaptureResult>;
  pressKey(key: string, modifiers?: string[]): Promise<SmokeCaptureResult>;
  clickAtPoint(x: number, y: number): Promise<SmokeCaptureResult>;
  hoverAtPoint(x: number, y: number): Promise<SmokeCaptureResult>;
  pasteText(text: string): Promise<SmokeCaptureResult>;
  finish(report: unknown): Promise<SmokeCaptureResult>;
  /** DEV-037：内嵌 mock provider 地址 + 运行时调参（分段延迟 / 下一次请求失败）。 */
  aiMock(): Promise<SmokeCaptureResult & { url?: string }>;
  aiMockTune(tune: {
    chunkDelayMs: number;
    failNextChatWith?: number;
    failAfterChunks?: number;
  }): Promise<SmokeCaptureResult>;
}

interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function taskFirstLineCenter(root: Element): number | null {
  const checkbox = root.querySelector<HTMLInputElement>(
    "ul[data-type='taskList'] > li > label > input[type='checkbox']",
  );
  const content = root.querySelector<HTMLElement>("ul[data-type='taskList'] > li > div");
  if (!checkbox || !content) return null;
  const text = document.createTreeWalker(content, NodeFilter.SHOW_TEXT).nextNode();
  if (!text || !text.textContent?.trim()) return null;
  const checkboxRect = checkbox.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(text);
  const lineRect = range.getClientRects()[0];
  if (!lineRect) return null;
  return Math.abs(
    checkboxRect.top + checkboxRect.height / 2 - (lineRect.top + lineRect.height / 2),
  );
}

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
    const created = await invoke('vault:create', {
      parentDir: tmp.path,
      name: 'smoke-vault',
      initGit: true,
    });
    check('vault:create 成功', created.name === 'smoke-vault', created.root);

    // vault:changed 事件 → App 切到工作区
    check(
      '工作区出现（vault:changed 驱动）',
      await waitFor(() => !!document.querySelector('[data-testid="app-sidebar"]')),
    );

    // ── 2b. 新手引导：首次进入自动弹出，跳过后关闭 ────────────
    check(
      '首次进入工作区自动弹出新手引导',
      await waitFor(() => !!document.querySelector('[data-testid="guided-tour"]')),
    );
    const tourTitle = document.querySelector('[data-testid="tour-title"]')?.textContent ?? '';
    check('引导首步聚焦页面树', tourTitle === '页面树与新建', tourTitle);
    document.querySelector<HTMLButtonElement>('[data-testid="tour-skip"]')?.click();
    await sleep(200);
    check(
      '跳过引导后浮层关闭且不再自动弹出',
      !document.querySelector('[data-testid="guided-tour"]'),
    );

    // ── 2b'. 首启动 AI 引导（DEV-026）：未配置时自动弹一次，关闭后不再自动弹出 ──
    check(
      '未配置时首启动 AI 引导自动弹出',
      await waitFor(() => !!document.querySelector('[data-testid="ai-wizard"]')),
    );
    document
      .querySelector<HTMLButtonElement>('[data-testid="ai-wizard"] [aria-label="关闭向导"]')
      ?.click();
    await sleep(300);
    check('AI 引导关闭后不再自动弹出', !document.querySelector('[data-testid="ai-wizard"]'));

    // ── 2c. 欢迎页占位按钮已删除（DEV-021）───────────────────
    const welcomeCopy = document.querySelector('[data-testid="workspace-tabs"]')?.textContent ?? '';
    check(
      '欢迎页无「浏览 Vault 文件」占位按钮',
      welcomeCopy.includes('快速上手') && !welcomeCopy.includes('Vault 文件'),
      welcomeCopy.slice(0, 60),
    );

    // ── 3. 首次工作区布局 ─────────────────────────────────────
    const treeRow = (rel: string): Element | null =>
      document.querySelector(`[data-testid="tree-row"][data-path="${CSS.escape(rel)}"]`);
    const sidebar = !!document.querySelector('[data-testid="app-sidebar"]');
    const main = !!document.querySelector('[data-testid="main-content"]');
    const dock = !!document.querySelector('[data-testid="right-dock"]');
    const statusbar = !!document.querySelector('[data-testid="status-bar"]');
    check(
      '首次工作区为侧栏 + 单栏主区（Dock 默认关闭）',
      sidebar && main && !dock,
      `sb=${sidebar} main=${main} dock=${dock}`,
    );
    check(
      '主区只有一个 tab 栈（无分隔线 / 无第二 Pane）',
      !document.querySelector('[data-testid="split-divider"]') &&
        !document.querySelector('[data-testid="pane-right"]') &&
        document.querySelectorAll('[data-testid="workspace-tabs"]').length === 1,
    );
    check('底部状态栏', statusbar);
    check(
      '侧栏至少一个面板已注册（按合并后 DEV-003 实际面板为准）',
      document.querySelectorAll('[data-testid^="sidebar-panel-"]').length >= 1,
    );
    check('Dock AI 面板已注册（默认收起）', dockPanelRegistry.get('ai-chat') !== undefined);
    check(
      'Dock Git 时间线面板已注册（DEV-007）',
      dockPanelRegistry.get('git-timeline') !== undefined,
    );
    const statusReady = await waitFor(
      () => !!document.querySelector('[data-testid="status-git-branch"]'),
      15000,
    );
    check('状态栏 Git 状态项（分支可见）', statusReady);
    const statusText = document.querySelector('[data-testid="status-git"]')?.textContent ?? '';
    check(
      '状态栏在 vault 创建后即显示分支与变更数',
      /main|master/.test(statusText),
      statusText.slice(0, 80),
    );
    check('默认欢迎 Tab 激活', !!document.querySelector('[data-testid="tab"][data-active="true"]'));
    await capture('02-workspace');

    // ── 4. 多 Tab 打开/关闭 ───────────────────────────────────
    const tabCount = () => document.querySelectorAll('[data-testid="tab"]').length;
    const before = tabCount();
    await createPage('冒烟页面 A');
    check('tab-bar 新建页面后页面树立即出现', await waitFor(() => !!treeRow('冒烟页面 A.md')));
    const pageB = useTabStore.getState().openTab({
      kind: 'page',
      title: '冒烟页面 B',
      pagePath: '冒烟页面 B.md',
    });
    await waitFor(() => tabCount() >= before + 2);
    check('Tab 可打开（单栈多 tab）', tabCount() === before + 2, `count=${tabCount()}`);
    const tabAText = document.querySelector('[data-testid="workspace-tabs"]')?.textContent ?? '';
    check('主区含新 Tab 内容', tabAText.includes('冒烟页面 B'));

    // ── 4a. DEV-022 页签拖拽排序 + Ctrl+Tab 循环切换 ─────────
    const tabEl = (path: string): HTMLElement | null =>
      document.querySelector<HTMLElement>(
        `[data-testid="tab"][data-page-path="${CSS.escape(path)}"]`,
      );
    const domTabOrder = (): string[] =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="tab"]')].map(
        (el) => el.getAttribute('data-tab-identity') ?? '',
      );
    const dndTabTo = async (fromPath: string, toPath: string): Promise<void> => {
      const from = tabEl(fromPath);
      const to = tabEl(toPath);
      if (!from || !to) return;
      const rect = to.getBoundingClientRect();
      const x = rect.left + rect.width * 0.9;
      // Chromium 的合成 DragEvent 默认没有 dataTransfer；注入可变 DataTransfer
      // 才能真实走过 React 的 dragstart/dragover/drop 处理链。
      const transfer = typeof DataTransfer === 'function' ? new DataTransfer() : null;
      const eventWithTransfer = (event: DragEvent): DragEvent => {
        if (transfer) Object.defineProperty(event, 'dataTransfer', { value: transfer });
        return event;
      };
      from.dispatchEvent(
        eventWithTransfer(new DragEvent('dragstart', { bubbles: true, cancelable: true })),
      );
      // React 18 需要一拍才提交 draggingTabId state；立即派发 dragover 会被拖拽源守卫忽略。
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      to.dispatchEvent(
        eventWithTransfer(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: rect.top + rect.height / 2,
          }),
        ),
      );
      const indicatorReady = await waitFor(
        () => to.getAttribute('data-drop-indicator') === 'after',
      );
      check(
        '拖拽悬停显示插入位置反馈',
        indicatorReady,
        to.getAttribute('data-drop-indicator') ?? '(none)',
      );
      to.dispatchEvent(
        eventWithTransfer(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: rect.top + rect.height / 2,
          }),
        ),
      );
      from.dispatchEvent(
        eventWithTransfer(new DragEvent('dragend', { bubbles: true, cancelable: true })),
      );
    };
    await dndTabTo('冒烟页面 A.md', '冒烟页面 B.md');
    check(
      '拖拽重排：A 移到 B 之后，顺序立即更新',
      await waitFor(() => {
        const order = domTabOrder();
        return order.indexOf('冒烟页面 A.md') > order.indexOf('冒烟页面 B.md');
      }),
      domTabOrder().join(' | '),
    );
    await sleep(2_500); // 布局防抖 600ms + 写盘
    const tabOrderConfig = await invoke('fs:readTextFile', { path: '.nexnote/config.json' });
    check(
      '重排顺序持久化到 vault 布局（tabOrder）',
      tabOrderConfig.includes('"tabOrder"') &&
        tabOrderConfig.indexOf('冒烟页面 B.md') < tabOrderConfig.indexOf('冒烟页面 A.md'),
      tabOrderConfig.slice(0, 60),
    );

    const activeTabPath = (): string | null =>
      useTabStore.getState().tabs.find((t) => t.id === useTabStore.getState().activeTabId)
        ?.pagePath ?? null;
    const cycleFrom = (tabId: string, offset: 1 | -1): string | null => {
      const tabs = useTabStore.getState().tabs;
      const index = tabs.findIndex((tab) => tab.id === tabId);
      return index < 0
        ? null
        : (tabs[(index + offset + tabs.length) % tabs.length]?.pagePath ?? null);
    };
    const pageAId = useTabStore.getState().tabs.find((t) => t.pagePath === '冒烟页面 A.md')?.id;
    if (pageAId) useTabStore.getState().setActiveTab(pageAId);
    const nextPath = pageAId ? cycleFrom(pageAId, 1) : null;
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await sleep(150);
    check(
      'Ctrl+Tab 切换到下一个页签',
      pageAId !== undefined && activeTabPath() === nextPath,
      activeTabPath() ?? '(none)',
    );
    const currentId = useTabStore.getState().activeTabId;
    const wrappedPath = currentId ? cycleFrom(currentId, 1) : null;
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await sleep(150);
    check(
      'Ctrl+Tab 循环切换',
      currentId !== null && activeTabPath() === wrappedPath,
      activeTabPath() ?? '(none)',
    );
    if (pageAId) useTabStore.getState().setActiveTab(pageAId);
    const previousPath = pageAId ? cycleFrom(pageAId, -1) : null;
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await sleep(150);
    check(
      'Ctrl+Shift+Tab 反向循环切换',
      pageAId !== undefined && activeTabPath() === previousPath,
      activeTabPath() ?? '(none)',
    );
    useTabStore.getState().setActiveTab(pageB.id);
    useTabStore.getState().closeTab(pageB.id);
    await waitFor(() => tabCount() === before + 1);
    check('Tab 可关闭', tabCount() === before + 1, `count=${tabCount()}`);

    // ── 4b. 编辑器：新页创建 / 编辑保存 / 重开一致 / H1→文件名 / undo-redo ──
    check(
      'page Tab 挂载真实 TipTap EditorView',
      await waitFor(() => !!document.querySelector('[data-testid="editor-view"] .ProseMirror')),
    );
    const leftPageTab = useTabStore.getState().tabs.find((t) => t.title === '冒烟页面 A');
    const editorRoot = document.querySelector<HTMLElement>(
      '[data-testid="editor-view"] .ProseMirror',
    );
    if (editorRoot && leftPageTab) {
      editorRoot.focus();
      // 保留文件名绑定的首个 H1，只在文档末尾插入正文，验证真实 TipTap 事务与防抖保存。
      const activeEditor = getActiveEditor();
      activeEditor?.editor
        .chain()
        .focus()
        .insertContentAt(activeEditor.editor.state.doc.content.size, '\n\n第一块\n第二块')
        .run();
      await sleep(2500); // 500ms kernel debounce + IPC 写盘
      const originalSaved = await invoke('fs:readTextFile', { path: '冒烟页面 A.md' });
      check('空 vault 新页编辑后防抖保存', originalSaved.includes('第一块'));

      // 保存后的文档保持原路径；H1 重命名由独立 page-ops 测试覆盖，避免冒烟流程把焦点/防抖验收与命名联动耦合。
      check('编辑后页面路径保持稳定', leftPageTab.pagePath === '冒烟页面 A.md');

      // 真正输入路径：活动 TipTap 的 DOM 键入 `/h2`，不调用内部 slash hook 或注入菜单状态。
      const blockSlashInput = editorRoot;
      const blockSlashKernel = getActiveEditor();
      if (blockSlashKernel && blockSlashInput) {
        const slashBaselineMarkdown = blockSlashKernel.getMarkdown();
        // Use End+Enter to create a fresh empty paragraph, then drive `/h2` through
        // Electron's trusted Chromium edit path. The empty paragraph is the same
        // block-type trigger a keyboard user reaches; the fixture is restored below.
        await bridge.pressKey('End');
        await bridge.pressKey('Enter');
        await sleep(80);
        const slashPosition = blockSlashKernel.editor.state.selection.from;
        const slashCoords = blockSlashKernel.editor.view.coordsAtPos(slashPosition);
        const clicked = await bridge.clickAtPoint(
          Math.round(slashCoords.left),
          Math.round(slashCoords.top),
        );
        await sleep(100);
        const pastedSlash = clicked.ok ? await bridge.pasteText('/') : clicked;
        const typed = pastedSlash.ok ? await bridge.typeText('h2') : pastedSlash;
        await sleep(150);
        const blockSlashMenu = (): HTMLElement | null =>
          document.querySelector<HTMLElement>('[data-testid="block-slash-menu"]');
        const blockSlashItem = (): HTMLElement | null =>
          blockSlashMenu()?.querySelector<HTMLElement>('[data-slash-item="block:heading:2"]') ??
          null;
        const blockSlashOpen = await waitFor(
          () =>
            !!blockSlashMenu() &&
            blockSlashMenu()?.getAttribute('role') === 'listbox' &&
            blockSlashMenu()?.getAttribute('aria-label') === '快捷插入动作' &&
            blockSlashMenu()?.style.display !== 'none' &&
            !!blockSlashItem() &&
            blockSlashItem()?.getAttribute('aria-selected') === 'true',
        );
        // Keep every edit/navigation action on Electron's trusted WebContents path. The
        // renderer can inspect only the visible result; synthetic KeyboardEvents would not
        // exercise ProseMirror's packaged Chromium key handling.
        const selected = blockSlashOpen ? await bridge.pressKey('ArrowDown') : null;
        await bridge.pressKey('ArrowUp');
        const confirmed = selected ? await bridge.pressKey('Enter') : null;
        await sleep(150);
        check(
          'TipTap 真实键入 /：菜单可见、可键盘选择、消费触发词并转换 H2',
          typed.ok &&
            selected?.ok === true &&
            confirmed?.ok === true &&
            blockSlashOpen &&
            blockSlashKernel.editor.state.selection.$from.parent.type.name === 'heading' &&
            blockSlashKernel.editor.state.selection.$from.parent.attrs.level === 2 &&
            !blockSlashKernel.getMarkdown().includes('/h2') &&
            blockSlashMenu()?.style.display === 'none',
          blockSlashKernel.getMarkdown().slice(-70),
        );
        // The slash conversion is asserted above, then restore the pre-scenario document
        // so the following selection/AI smoke scenarios retain their original fixture.
        blockSlashKernel.setMarkdown(slashBaselineMarkdown);
        blockSlashKernel.editor.commands.focus();
        await sleep(1200);
      } else {
        check('TipTap 真实键入 /：块编辑器已挂载', false);
      }

      // DEV-023 块编辑「双链」按钮：选中「第一块」经内核 wikilink 节点插入（可 undo）。
      const blockKernel = getActiveEditor();
      if (blockKernel) {
        const blockView = blockKernel.editor.view;
        const blockDoc = blockView.state.doc;
        let firstFrom = -1;
        let firstTo = -1;
        blockDoc.descendants((node, pos) => {
          if (firstFrom >= 0 || !node.isText) return true;
          const at = node.text?.indexOf('第一块') ?? -1;
          if (at >= 0) {
            firstFrom = pos + at;
            firstTo = firstFrom + '第一块'.length;
          }
          return false;
        });
        if (firstFrom >= 0) {
          blockView.dispatch(
            blockView.state.tr.setSelection(
              TextSelection.create(blockView.state.doc, firstFrom, firstTo),
            ),
          );
          // DEV-034：块编辑划词工具栏同样以单一 AI 入口收口，键盘可开合。
          await waitFor(
            () =>
              !!document.querySelector('[data-selection-bubble] [data-bubble-action="ai:menu"]'),
          );
          const blockBubble = document.querySelector<HTMLElement>('[data-selection-bubble]');
          const blockTrigger = blockBubble?.querySelector<HTMLButtonElement>(
            '[data-bubble-action="ai:menu"]',
          );
          const blockMenu = blockBubble?.querySelector<HTMLElement>('[data-ai-menu]');
          const blockStop = blockBubble?.querySelector<HTMLButtonElement>(
            '[data-testid="bubble-stop"]',
          );
          check(
            '块编辑划词工具栏：AI 单一入口 + 七项动作 + 平铺格式化/双链',
            !!blockBubble &&
              blockBubble.style.display !== 'none' &&
              !!blockTrigger &&
              Array.from(blockBubble.querySelectorAll<HTMLElement>('[data-bubble-action]'))
                .map((el) => el.dataset.bubbleAction)
                .join(',') ===
                'format:bold,format:italic,format:strike,format:code,format:link,format:wikilink,ai:menu,ai:stop' &&
              Array.from(blockBubble.querySelectorAll<HTMLElement>('[data-ai-menu-action]'))
                .map((el) => el.dataset.aiMenuAction)
                .join(',') ===
                'ai:rewrite,ai:polish,ai:condense,ai:expand,ai:fillgaps,ai:evidence,chat:ask-selection,translate:selection,translate:workbench',
          );
          blockTrigger?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
          );
          await sleep(150);
          check(
            '块编辑 AI 下拉键盘打开；Esc 只关菜单、工具栏保持；停止控件非生成态隐藏',
            blockMenu?.hidden === false &&
              blockTrigger?.getAttribute('aria-expanded') === 'true' &&
              !!blockStop &&
              blockStop.hidden === true,
          );
          (document.activeElement ?? document.body).dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
          );
          await sleep(150);
          check(
            '块编辑 AI 下拉 Esc 关闭且工具栏保持',
            blockMenu?.hidden === true && blockBubble?.style.display !== 'none',
          );

          check(
            '块编辑双链按钮：经内核 wikilink 节点插入且可 undo',
            runFormatAction(FORMAT_WIKILINK, blockKernel, '第一块') &&
              !!document.querySelector(
                '[data-testid="editor-view"] .ProseMirror [data-wikilink-target="第一块"]',
              ) &&
              blockKernel.undo() &&
              !document.querySelector(
                '[data-testid="editor-view"] .ProseMirror [data-wikilink-target="第一块"]',
              ),
          );
        } else {
          check('块编辑双链按钮：定位选区文本', false, '第一块 not found');
        }
      }
      useTabStore.getState().closeTab(leftPageTab.id);
      await openDocumentTab('冒烟页面 A.md');
      const reopenedEditor = () =>
        document.querySelector(
          '[data-testid="editor-view"][data-path="冒烟页面 A.md"] .ProseMirror',
        );
      check(
        '关闭并重新打开文档内容一致',
        await waitFor(() => {
          const text = reopenedEditor()?.textContent ?? '';
          return text.includes('第一块') && text.includes('第二块');
        }),
      );
    } else {
      check('编辑器 DOM 就绪', false, `editor=${!!editorRoot} tab=${!!leftPageTab}`);
    }
    await capture('02b-editor');

    // ── DEV-037 编辑器侧流式状态机：首片段即显示 / 停止保留内容 / 失败保留内容 ──
    // 真实 Chromium + 内嵌 mock provider：验证流式增量呈现、取消与失败的未完成语义。
    const writingCard = (): HTMLElement | null =>
      document.querySelector<HTMLElement>('[data-testid="writing-assistant"]');
    const writingStatus = (): string | null => writingCard()?.dataset.status ?? null;
    /** 已生成内容（diff 新增侧）文本：区分「首片段已显示」与 diff 里的原文。 */
    const writingAddedText = (): string =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="writing-diff"] [data-diff-op="add"]'),
      )
        .map((el) => el.textContent ?? '')
        .join('\n')
        .replace(/^\+ /, '');
    const incompleteBadge = (): HTMLElement | null =>
      document.querySelector<HTMLElement>('[data-testid="writing-incomplete"]');
    const clickWriting = (testId: string): void => {
      document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
    };
    /** 选中块内 '第一块' 文本（块编辑划词工具栏的 AI 动作目标）。 */
    const selectRewriteTarget = (
      kernel: NonNullable<ReturnType<typeof getActiveEditor>>,
    ): boolean => {
      const view = kernel.editor.view;
      const doc = view.state.doc;
      let from = -1;
      let to = -1;
      doc.descendants((node, pos) => {
        if (from >= 0 || !node.isText) return true;
        const at = node.text?.indexOf('第一块') ?? -1;
        if (at >= 0) {
          from = pos + at;
          to = from + '第一块'.length;
        }
        return false;
      });
      if (from < 0) return false;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, from, to)));
      return true;
    };
    /** 经块编辑划词工具栏的 AI 下拉触发改写（真实点击路径，非直接调用）。 */
    const triggerBlockRewrite = async (): Promise<boolean> => {
      const bubble = document.querySelector<HTMLElement>('[data-selection-bubble]');
      const trigger = bubble?.querySelector<HTMLButtonElement>('[data-bubble-action="ai:menu"]');
      if (!trigger) return false;
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      );
      await sleep(150);
      const item = bubble?.querySelector<HTMLButtonElement>('[data-ai-menu-action="ai:rewrite"]');
      if (!item) return false;
      item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    };

    // 指向内嵌 mock 的写作 Profile（无密钥：mock 不校验鉴权头，密钥零落盘零暴露）
    // 该 Profile 让 AI dock / 对话链路可在冒烟中工作；在 6b 段之前删除以恢复「未配置」状态。
    const mockUrl = (await bridge.aiMock()).url;
    let smokeProfileId: string | null = null;
    const aiConfigured = await (async (): Promise<boolean> => {
      if (!mockUrl) return false;
      try {
        const saved = await invoke('ai:profile:save', {
          profile: {
            name: '冒烟 mock provider',
            kind: 'openai-compatible',
            baseUrl: mockUrl,
            defaultModel: 'gpt-4o-mini',
          },
        });
        smokeProfileId = saved.id;
        await invoke('ai:profile:setDefault', { id: saved.id });
        await invoke('ai:features:set', {
          feature: 'writing',
          assignment: { profileId: saved.id, model: 'gpt-4o-mini' },
        });
        return true;
      } catch {
        return false;
      }
    })();
    check('冒烟可配置指向内嵌 mock 的写作 Profile（无密钥）', aiConfigured);
    const slowTune = await bridge.aiMockTune({ chunkDelayMs: 400 });
    check('mock provider 分段延迟可调（稳定观察流式中间态）', slowTune.ok, slowTune.error);

    const writeKernel = getActiveEditor();
    if (aiConfigured && writeKernel) {
      // 场景 A：首片段即显示 → 生成中停止 → 保留内容 + 标记未完成 → Reject 恢复原文
      const docBefore = writeKernel.getMarkdown();
      check(
        'DEV-037 块编辑划词触发改写（显式 AI 动作）',
        selectRewriteTarget(writeKernel) &&
          (await waitFor(
            () =>
              !!document.querySelector('[data-selection-bubble] [data-bubble-action="ai:menu"]'),
            5_000,
          )) &&
          (await triggerBlockRewrite()),
      );
      const firstFragment = await waitFor(
        () => writingStatus() === 'streaming' && writingAddedText().trim().length > 0,
        10_000,
      );
      check(
        '首片段即显示：仍在生成中就已增量呈现',
        firstFragment,
        `status=${writingStatus()} added=${writingAddedText().trim().slice(0, 24)}`,
      );
      await capture('24a-DEV-037-streaming');
      clickWriting('writing-cancel');
      const cancelled = await waitFor(() => writingStatus() === 'cancelled', 5_000);
      check(
        '停止生成：保留已显示内容并标记未完成（浮层不关闭）',
        cancelled && writingAddedText().trim().length > 0 && !!incompleteBadge(),
        `status=${writingStatus()} added=${writingAddedText().trim().slice(0, 24)} badge=${incompleteBadge()?.textContent ?? 'none'}`,
      );
      check(
        '停止期间未写回源码（原文不变、无多余 undo 单元）',
        writeKernel.getMarkdown() === docBefore,
      );
      await capture('24b-DEV-037-cancelled');
      clickWriting('writing-reject');
      await sleep(150);
      check('Reject 丢弃会话且原文不变', !writingCard() && writeKernel.getMarkdown() === docBefore);

      // 场景 B：流式中途断线（已推送部分片段后 socket 断开）
      // → 保留已显示内容 + 标记未完成 → Reject 恢复原文
      const failTune = await bridge.aiMockTune({ chunkDelayMs: 200, failAfterChunks: 2 });
      check('mock provider 可模拟流式中途断线', failTune.ok, failTune.error);
      check(
        'DEV-037 断线场景：重新划词触发改写',
        selectRewriteTarget(writeKernel) && (await triggerBlockRewrite()),
      );
      const failed = await waitFor(() => writingStatus() === 'error', 10_000);
      check(
        '断线：会话标记未完成、错误可见、已显示内容保留（浮层不关闭）',
        failed &&
          !!incompleteBadge() &&
          !!document.querySelector('[data-testid="writing-error"]') &&
          writingAddedText().trim().length > 0,
        `status=${writingStatus()} added=${writingAddedText().trim().slice(0, 24)} error=${document.querySelector('[data-testid="writing-error"]')?.textContent ?? 'none'}`,
      );
      check('断线未写回源码（原文不变）', writeKernel.getMarkdown() === docBefore);
      await capture('24c-DEV-037-disconnected');
      clickWriting('writing-reject');
      await sleep(150);
      check(
        '断线后 Reject 恢复原文并关闭浮层',
        !writingCard() && writeKernel.getMarkdown() === docBefore,
      );

      // 场景 C：请求级失败（HTTP 500，无任何片段）→ 未完成标记 + Reject 退出
      const httpFail = await bridge.aiMockTune({ chunkDelayMs: 30, failAfterChunks: 0 });
      check('mock provider 可模拟无片段请求失败', httpFail.ok, httpFail.error);
      check(
        'DEV-037 无片段失败场景：重新划词触发改写',
        selectRewriteTarget(writeKernel) && (await triggerBlockRewrite()),
      );
      const errored = await waitFor(() => writingStatus() === 'error', 10_000);
      check(
        '请求失败：会话标记未完成并展示错误',
        errored && !!incompleteBadge() && !!document.querySelector('[data-testid="writing-error"]'),
        `status=${writingStatus()} error=${document.querySelector('[data-testid="writing-error"]')?.textContent ?? 'none'}`,
      );
      clickWriting('writing-reject');
      await sleep(150);
      check(
        '请求失败后 Reject 恢复原文并关闭浮层',
        !writingCard() && writeKernel.getMarkdown() === docBefore,
      );
      await bridge.aiMockTune({ chunkDelayMs: 30 });
    }

    // ── 4c. DEV-043 task checkbox 首行对齐（真实布局几何断言）──────
    // 以首行行盒中心（Range 文本选区矩形）为基准，断言 checkbox 视觉中心偏差 ≤ 2px；
    // CSS 方案为 label 高度 1lh + 内部居中，与字号无关。
    await createPage('DEV-043 对齐');
    check(
      'DEV-043 对齐页进入块编辑',
      await waitFor(
        () =>
          !!document.querySelector(
            '[data-testid="editor-view"][data-path="DEV-043 对齐.md"] .ProseMirror',
          ),
      ),
    );
    document
      .querySelector<HTMLElement>(
        '[data-testid="editor-view"][data-path="DEV-043 对齐.md"] .ProseMirror',
      )
      ?.focus();
    const alignKernel = getActiveEditor();
    if (alignKernel) {
      alignKernel.setMarkdown('# DEV-043 对齐\n\n- [ ] 待办首行\n- [x] 已完成\n  第二行');
      await sleep(150);
      const alignEditorHost = document.querySelector(
        '[data-testid="editor-view"][data-path="DEV-043 对齐.md"]',
      );
      const defaultDelta = alignEditorHost ? taskFirstLineCenter(alignEditorHost) : null;
      check(
        'DEV-043 编辑区 checkbox 与首行行盒中心偏差 ≤ 2px（默认 16px/1.75）',
        defaultDelta !== null && defaultDelta <= 2,
        defaultDelta === null ? 'checkbox/首行未找到' : `${defaultDelta.toFixed(2)}px`,
      );

      document.documentElement.style.setProperty('--editor-font-size', '19px');
      await sleep(150);
      const scaledDelta = alignEditorHost ? taskFirstLineCenter(alignEditorHost) : null;
      check(
        'DEV-043 编辑区 checkbox 与首行行盒中心偏差 ≤ 2px（自定义字号 19px）',
        scaledDelta !== null && scaledDelta <= 2,
        scaledDelta === null ? 'checkbox/首行未找到' : `${scaledDelta.toFixed(2)}px`,
      );
      document.documentElement.style.removeProperty('--editor-font-size');
      await sleep(150);
    } else {
      check('DEV-043 编辑区几何断言', false, '活动编辑器不可用');
    }

    await invoke('fs:createNote', {
      parentDir: '',
      name: 'DEV-043 预览',
      content: '- [ ] 待办首行\n- [x] 已完成\n',
      format: 'markdown',
    });
    await openDocumentTab('DEV-043 预览.md');
    const previewListReady = await waitFor(
      () => !!document.querySelector('[data-testid="live-preview"] ul[data-type="taskList"]'),
    );
    const previewHost = document.querySelector('[data-testid="live-preview"]');
    const previewDelta = previewListReady && previewHost ? taskFirstLineCenter(previewHost) : null;
    check(
      'DEV-043 预览区 checkbox 与首行行盒中心偏差 ≤ 2px（与编辑区共用对齐规则）',
      previewDelta !== null && previewDelta <= 2,
      previewDelta === null ? '预览区 checkbox/首行未找到' : `${previewDelta.toFixed(2)}px`,
    );
    // 还原 tab 栈：DEV-043 预览页是 source-mode-view，必须关闭，避免影响第 5 节的
    // 「native-block 不出现源码视图」等全文档断言。
    for (const path of ['DEV-043 预览.md', 'DEV-043 对齐.md']) {
      const tab = useTabStore.getState().tabs.find((t) => t.pagePath === path);
      if (tab) useTabStore.getState().closeTab(tab.id);
    }
    await sleep(150);

    // ── 4c. DEV-036：Chat Dock 使用活动编辑器光标插入（块模式 + 单步 undo） ──
    const blockForInsert = getActiveEditor();
    if (blockForInsert) {
      const blockView = blockForInsert.editor.view;
      blockView.focus();
      blockView.dispatch(
        blockView.state.tr.setSelection(
          TextSelection.create(blockView.state.doc, blockView.state.doc.content.size - 1),
        ),
      );
      const session: ChatSession = {
        path: `.nexnote/sessions/${'0'.repeat(64)}.txt`,
        meta: {
          id: 'dev-036-smoke',
          title: 'DEV-036',
          profileId: null,
          model: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        turns: [{ role: 'assistant', content: 'DEV-036 块回复' }],
      };
      useChatStore.getState().setActive(session, false);
      useUiStore.getState().setActiveDockPanel('ai-chat');
      check(
        'Chat Dock 块模式插入按钮可用',
        await waitFor(() => {
          const button = document.querySelector<HTMLButtonElement>(
            '[data-testid="chat-insert-block"]',
          );
          return !!button && !button.disabled;
        }),
      );
      document.querySelector<HTMLButtonElement>('[data-testid="chat-insert-block"]')?.click();
      check(
        'Chat Dock 块模式写入当前光标且单步 undo',
        blockForInsert.getMarkdown().includes('DEV-036 块回复') &&
          blockForInsert.undo() &&
          !blockForInsert.getMarkdown().includes('DEV-036 块回复'),
      );
    } else {
      check('Chat Dock 块模式活动编辑器存在', false);
    }

    // ── 4d. DEV-033：会话内部 JSONL 存储（历史续聊 + 导出为页面）──
    {
      const draft = await invoke('chat:new', { title: 'DEV-033 会话' });
      const seeded: ChatSession = {
        ...draft,
        turns: [
          { role: 'user', content: 'DEV-033 提问' },
          { role: 'assistant', content: 'DEV-033 回答' },
        ],
      };
      await invoke('chat:save', { session: seeded, status: 'cancelled' });
      check(
        'DEV-033 会话文件为 .nexnote/sessions/{hash}.txt',
        /^\.nexnote\/sessions\/[a-f0-9]{64}\.txt$/.test(seeded.path),
        seeded.path,
      );
      const raw = await invoke('fs:readTextFile', { path: seeded.path });
      check(
        'DEV-033 会话内容为 JSONL 快照（非 type: chat 页面）',
        raw.includes('"type":"snapshot"') && !raw.includes('type: chat'),
        raw.slice(0, 80),
      );
      const listed = (await invoke('chat:list', {})) as Array<{
        path: string;
        status: string;
      }>;
      const entry = listed.find((item) => item.path === seeded.path);
      check(
        'DEV-033 重启后历史可列出且带未完成状态',
        entry?.status === 'cancelled',
        JSON.stringify(entry),
      );
      const searched = (await invoke('chat:list', { query: 'DEV-033' })) as Array<{ path: string }>;
      check(
        'DEV-033 历史可按标题搜索',
        searched.some((item) => item.path === seeded.path),
        `hits=${searched.length}`,
      );
      const tree = (await invoke('fs:listTree', { showAllFiles: true })) as Array<{ path: string }>;
      check('DEV-033 会话不进入文档树', !tree.some((item) => item.path.startsWith('.nexnote')));

      useUiStore.getState().setActiveDockPanel('ai-chat');
      await waitFor(() => !!document.querySelector('[data-testid="chat-history"]'));
      document.querySelector<HTMLButtonElement>('[data-testid="chat-history"]')?.click();
      check(
        'DEV-033 历史面板列出会话并标记未完成状态',
        await waitFor(() => {
          const menu = document.querySelector('[data-testid="chat-history-menu"]');
          return (
            !!menu &&
            (menu.textContent ?? '').includes('DEV-033 会话') &&
            (menu.textContent ?? '').includes('已取消')
          );
        }),
      );
      check(
        'DEV-033 历史面板提供搜索框',
        !!document.querySelector('[data-testid="chat-history-search"]'),
      );
      document.querySelector<HTMLButtonElement>('[data-testid="chat-history-item"]')?.click();
      check(
        'DEV-033 点击历史会话载入续聊',
        await waitFor(
          () =>
            (document.querySelector('[data-testid="chat-turn-user"]')?.textContent ?? '') ===
            'DEV-033 提问',
        ),
      );
      await capture('22-DEV-033-chat-history');

      await waitFor(
        () => !document.querySelector<HTMLButtonElement>('[data-testid="chat-save-doc"]')?.disabled,
      );
      document.querySelector<HTMLButtonElement>('[data-testid="chat-save-doc"]')?.click();
      const exportedPath = 'DEV-033 会话.md';
      check(
        'DEV-033 导出为页面并作为普通文档打开',
        await waitFor(() =>
          useTabStore.getState().tabs.some((tab) => tab.pagePath === exportedPath),
        ),
      );
      const exportedMeta = await invoke('document:getMetadata', { path: exportedPath });
      check(
        'DEV-033 导出产物是普通页面（native-block）',
        exportedMeta?.format === 'native-block',
        JSON.stringify(exportedMeta),
      );
      const exportedText = await invoke('fs:readTextFile', { path: exportedPath });
      check(
        'DEV-033 导出产物与会话脱钩（正文为普通 markdown）',
        exportedText.includes('DEV-033 回答') &&
          exportedText.includes('> 提问：') &&
          !exportedText.includes('"type":"snapshot"'),
      );
      const treeAfterExport = (await invoke('fs:listTree', { showAllFiles: true })) as Array<{
        path: string;
      }>;
      check(
        'DEV-033 导出页进入文档树，会话仍不在树中',
        treeAfterExport.some((item) => item.path === exportedPath) &&
          !treeAfterExport.some((item) => item.path.startsWith('.nexnote')),
      );
      await capture('23-DEV-033-export-page');
    }

    // ── 4c. DEV-035 编辑器工具栏：单行、Tab tooltip、窄窗溢出「更多」可达 ──
    const toolbarEl = (): HTMLElement | null =>
      document.querySelector<HTMLElement>('[data-testid="editor-toolbar"]');
    const toolbarActions = (): HTMLElement | null =>
      document.querySelector<HTMLElement>('[data-testid="editor-toolbar-actions"]');
    const rowEntryIds = (): string[] =>
      [
        ...(toolbarActions()?.querySelectorAll<HTMLElement>('button[data-toolbar-item="true"]') ??
          []),
      ].map((el) => el.dataset.itemId ?? '');
    const menuItemIds = (): string[] =>
      [
        ...(document
          .querySelector('[data-testid="toolbar-more-menu"]')
          ?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
      ].map((el) => (el.dataset.testid ?? '').replace('toolbar-menu-item-', ''));
    const findToolbarAction = (id: string): HTMLButtonElement | null =>
      document.querySelector<HTMLButtonElement>(
        `[data-testid="toolbar-menu-item-${CSS.escape(id)}"]`,
      ) ??
      document.querySelector<HTMLButtonElement>(`[data-testid="toolbar-entry-${CSS.escape(id)}"]`);
    const clickToolbarAction = (id: string): boolean => {
      let target = findToolbarAction(id);
      if (!target) {
        // 动作已收进「更多」：先展开溢出菜单再点。
        document.querySelector<HTMLButtonElement>('[data-testid="toolbar-more"]')?.click();
        target = findToolbarAction(id);
      }
      target?.click();
      return !!target;
    };
    const BLOCK_TOOLBAR_ACTIONS = [
      'format:bold',
      'format:italic',
      'format:strike',
      'format:code',
      'format:link',
      'format:wikilink',
      'insert:image',
      'insert:attachment',
      'ai',
    ];
    const AI_ACTION_IDS = [
      'ai:ask',
      'ai:rewrite',
      'ai:polish',
      'ai:condense',
      'ai:expand',
      'ai:fillgaps',
      'ai:evidence',
    ];

    check(
      '工具栏为单行且不回显文件名',
      (await waitFor(() => !!toolbarEl())) &&
        toolbarEl()?.getAttribute('role') === 'toolbar' &&
        !(toolbarEl()?.textContent ?? '').includes('冒烟页面 A.md'),
    );
    const tabTooltipOk = (() => {
      const span = document.querySelector<HTMLElement>(
        '[data-testid="tab"][data-page-path] [data-testid="tab-title"]',
      );
      return (
        !!span &&
        (span.textContent ?? '').length > 1 &&
        span.getAttribute('title') === span.textContent &&
        (span.className ?? '').includes('truncate')
      );
    })();
    check('Tab 标题截断并以 title 展示完整名称', tabTooltipOk);

    // 窄窗：主窗口收到最小宽度 + 侧栏最宽 + Dock 打开 → 编辑区极窄，动作必须收进「更多」。
    // 恢复用常规尺寸（与主进程默认窗口一致），窄窗断言之外的用例继续在常规宽度下运行。
    const REGULAR_WINDOW = { width: 1360, height: 860 };
    useUiStore.getState().setDockVisible(true);
    useUiStore.getState().setSidebarWidth(SIDEBAR_MAX_WIDTH);
    const resized = await bridge.setWindowSize(960, 600);
    check('冒烟可调整主窗口到最小尺寸', resized.ok, resized.error);
    await waitFor(() => (toolbarActions()?.clientWidth ?? 0) > 100, 5_000);
    const actionsRow = toolbarActions();
    check(
      '窄窗下工具栏不横向裁切（单行保持）',
      !!actionsRow && actionsRow.scrollWidth <= actionsRow.clientWidth + 1,
      `scroll=${actionsRow?.scrollWidth ?? -1} client=${actionsRow?.clientWidth ?? -1}`,
    );
    const moreButton = (): HTMLButtonElement | null =>
      document.querySelector<HTMLButtonElement>('[data-testid="toolbar-more"]');
    check('窄窗下出现「更多」溢出入口', !!moreButton());
    check(
      '窄窗下 AI 入口整体折叠（工具栏无 AI 触发器）',
      !document.querySelector('[data-testid="toolbar-entry-ai"]'),
    );

    moreButton()?.click();
    await sleep(250);
    check(
      '「更多」保留 AI 分组与全部 AI 子动作',
      !!document.querySelector('[data-testid="toolbar-more-group-ai"]') &&
        AI_ACTION_IDS.every(
          (id) => !!document.querySelector(`[data-testid="toolbar-menu-item-${CSS.escape(id)}"]`),
        ),
      menuItemIds().join(' | '),
    );
    const overflowGroups = [
      ...(document
        .querySelector('[data-testid="toolbar-more-menu"]')
        ?.querySelectorAll<HTMLElement>('[data-testid^="toolbar-more-group-"]') ?? []),
    ].map((el) => (el.dataset.testid ?? '').replace('toolbar-more-group-', ''));
    const reachable = new Set([
      ...rowEntryIds().filter((id) => id !== 'toolbar:more'),
      ...menuItemIds(),
      ...overflowGroups,
    ]);
    check(
      '全部动作在窄窗下可达（工具栏或「更多」）',
      BLOCK_TOOLBAR_ACTIONS.every((id) => reachable.has(id)),
      [...reachable].join(' | '),
    );
    await capture('02c-toolbar-overflow');

    // 键盘：焦点在「更多」上按 ↓ 打开并聚焦首项，逐项可达，Esc 关闭并回到触发器。
    const more = moreButton();
    more?.focus();
    more?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    await sleep(200);
    check(
      '「更多」以键盘打开并聚焦首项',
      document.activeElement?.getAttribute('role') === 'menuitem',
      document.activeElement?.getAttribute('data-testid') ?? '(none)',
    );
    let menuKeyboardWalk = true;
    for (let i = 0; i < BLOCK_TOOLBAR_ACTIONS.length; i += 1) {
      document
        .querySelector('[data-testid="toolbar-more-menu"]')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
        );
      await sleep(40);
      if (document.activeElement?.getAttribute('role') !== 'menuitem') menuKeyboardWalk = false;
    }
    check('「更多」菜单逐项键盘可达', menuKeyboardWalk);
    document
      .querySelector('[data-testid="toolbar-more-menu"]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    await sleep(200);
    check(
      'Esc 关闭「更多」并把焦点还给触发器',
      !document.querySelector('[data-testid="toolbar-more-menu"]') &&
        document.activeElement === more,
    );

    // 溢出动作真实执行：打开「更多」→ 点「双链」→ 当前编辑器插入 `[[` 骨架（随后撤销）。
    moreButton()?.click();
    await sleep(200);
    const overflowAction = BLOCK_TOOLBAR_ACTIONS.find(
      (id) => !rowEntryIds().includes(id) && menuItemIds().includes(id),
    );
    let overflowExecuted = false;
    if (overflowAction) {
      overflowExecuted = clickToolbarAction(overflowAction);
      await sleep(250);
      const kernel = getActiveEditor();
      overflowExecuted = overflowExecuted && !!kernel;
      kernel?.undo();
      await sleep(150);
      document
        .querySelector<HTMLElement>('[data-testid="editor-view"] .ProseMirror')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    check('溢出动作可从「更多」执行', overflowExecuted, overflowAction ?? '(none overflowed)');

    // 恢复：Dock 收起、侧栏宽度还原、窗口尺寸还原。
    useUiStore.getState().setDockVisible(false);
    useUiStore.getState().setSidebarWidth(260);
    await bridge.setWindowSize(REGULAR_WINDOW.width, REGULAR_WINDOW.height);
    await waitFor(
      () =>
        (toolbarActions()?.clientWidth ?? 0) > 500 &&
        !document.querySelector('[data-testid="toolbar-more"]'),
      8_000,
    );
    check(
      '恢复常规宽度后工具栏动作重新平铺',
      (toolbarActions()?.clientWidth ?? 0) > 500 &&
        !document.querySelector('[data-testid="toolbar-more"]'),
    );

    // ── 5. 文档格式边界：native-block 不进源码；markdown sidecar 才进源码 ──
    await invoke('fs:createNote', { parentDir: '', name: '原生模式边界页' });
    const nativeBoundary = await invoke('document:getMetadata', { path: '原生模式边界页.md' });
    check(
      '默认新建文档持久为 native-block',
      nativeBoundary?.format === 'native-block',
      JSON.stringify(nativeBoundary),
    );
    await openDocumentTab('原生模式边界页.md');
    check(
      'native-block 默认进入块编辑且源码入口不可见',
      (await waitFor(() => !!document.querySelector('[data-testid="editor-view"] .ProseMirror'))) &&
        !document.querySelector('[data-testid="source-mode-view"]') &&
        !document.querySelector('[data-testid="toolbar-entry-view:source"]'),
    );
    const nativeTab = useTabStore.getState().tabs.find((t) => t.pagePath === '原生模式边界页.md');
    const nativeModeBefore = nativeTab?.editorMode;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'e',
        [isMac ? 'metaKey' : 'ctrlKey']: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await sleep(250);
    check(
      'native-block 的 Cmd/Ctrl+E 被拒绝',
      !!document.querySelector('[data-testid="editor-view"] .ProseMirror') &&
        !document.querySelector('[data-testid="source-mode-view"]') &&
        useTabStore.getState().tabs.find((t) => t.id === nativeTab?.id)?.editorMode ===
          (nativeModeBefore ?? 'block'),
    );
    const nativeToggle = commandRegistry.get('editor.toggleSourceMode');
    nativeToggle?.run();
    await sleep(250);
    check(
      '命令面板源码命令对 native-block 不可用',
      !!document.querySelector('[data-testid="editor-view"] .ProseMirror') &&
        !document.querySelector('[data-testid="source-mode-view"]'),
    );

    const quirkyRaw =
      '---\n' +
      'title: 源码模式冒烟\n' +
      '---\n\n' +
      '# 源码模式冒烟 ^smokefix1\n\n' +
      '*  宽列表标记\n\n' +
      '行尾双空格   \n' +
      '硬换行后一行\n\n' +
      '~~~mermaid\ngraph TD\n  A --> B\n~~~\n\n' +
      '$$\nE = mc^2\n$$\n\n' +
      '划词格式化冒烟句\n\n' +
      '链接到[[源码模式跳转目标]]\n\n';
    await invoke('fs:createNote', {
      parentDir: '',
      name: '源码模式冒烟',
      content: quirkyRaw,
      format: 'markdown',
    });
    await invoke('fs:createNote', {
      parentDir: '',
      name: '源码模式跳转目标',
      content: '# 源码模式跳转目标\n\n目标页正文',
      format: 'markdown',
    });
    const markdownPath = '源码模式冒烟.md';
    const markdownMetadata = await invoke('document:getMetadata', { path: markdownPath });
    check(
      'Markdown sidecar 格式真实记录',
      markdownMetadata?.format === 'markdown',
      JSON.stringify(markdownMetadata),
    );
    await openDocumentTab(markdownPath);
    check(
      'Markdown 文档打开源码模式',
      (await waitFor(() => !!document.querySelector('[data-testid="source-mode-view"]'))) &&
        !!document.querySelector('[data-testid="source-editor-pane"] .cm-editor') &&
        !!document.querySelector('[data-testid="source-editor-pane"] .cm-content'),
    );
    check(
      'Markdown 属性 Popover 默认关闭且 YAML 从正文抽离（DEV-025）',
      (await waitFor(
        () => !!document.querySelector('[data-testid="document-properties-trigger"]'),
      )) &&
        !document.querySelector('[data-testid="frontmatter-panel"]') &&
        !(document.querySelector('[data-testid="source-editor-pane"]')?.textContent ?? '').includes(
          'title: 源码模式冒烟',
        ) &&
        (document.querySelector('[data-testid="source-editor-pane"]')?.textContent ?? '').includes(
          '# 源码模式冒烟',
        ),
    );
    document
      .querySelector<HTMLButtonElement>('[data-testid="document-properties-trigger"]')
      ?.click();
    check(
      '点击属性后打开面板且显示已有标准字段',
      (await waitFor(() => !!document.querySelector('[data-testid="frontmatter-panel"]'))) &&
        !!document.querySelector('[data-testid="frontmatter-field-title"]'),
    );
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    check(
      '属性 Popover 点击外部关闭',
      await waitFor(() => !document.querySelector('[data-testid="frontmatter-panel"]')),
    );
    document
      .querySelector<HTMLButtonElement>('[data-testid="document-properties-trigger"]')
      ?.click();
    await waitFor(() => !!document.querySelector('[data-testid="frontmatter-panel"]'));
    // 划词工具栏可见性改由下方 DEV-023 段在真实 GUI 中断言（选区 → body 挂载 → 按钮集 → Esc 隐藏）。

    check(
      'Markdown 源码 slash 菜单初始关闭（不以不存在 selector 假绿）',
      !document.querySelector('[data-testid="source-slash-menu"]') ||
        document.querySelector<HTMLElement>('[data-testid="source-slash-menu"]')?.style.display ===
          'none',
    );
    // 真正输入路径：源码菜单的稳定 selector 必须在 `/` 键入后出现，能过滤、键盘选择并消费。
    const initialSource = getActiveSourceEditor();
    const initialSourceDom = document.querySelector<HTMLElement>(
      '[data-testid="source-editor-pane"] .cm-content',
    );
    if (initialSource && initialSourceDom) {
      const slashStart = initialSource.view.state.doc.length;
      const slashCoords = initialSource.view.coordsAtPos(slashStart);
      const sourceClicked = slashCoords
        ? await bridge.clickAtPoint(Math.round(slashCoords.left), Math.round(slashCoords.top))
        : { ok: false, error: '源码 slash 光标坐标不可用' };
      const sourceTyped = sourceClicked.ok ? await bridge.typeText('/h2') : sourceClicked;
      const sourceSlashMenu = (): HTMLElement | null =>
        document.querySelector<HTMLElement>('[data-testid="source-slash-menu"]');
      const sourceSlashItem = (): HTMLElement | null =>
        sourceSlashMenu()?.querySelector<HTMLElement>('[data-slash-item="block:heading:2"]') ??
        null;
      const sourceSlashOpen = await waitFor(
        () =>
          !!sourceSlashMenu() &&
          sourceSlashMenu()?.getAttribute('role') === 'listbox' &&
          sourceSlashMenu()?.getAttribute('aria-label') === '快捷插入动作' &&
          sourceSlashMenu()?.style.display !== 'none' &&
          !!sourceSlashItem() &&
          sourceSlashItem()?.getAttribute('aria-selected') === 'true',
      );
      const sourceSelected = sourceSlashOpen ? await bridge.pressKey('ArrowDown') : null;
      await bridge.pressKey('ArrowUp');
      const sourceConfirmed = sourceSelected ? await bridge.pressKey('Enter') : null;
      await sleep(150);
      const sourceSlashResult = initialSource.view.state.doc.toString();
      check(
        'Markdown 真实键入 /：菜单可见、可键盘选择、消费触发词并写入 H2',
        sourceTyped.ok &&
          sourceSelected?.ok === true &&
          sourceConfirmed?.ok === true &&
          sourceSlashOpen &&
          !sourceSlashResult.includes('/h2') &&
          sourceSlashResult.endsWith('## ') &&
          sourceSlashMenu()?.style.display === 'none',
        sourceSlashResult.slice(-48),
      );
    } else {
      check('Markdown 真实键入 /：源码编辑器已挂载', false);
    }
    check(
      '右侧只读 Live Preview 渲染正文',
      (await waitFor(
        () => !!document.querySelector('[data-testid="live-preview"] .ProseMirror'),
      )) &&
        document
          .querySelector('[data-testid="live-preview"] .ProseMirror')
          ?.getAttribute('contenteditable') === 'false' &&
        (
          document.querySelector('[data-testid="live-preview"] .ProseMirror')?.textContent ?? ''
        ).includes('源码模式冒烟'),
    );
    check(
      '预览渲染 Mermaid、KaTeX 与 Wikilink',
      (await waitFor(() => !!document.querySelector('[data-testid="live-preview"] svg'), 15_000)) &&
        (await waitFor(
          () =>
            document.querySelectorAll(
              '[data-testid="live-preview"] .katex, [data-testid="live-preview"] .nexnote-math-view',
            ).length >= 1,
          15_000,
        )) &&
        !!document.querySelector('[data-testid="live-preview"] [data-wikilink-target]'),
    );
    const untouched = await invoke('fs:readTextFile', { path: markdownPath });
    check(
      '打开 Markdown 源码不写盘（字节不变）',
      untouched === `${quirkyRaw}\n`,
      untouched.slice(0, 60),
    );
    await capture('03-source-mode');

    // ── DEV-023 源码划词工具栏：真实 Chromium 可见性（回归用户报告）──────────
    // 非空选区后，body 挂载的工具栏必须出现且带完整按钮集；Esc 隐藏。
    const bubbleEl = (): HTMLElement | null =>
      document.querySelector<HTMLElement>('[data-source-selection-bubble]');
    const sourceHandle = getActiveSourceEditor();
    if (sourceHandle) {
      const text0 = sourceHandle.view.state.doc.toString();
      const at0 = text0.indexOf('划词格式化冒烟句');
      if (at0 >= 0) {
        sourceHandle.view.dispatch({
          selection: { anchor: at0, head: at0 + '划词格式化冒烟句'.length },
        });
      }
    }
    check(
      'md 非空选区后划词工具栏出现在 body（真实 GUI）',
      await waitFor(() => {
        const el = bubbleEl();
        return (
          !!el &&
          el.parentElement === document.body &&
          el.style.display !== 'none' &&
          el.offsetWidth > 0 &&
          // DEV-034：平铺动作 = 格式化五项 + 双链 + AI 下拉入口 +（隐藏的）停止控件
          el.querySelectorAll('[data-bubble-action]').length >= 7 &&
          !!el.querySelector('[data-bubble-action="ai:menu"]') &&
          el.querySelectorAll('[data-ai-menu-action]').length >= 7
        );
      }, 5_000),
      `el=${!!bubbleEl()} onBody=${bubbleEl()?.parentElement === document.body} display=${bubbleEl()?.style.display ?? '?'} w=${bubbleEl()?.offsetWidth ?? 0} buttons=${bubbleEl()?.querySelectorAll('[data-bubble-action]').length ?? 0} bodyKids=${[
        ...document.body.children,
      ]
        .slice(0, 12)
        .map((el) => el.tagName + '.' + String(el.className || '').slice(0, 24))
        .join(
          '|',
        )} ds=${JSON.stringify(document.documentElement.dataset)} classes=${document.querySelectorAll('.nexnote-selection-bubble').length}`,
    );
    await capture('22-md-selection-bubble');

    // ── DEV-034 源码模式 AI 下拉：键盘开合 + 动作集一致 + 独立停止控件 ─────────
    const sourceTrigger = (): HTMLButtonElement | null =>
      bubbleEl()?.querySelector<HTMLButtonElement>('[data-bubble-action="ai:menu"]') ?? null;
    const sourceMenu = (): HTMLElement | null =>
      bubbleEl()?.querySelector<HTMLElement>('[data-ai-menu]') ?? null;
    const aiMenuIds = (): string[] =>
      Array.from(bubbleEl()?.querySelectorAll<HTMLElement>('[data-ai-menu-action]') ?? []).map(
        (el) => el.dataset.aiMenuAction ?? '',
      );

    sourceTrigger()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    await sleep(150);
    check(
      'md AI 下拉键盘打开：菜单可见、动作集为六写作 + 询问 AI、含快捷键提示',
      sourceMenu()?.hidden === false &&
        sourceTrigger()?.getAttribute('aria-expanded') === 'true' &&
        aiMenuIds().join(',') ===
          'ai:rewrite,ai:polish,ai:condense,ai:expand,ai:fillgaps,ai:evidence,chat:ask-selection,translate:selection,translate:workbench' &&
        (sourceMenu()?.textContent ?? '').includes('⌘⌥R'),
    );
    const sourceAiMenuItem = sourceMenu()?.querySelector<HTMLElement>('[data-ai-menu-action]');
    sourceAiMenuItem?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await sleep(150);
    check(
      'md AI 下拉 Esc 关闭菜单、工具栏与选区保持；停止控件未生成时隐藏',
      sourceMenu()?.hidden === true &&
        bubbleEl()?.style.display !== 'none' &&
        (bubbleEl()?.querySelector<HTMLButtonElement>('[data-testid="bubble-stop"]')?.hidden ??
          false) === true,
    );
    await capture('22b-md-ai-dropdown');

    const bubbleShown = !!bubbleEl() && bubbleEl()!.style.display !== 'none';
    if (bubbleShown) {
      // Esc 监听挂在编辑器根 DOM（view.dom），与单测路径一致。
      sourceHandle?.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await sleep(200);
      check('md 划词工具栏 Esc 隐藏', !bubbleEl() || bubbleEl()!.style.display === 'none');
    }

    // ── DEV-023 源码划词格式化/双链写回（真实 Chromium：单事务 + 防抖逐字节写盘）──
    // 写回/undo/落盘经同一动作入口 applySourceFormat 验证（按钮集可见性由上方真实断言覆盖）。
    check('源码编辑器句柄已注册', !!sourceHandle?.view);
    if (sourceHandle) {
      const sourceView = sourceHandle.view;
      const selectSentence = () => {
        const text = sourceView.state.doc.toString();
        const at = text.indexOf('划词格式化冒烟句');
        if (at < 0) return false;
        sourceView.dispatch({
          selection: { anchor: at, head: at + '划词格式化冒烟句'.length },
        });
        return true;
      };
      check(
        'md 划词加粗写回 **…**（单事务）',
        selectSentence() &&
          applySourceFormat(sourceView, 'format:bold') === true &&
          sourceView.state.doc.toString().includes('**划词格式化冒烟句**'),
      );
      check(
        'md 划词加粗单次 undo 整体撤销',
        undo(sourceView) === true && !sourceView.state.doc.toString().includes('**'),
      );
      check(
        'md 划词双链插入 [[…]]',
        selectSentence() &&
          applySourceFormat(sourceView, 'format:wikilink') === true &&
          sourceView.state.doc.toString().includes('[[划词格式化冒烟句]]'),
      );
      await sleep(2_000); // 源码防抖保存 + IPC 写盘
      const formattedSaved = await invoke('fs:readTextFile', { path: markdownPath });
      check(
        'md 格式化/双链写回防抖保存到盘',
        formattedSaved.includes('[[划词格式化冒烟句]]'),
        formattedSaved.slice(0, 80),
      );
    }

    // Markdown 的 Mod+E（editor.toggleSourceMode）在源码/分栏之间切换，不切换为 TipTap。
    // 断言只经真实快捷键与可见 DOM：视图切换有 flush 守卫，异步落点必须等它稳定，
    // 否则随后的态切换会与仍在飞行中的切换互相覆盖（本轮 packaged 失败即此竞态）。
    const markdownTabId = useTabStore.getState().activeTabId;
    const markdownViewNow = (): string | undefined =>
      useTabStore.getState().tabs.find((tab) => tab.id === markdownTabId)?.markdownView;
    const markdownToggleKey = (): void => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'e',
          [isMac ? 'metaKey' : 'ctrlKey']: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    // 归一化到分栏，避免继承上一步的视图状态。
    clickToolbarAction('view:split');
    await waitFor(
      () =>
        markdownViewNow() === 'split' && !!document.querySelector('[data-testid="live-preview"]'),
    );
    markdownToggleKey();
    const previewHidden = await waitFor(
      () =>
        markdownViewNow() === 'source' &&
        !document.querySelector('[data-testid="live-preview"]') &&
        !!document.querySelector('[data-testid="source-editor-pane"] .cm-content'),
    );
    check(
      'Markdown Cmd/Ctrl+E 隐藏预览但保持源码',
      previewHidden,
      `view=${markdownViewNow()} preview=${!!document.querySelector('[data-testid="live-preview"]')}`,
    );
    markdownToggleKey();
    check(
      'Markdown Cmd/Ctrl+E 恢复双栏预览',
      await waitFor(
        () =>
          markdownViewNow() === 'split' &&
          !!document.querySelector('[data-testid="live-preview"]') &&
          !!document.querySelector('[data-testid="source-editor-pane"] .cm-content'),
      ),
      `view=${markdownViewNow()}`,
    );

    const toggleCommand = commandRegistry.get('editor.toggleSourceMode');
    check('源码命令已注册且由 Markdown 承载预览切换', !!toggleCommand?.run);
    toggleCommand?.run();
    await sleep(150);
    check(
      '命令面板源码命令不离开 Markdown 源码模式',
      (await waitFor(() => !document.querySelector('[data-testid="live-preview"]'))) &&
        !!document.querySelector('[data-testid="source-mode-view"]'),
    );
    toggleCommand?.run();
    await sleep(150);
    check(
      '命令面板源码命令恢复 Markdown 双栏',
      (await waitFor(() => !!document.querySelector('[data-testid="live-preview"]'))) &&
        !!document.querySelector('[data-testid="source-mode-view"]'),
    );

    const cmContent = document.querySelector<HTMLElement>(
      '[data-testid="source-editor-pane"] .cm-content',
    );
    check('Markdown CodeMirror 可聚焦', !!cmContent);
    if (cmContent) {
      cmContent.focus();
      document.execCommand('selectAll');
      const markdownRenamedRaw = '# 源码模式改名页\n\n链接到[[源码模式跳转目标]]\n';
      document.execCommand('insertText', false, markdownRenamedRaw);
      await sleep(2_000);
      const renamedSaved = await invoke('fs:readTextFile', { path: '源码模式改名页.md' });
      check(
        'Markdown 防抖保存逐字节写回正文且保留 YAML 头（DEV-025）',
        renamedSaved === `---\ntitle: 源码模式冒烟\n---\n\n${markdownRenamedRaw}`,
        renamedSaved.slice(0, 80),
      );
      check(
        'Markdown H1 改名同步页面树与 Tab',
        (await waitFor(() => !!treeRow('源码模式改名页.md') && !treeRow(markdownPath), 15_000)) &&
          useTabStore.getState().tabs.find((t) => t.pagePath === '源码模式改名页.md')?.title ===
            '源码模式改名页',
      );
      const wikilinkReady = await waitFor(
        () => !!document.querySelector('[data-testid="live-preview"] [data-wikilink-target]'),
        15_000,
      );
      if (!wikilinkReady && !document.querySelector('[data-testid="live-preview"]')) {
        clickToolbarAction('view:split');
        await waitFor(() => !!document.querySelector('[data-testid="live-preview"]'));
      }
      document
        .querySelector<HTMLElement>('[data-testid="live-preview"] [data-wikilink-target]')
        ?.click();
      check(
        'Markdown 预览 Wikilink 导航仍保持源码模式',
        await waitFor(() => {
          const active = useTabStore
            .getState()
            .tabs.find((t) => t.id === useTabStore.getState().activeTabId);
          return (
            active?.pagePath === '源码模式跳转目标.md' &&
            active.editorMode === 'source' &&
            !!document.querySelector('[data-testid="source-mode-view"]')
          );
        }),
      );
    }
    const markdownTarget = useTabStore
      .getState()
      .tabs.find((t) => t.pagePath === '源码模式跳转目标.md');
    if (markdownTarget) useTabStore.getState().closeTab(markdownTarget.id);
    await openDocumentTab('源码模式改名页.md');
    check(
      'Markdown 关闭重开仍为源码模式',
      (await waitFor(() => !!document.querySelector('[data-testid="source-mode-view"]'))) &&
        !!document.querySelector('[data-testid="source-editor-pane"] .cm-content'),
    );
    await capture('04-source-mode-reset');

    // ── 5a. DEV-029 代码块高亮：代表语言在源码围栏与块渲染均高亮 ──────────
    // 源码围栏：Dockerfile / TOML / PowerShell 走统一覆盖清单（懒加载语法）。
    const sourceHighlightRaw =
      '# 高亮冒烟\n\n' +
      '```dockerfile\nFROM node:22\nRUN echo hi\n```\n\n' +
      '```toml\n[server]\nport = 8080\n```\n\n' +
      '```powershell\nWrite-Host "hi"\n```\n';
    await invoke('fs:createNote', {
      parentDir: '',
      name: '语法高亮冒烟',
      content: sourceHighlightRaw,
      format: 'markdown',
    });
    await openDocumentTab('语法高亮冒烟.md');
    const sourceTokens = (): number =>
      document.querySelectorAll('[data-testid="source-editor-pane"] .cm-content [class*="hljs-"]')
        .length;
    check(
      'DEV-029 源码围栏按需加载语法并高亮（Dockerfile/TOML/PowerShell）',
      (await waitFor(
        () => !!document.querySelector('[data-testid="source-editor-pane"] .cm-editor'),
      )) && (await waitFor(() => sourceTokens() >= 3, 15_000)),
      `tokens=${sourceTokens()}`,
    );
    await capture('04a-source-highlight');
    const highlightTab = useTabStore.getState().tabs.find((t) => t.pagePath === '语法高亮冒烟.md');
    if (highlightTab) useTabStore.getState().closeTab(highlightTab.id);
    await sleep(200);

    // 未知语言：降级纯文本，无 token。
    await invoke('fs:createNote', {
      parentDir: '',
      name: '未知语言降级冒烟',
      content: '# 未知语言\n\n```foo\nsome code\n```\n',
      format: 'markdown',
    });
    await openDocumentTab('未知语言降级冒烟.md');
    check(
      'DEV-029 未知语言 ```foo 降级纯文本（无高亮 token）',
      (await waitFor(
        () => !!document.querySelector('[data-testid="source-editor-pane"] .cm-content'),
      )) && sourceTokens() === 0,
      `tokens=${sourceTokens()}`,
    );
    const unknownTab = useTabStore
      .getState()
      .tabs.find((t) => t.pagePath === '未知语言降级冒烟.md');
    if (unknownTab) useTabStore.getState().closeTab(unknownTab.id);
    await sleep(200);

    // 块渲染：native-block 文档内的围栏代码块同样高亮。
    await invoke('fs:createNote', {
      parentDir: '',
      name: '块高亮冒烟',
      content:
        '# 块高亮\n\n```dockerfile\nFROM node:22\nRUN echo hi\n```\n\n```toml\nport = 8080\n```\n',
      format: 'native-block',
    });
    await openDocumentTab('块高亮冒烟.md');
    const blockTokens = (): number =>
      document.querySelectorAll('[data-testid="editor-view"] .ProseMirror [class*="hljs-"]').length;
    check(
      'DEV-029 块渲染懒加载语言高亮（Dockerfile/TOML）',
      (await waitFor(() => !!document.querySelector('[data-testid="editor-view"] .ProseMirror'))) &&
        (await waitFor(() => blockTokens() >= 2, 15_000)),
      `tokens=${blockTokens()}`,
    );
    await capture('04b-block-highlight');

    // ── 5b. DEV-025 字段目录：6 标准字段可见（DEV-080 移除 type）、已添加禁用、面板写回 YAML 头 ──
    // 前一场景打开的是 native-block 代码高亮页；字段目录只属于 Markdown 源码页。
    await openDocumentTab('源码模式改名页.md');
    await waitFor(
      () =>
        useTabStore.getState().tabs.find((t) => t.id === useTabStore.getState().activeTabId)
          ?.pagePath === '源码模式改名页.md' &&
        !!document.querySelector('[data-testid="source-mode-view"] .cm-content') &&
        !!document.querySelector('[data-testid="document-properties-trigger"]'),
    );
    // 按需 Popover 需显式打开才能访问字段目录。
    document
      .querySelector<HTMLButtonElement>('[data-testid="document-properties-trigger"]')
      ?.click();
    await waitFor(() => !!document.querySelector('[data-testid="frontmatter-panel"]'));
    document.querySelector<HTMLButtonElement>('[data-testid="add-field-trigger"]')?.click();
    check(
      '字段目录打开：6 个标准字段全部可见',
      (await waitFor(() => !!document.querySelector('[data-testid="field-catalog"]'))) &&
        document.querySelectorAll('[data-testid="field-catalog-item"]').length === 6,
    );
    const titleReady = await waitFor(() => {
      const item = document.querySelector<HTMLButtonElement>(
        '[data-testid="field-catalog-item"][data-field="title"]',
      );
      return item?.disabled === true && (item.textContent ?? '').includes('已添加');
    });
    const catalogTitleItem = document.querySelector<HTMLButtonElement>(
      '[data-testid="field-catalog-item"][data-field="title"]',
    );
    check(
      '已添加标准字段禁用并标「已添加」',
      titleReady,
      catalogTitleItem?.textContent ?? 'missing',
    );
    check(
      '字段行 hover 说明 tooltip 与目录集中定义一致',
      (
        document
          .querySelector('[data-testid="field-catalog-item"][data-field="confidence"]')
          ?.getAttribute('title') ?? ''
      ).includes('Git'),
    );
    document
      .querySelector<HTMLButtonElement>('[data-testid="field-catalog-item"][data-field="tags"]')
      ?.click();
    await sleep(2_500); // 面板 onChange → 防抖保存
    const withTags = await invoke('fs:readTextFile', { path: '源码模式改名页.md' });
    check(
      '面板添加标准字段写回 YAML 头且正文字节不动',
      withTags.startsWith('---\ntitle: 源码模式冒烟\ntags: []\n---') &&
        withTags.endsWith('# 源码模式改名页\n\n链接到[[源码模式跳转目标]]\n'),
      withTags.slice(0, 100),
    );
    await capture('21-md-field-catalog');
    // 属性编辑验收完成后关闭 Popover，恢复正文编辑焦点，避免影响后续源码补全场景。
    document
      .querySelector<HTMLButtonElement>('[data-testid="document-properties-trigger"]')
      ?.click();
    await waitFor(() => !document.querySelector('[data-testid="frontmatter-panel"]'));

    // ── 5b. DEV-024：Markdown 源码 `[[` 补全 + 反链角标 ───────
    const completionCm = document.querySelector<HTMLElement>(
      '[data-testid="source-editor-pane"] .cm-content',
    );
    const completionView = getActiveSourceEditor()?.view ?? null;
    check('源码补全：CodeMirror 可聚焦', !!completionCm && !!completionView);
    if (completionCm && completionView) {
      // 候选数据源 = 页面树 entries；runner 上 fs:changed 驱动的树刷新存在延迟，
      // 直接补全会拿到空候选并级联失败。显式重载树，并把就绪作为硬门禁。
      if (!usePageTreeStore.getState().entries.some((e) => e.path === '源码模式跳转目标.md')) {
        await usePageTreeStore.getState().load();
      }
      const candidatesReady = await waitFor(
        () => currentPageCandidates().some((page) => page.title === '源码模式跳转目标'),
        15_000,
      );
      check('源码补全候选就绪（页面树含目标页）', candidatesReady);
      completionCm.focus();
      // 经真实 EditorView 事务写回：execCommand('insertText') 在 CI runner 上
      // 不保证触发 CodeMirror 变更事件，导致补全源拿不到查询词。
      const opening = '# 源码模式改名页\n\n链接到[[';
      completionView.dispatch({
        changes: { from: 0, to: completionView.state.doc.length, insert: opening },
        selection: { anchor: opening.length },
        // CodeMirror autocompletion 只对 input.* 用户事件触发；纯程序事务不会开候选。
        userEvent: 'input.type',
      });
      const tooltipOpen = await waitFor(
        () => !!document.querySelector('.cm-tooltip-autocomplete li'),
        30_000,
      );
      // 空查询只验证候选菜单出现；具体目标页命中由下一步过滤词断言验证，
      // 避免依赖页面树返回顺序与前 8 项截断。
      check('源码模式输入 [[ 弹出页面候选', tooltipOpen);
      await capture('05b-source-wikilink-completion');
      completionCm.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      check(
        'Esc 关闭补全且不改动文本',
        (await waitFor(() => !document.querySelector('.cm-tooltip-autocomplete'))) &&
          !completionCm.textContent?.includes('源码模式跳转目标]]'),
      );
      completionView.dispatch({
        changes: { from: completionView.state.doc.length, insert: '源码模式跳转目标' },
        selection: { anchor: completionView.state.doc.length + '源码模式跳转目标'.length },
        userEvent: 'input.type',
      });
      const filteredOpen = await waitFor(() => {
        const first = document.querySelector('.cm-tooltip-autocomplete li');
        return !!first && (first.textContent ?? '').includes('源码模式跳转目标');
      });
      check('过滤词命中既有页面候选（置顶）', filteredOpen);
      // CodeMirror autocomplete 打开后有 75ms interaction delay，真实用户打字间隔
      // 远大于此；smoke 的合成键需显式等待门限，避免 Enter 被当作普通换行。
      await sleep(180);
      completionCm.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      await sleep(300);

      // 红链候选：未创建页面 → 回车创建并出现在页面树
      const redlink = '\n\n红链 [[冒烟红链页';
      completionView.dispatch({
        changes: { from: completionView.state.doc.length, insert: redlink },
        selection: { anchor: completionView.state.doc.length + redlink.length },
        userEvent: 'input.type',
      });
      const redlinkOpen = await waitFor(() =>
        [...(document.querySelectorAll('.cm-tooltip-autocomplete li') ?? [])].some((li) =>
          (li.textContent ?? '').includes('创建新页面'),
        ),
      );
      check('未命中页面出现「创建新页面」红链候选', redlinkOpen);
      await sleep(180);
      completionCm.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      await sleep(2_000);
      const completionSaved = await invoke('fs:readTextFile', { path: '源码模式改名页.md' });
      check(
        '源码补全确认写入 [[页面]] 与 [[红链]] 且防抖落盘',
        completionSaved.includes('[[源码模式跳转目标]]') &&
          completionSaved.includes('[[冒烟红链页]]'),
        completionSaved.slice(0, 80),
      );
      check(
        '红链回车创建页面并出现在页面树',
        (await waitFor(() => !!treeRow('冒烟红链页.md'), 15_000)) &&
          (await invoke('fs:exists', { path: '冒烟红链页.md' })),
      );

      // 反链角标：默认面板不变（页面树），角标只随激活文档出现
      check(
        '补全/角标不改变默认面板（仍为页面树）',
        !!document.querySelector('[data-testid="sidebar-panel-pages"]') &&
          !document.querySelector('[data-testid="sidebar-panel-backlinks"]'),
      );
      await openDocumentTab('源码模式跳转目标.md');
      const badgeOf = (): string | null =>
        document.querySelector<HTMLElement>('[data-testid="sidebar-backlink-badge"]')
          ?.textContent ?? null;
      check(
        '打开有反链文档：角标出现且为 1',
        (await waitFor(() => badgeOf() === '1', 15_000)) &&
          !!document.querySelector('[data-testid="sidebar-panel-pages"]'),
        `badge=${badgeOf()}`,
      );
      await capture('05b-backlink-badge');
      useUiStore.getState().setActiveSidebarPanel('backlinks');
      await sleep(400);
      const badgeCount = Number.parseInt(badgeOf() ?? '0', 10);
      check(
        '角标数字与反链面板列表条目数一致',
        document.querySelectorAll('[data-testid="backlink-item"]').length === badgeCount,
        `items=${document.querySelectorAll('[data-testid="backlink-item"]').length} badge=${badgeCount}`,
      );
      useUiStore.getState().setActiveSidebarPanel('pages');
      await sleep(200);
      await openDocumentTab('冒烟红链页.md');
      check(
        '无反链文档不显示角标；切 tab 角标跟随更新',
        (await waitFor(() => badgeOf() === null, 15_000)) &&
          (await openDocumentTab('源码模式跳转目标.md'), true) &&
          (await waitFor(() => badgeOf() === '1', 15_000)),
      );
    }

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
    check(
      '⌘K 面板无「打开 Vault 文件浏览」命令（DEV-021）',
      commandRegistry.get('tab.files') === undefined,
    );

    // ── DEV-037 冒烟清理：删除临时 mock Profile，恢复「未配置」状态 ──
    // 上方 DEV-037 段落为写作流式配置了 Profile；DEV-026 段断言的是「未配置」空态，
    // 必须在进入该段前把 AI 配置恢复为初始状态。
    if (smokeProfileId) {
      await invoke('ai:profile:delete', { id: smokeProfileId });
      smokeProfileId = null;
      await sleep(150);
    }

    // ── 6b. AI 配置入口收口（DEV-026）：未配置入口统一跳设置页 ──
    useUiStore.getState().setDockVisible(true);
    check(
      '右栏 AI 空态出现（未配置）',
      await waitFor(() => !!document.querySelector('[data-testid="ai-dock-empty"]')),
    );
    document.querySelector<HTMLButtonElement>('[data-testid="ai-dock-configure"]')?.click();
    check(
      '右栏配置按钮跳转设置页 AI 分区',
      (await waitFor(() => !!document.querySelector('[data-testid="settings-section-ai"]'))) &&
        !document.querySelector('[data-testid="ai-wizard"]'),
    );
    await capture('19-ai-settings-entry');
    const aiNav = document.querySelector('[data-testid="settings-nav-ai"]');
    check(
      '设置页导航高亮 AI 供应商分区',
      !!aiNav && (aiNav.getAttribute('class') ?? '').includes('bg-accent'),
    );
    check('旧 ai.setup 命令已并入 ai.settings', commandRegistry.get('ai.setup') === undefined);
    // ⌘K 正向路径：搜索并执行「AI 供应商设置」同样落在设置页 AI 分区
    const settingsTabNow = useTabStore.getState().tabs.find((t) => t.kind === 'settings');
    if (settingsTabNow) useTabStore.getState().closeTab(settingsTabNow.id);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }),
    );
    const paletteInput = document.querySelector<HTMLInputElement>('[data-testid="palette-input"]');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (paletteInput && valueSetter) {
      valueSetter.call(paletteInput, 'AI 供应商');
      paletteInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await waitFor(() => document.querySelectorAll('[data-testid="palette-item"]').length > 0);
    const aiCmd = [...document.querySelectorAll('[data-testid="palette-item"]')].find((el) =>
      el.textContent?.includes('AI 供应商设置'),
    );
    check('⌘K 可搜到 AI 供应商设置命令', !!aiCmd);
    // 直接点击目标条目，避免 Enter 执行过滤列表中的第一条（可能为其他 AI 命令）。
    aiCmd?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    check(
      '⌘K 执行 AI 设置命令跳转设置页 AI 分区',
      await waitFor(() => !!document.querySelector('[data-testid="settings-section-ai"]')),
    );
    // 收尾：关闭设置 tab 并收起 dock，避免影响后续用例
    const tabsNow = useTabStore.getState().tabs;
    const settingsTab = tabsNow.find((t) => t.kind === 'settings');
    if (settingsTab) useTabStore.getState().closeTab(settingsTab.id);
    useUiStore.getState().setDockVisible(false);
    await sleep(200);

    // ── 7. 亮/暗主题 ─────────────────────────────────────────
    useThemeStore.getState().setPreference('dark');
    await sleep(300);
    const darkOn = document.documentElement.classList.contains('dark');
    check('暗色主题生效（CSS 变量切换）', darkOn && useThemeStore.getState().resolved === 'dark');
    await capture('05-dark');

    // 真实 Chromium DOM 验证源码模式的两种 caret 均消费 --foreground，且主题切换不重建编辑器。
    await openDocumentTab('源码模式改名页.md');
    const sourceCaretReady = await waitFor(
      () => !!document.querySelector('[data-testid="source-editor-pane"] .cm-content'),
    );
    const cmEditorDark = document.querySelector<HTMLElement>(
      '[data-testid="source-editor-pane"] .cm-editor',
    );
    const cmContentDark = document.querySelector<HTMLElement>(
      '[data-testid="source-editor-pane"] .cm-content',
    );
    const cursorProbe = document.createElement('span');
    cursorProbe.className = 'cm-cursor';
    cmEditorDark?.append(cursorProbe);
    const darkForeground = getComputedStyle(document.body).color;
    const darkCaret = cmContentDark ? getComputedStyle(cmContentDark).caretColor : '';
    const darkCursorBorder = getComputedStyle(cursorProbe).borderLeftColor;
    check(
      '暗色源码模式 caret 跟随 --foreground（原生 caret 与 .cm-cursor 一致）',
      sourceCaretReady && darkCaret === darkForeground && darkCursorBorder === darkForeground,
      `caret=${darkCaret} cursor=${darkCursorBorder} foreground=${darkForeground}`,
    );

    useThemeStore.getState().setPreference('light');
    await sleep(300);
    const cmContentLight = document.querySelector<HTMLElement>(
      '[data-testid="source-editor-pane"] .cm-content',
    );
    const lightForeground = getComputedStyle(document.body).color;
    const lightCaret = cmContentLight ? getComputedStyle(cmContentLight).caretColor : '';
    const lightCursorBorder = getComputedStyle(cursorProbe).borderLeftColor;
    check(
      '主题切换后 caret 随之变化且 CodeMirror 未重建',
      document.querySelector('[data-testid="source-editor-pane"] .cm-editor') === cmEditorDark &&
        lightCaret === lightForeground &&
        lightCursorBorder === lightForeground &&
        lightCaret !== darkCaret,
      `dark=${darkCaret} light=${lightCaret} foreground=${lightForeground}`,
    );
    cursorProbe.remove();

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

    // ── 9. IPC 文件能力（fs:listDir 真实数据，锚定页面树）────
    // DEV-021：FilesPage 占位页与 files tab 已删除，改锚侧栏页面树。
    const rootEntries = await invoke('fs:listDir', { path: '' });
    check(
      'fs:listDir 经 IPC 返回知识库内容',
      rootEntries.some((entry) => entry.path === '.nexnote'),
      rootEntries
        .slice(0, 5)
        .map((entry) => entry.path)
        .join(','),
    );
    check(
      '页面树常驻侧栏（文件浏览入口不受占位页删除影响）',
      !!document.querySelector('[data-testid="tree-search-input"]'),
    );

    // ── 9.5 DEV-003 页面树与文件操作 ─────────────────────
    // 新建笔记（IPC）→ fs:changed 事件回流 → 树出现 + tab 打开（带 frontmatter）
    await invoke('fs:createNote', { parentDir: '', name: '冒烟首页' });
    openPage('冒烟首页.md');
    check('新建笔记：树实时出现（fs:changed 驱动）', await waitFor(() => !!treeRow('冒烟首页.md')));
    check(
      '新建笔记：文件名只在 Tab 显示（工具栏无独立文件名）',
      await waitFor(() => {
        const editor = document.querySelector(
          '[data-testid="editor-view"][data-path="冒烟首页.md"]',
        );
        const toolbar = editor?.querySelector('[data-testid="editor-toolbar"]');
        const tab = document.querySelector('[data-testid="tab"][data-page-path="冒烟首页.md"]');
        return (
          !!editor &&
          !!toolbar &&
          !(toolbar.textContent ?? '').includes('冒烟首页.md') &&
          (tab?.textContent ?? '').includes('冒烟首页')
        );
      }),
    );
    const createdDocumentMetadata = await invoke('document:getMetadata', {
      path: '冒烟首页.md',
    });
    const createdDocumentText = await invoke('fs:readTextFile', { path: '冒烟首页.md' });
    check(
      '新建 Markdown 保持正文干净、产品 metadata 在 sidecar',
      !createdDocumentText.trimStart().startsWith('---') &&
        !/^created\s*:/m.test(createdDocumentText) &&
        !/^id\s*:/m.test(createdDocumentText) &&
        typeof createdDocumentMetadata?.id === 'string' &&
        typeof createdDocumentMetadata?.createdAt === 'string',
      JSON.stringify({
        text: createdDocumentText.slice(0, 120),
        metadata: createdDocumentMetadata,
      }),
    );
    check(
      '状态栏显示 vault 根名',
      (document.querySelector('[data-testid="status-vault"]')?.textContent ?? '').includes(
        'smoke-vault',
      ),
    );
    await capture('09-page-tree');

    // 外部进程写文件（主进程直接落盘，不经 fs IPC）→ chokidar 同步
    // H1 与文件名保持一致，避免 H1→文件名绑定在打开时自动重命名 fixture
    const ext = await bridge.writeFile(created.root, '研究/外部笔记.md', '# 外部笔记\n\n#inbox');
    check('外部写入成功', ext.ok, ext.error);
    check(
      '外部创建文件实时反映到树（含目录自动创建）',
      await waitFor(() => !!treeRow('研究/外部笔记.md'), 15000),
    );

    // 搜索过滤
    const search = document.querySelector<HTMLInputElement>('[data-testid="tree-search-input"]');
    const nativeInputSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
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
      visibleFileRows.length === 1 &&
        visibleFileRows[0]?.getAttribute('data-path') === '研究/外部笔记.md',
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
    await bridge.writeFile(
      created.root,
      'frontmatter标签.md',
      '---\ntags:\n  - 冒烟专用\n---\n\n# frontmatter标签',
    );
    // chokidar→applyEvent 的防抖重扫有 600ms 窗口；显式重扫保证聚合判定确定性
    await useTagStore.getState().load();
    // 切换到「标签」面板（chip 只有面板挂载时才会出现在 DOM）
    useUiStore.getState().setActiveSidebarPanel('tags');
    check(
      '标签面板聚合 frontmatter + 内联标签（计数=2）',
      await waitFor(() => {
        const chip = document.querySelector('[data-testid="tag-node"][data-tag="冒烟专用"]');
        return !!chip && chip.textContent?.includes('2');
      }, 15000),
    );
    await capture('10-tags');
    // 点击标签 → 过滤树
    (
      document.querySelector(
        '[data-testid="tag-node"][data-tag="冒烟专用"]',
      ) as HTMLButtonElement | null
    )?.click();
    await sleep(400);
    // 切回页面面板查看过滤效果
    useUiStore.getState().setActiveSidebarPanel('pages');
    await sleep(250);
    const tagFilteredRows = [
      ...document.querySelectorAll('[data-testid="tree-row"][data-kind="file"]'),
    ];
    check(
      '点击标签过滤页面树（仅含标签页面 + 过滤 chip）',
      tagFilteredRows.length === 2 &&
        !!document.querySelector('[data-testid="tree-tag-filter-chip"]'),
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
    // 先打开「外部笔记」tab，再经真实 UI 入口重命名：flush 所有编辑器 → renameLinked → 树即时联动。
    openPage('研究/外部笔记.md');
    await sleep(300);
    check(
      '当前打开页面在树中显示激活态（data-active）',
      treeRow('研究/外部笔记.md')?.getAttribute('data-active') === 'true',
    );
    // 真实 UI 链路：右键 → 重命名 → 逐字输入（每个字符后不得被重新全选覆盖）→ Enter 提交。
    treeRow('研究/外部笔记.md')?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 24, clientY: 24 }),
    );
    const renameMenuOpen = await waitFor(
      () => !!document.querySelector('[data-testid="tree-context-menu"]'),
    );
    const renameMenuBtn = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="tree-context-menu"] [role="menuitem"]',
      ),
    ].find((btn) => (btn.textContent ?? '').includes('重命名'));
    renameMenuBtn?.click();
    const renameInputReady = await waitFor(
      () => !!document.querySelector<HTMLInputElement>('[data-testid="tree-rename-input"]'),
    );
    const renameInput = document.querySelector<HTMLInputElement>(
      '[data-testid="tree-rename-input"]',
    );
    let renameTypedOk = false;
    if (renameMenuOpen && renameMenuBtn && renameInputReady && renameInput) {
      const renameSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      for (const ch of '改名后') {
        if (!renameSetter) break;
        const start = renameInput.selectionStart ?? renameInput.value.length;
        const end = renameInput.selectionEnd ?? renameInput.value.length;
        renameSetter.call(
          renameInput,
          renameInput.value.slice(0, start) + ch + renameInput.value.slice(end),
        );
        renameInput.setSelectionRange(start + ch.length, start + ch.length);
        renameInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(30);
      }
      renameTypedOk = renameInput.value === '改名后';
      renameInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      await sleep(300);
    }
    check(
      '右键重命名：连续逐字输入不被全选覆盖',
      renameTypedOk,
      `menu=${renameMenuOpen} btn=${!!renameMenuBtn} value=${renameInput?.value ?? '(none)'}`,
    );
    const renamedLinkSource = await invoke('fs:readTextFile', { path: '链接源.md' });
    check(
      '重命名：树实时更新，wikilink 已替换',
      (await waitFor(() => !!treeRow('研究/改名后.md'), 15000)) &&
        !treeRow('研究/外部笔记.md') &&
        renamedLinkSource.includes('[[改名后]]'),
      `linkSource=${renamedLinkSource.slice(-40)}`,
    );
    const renamedTab = document.querySelector(
      '[data-testid="tab"][data-page-path="研究/改名后.md"]',
    );
    check('重命名：已打开 tab 的路径与标题联动', !!renamedTab);
    check(
      '重命名后激活态跟随新路径',
      treeRow('研究/改名后.md')?.getAttribute('data-active') === 'true',
    );

    // 移动（目录拖拽走同一 IPC）
    await moveEntry('研究/改名后.md', '');
    check(
      '移动：树刷新到新位置',
      await waitFor(() => !!treeRow('改名后.md') && !treeRow('研究/改名后.md'), 15000),
    );

    // 删除（回收站）：自动接受 confirm
    const origConfirm = window.confirm;
    window.confirm = () => true;
    await deleteEntry('改名后.md', '改名后');
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
    await sleep(2500); // 布局防抖写回
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
    check(
      '侧栏宽度可调',
      Math.abs(widthAfter - (widthBefore + 40)) < 2,
      `${widthBefore} -> ${widthAfter}`,
    );
    await capture('11-tree-final');

    // tab 右键菜单——先确保至少有一个 page tab 可被选中（不依赖默认 welcome 标签）
    openPage('冒烟首页.md');
    await sleep(200);
    const pageTab = document.querySelector(
      '[data-testid="tab"][data-page-path]',
    ) as HTMLElement | null;
    if (pageTab) {
      // 点击以激活
      pageTab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    await sleep(150);
    const firstTab = pageTab ?? document.querySelector('[data-testid="tab"]');
    firstTab?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 60 }),
    );
    const tabMenuVisible = await waitFor(
      () => !!document.querySelector('[data-testid="tab-context-menu"]'),
    );
    check('tab 右键菜单弹出', tabMenuVisible);
    const menuText = document.querySelector('[data-testid="tab-context-menu"]')?.textContent ?? '';
    check(
      '菜单含 关闭其他/关闭右侧/复制路径',
      menuText.includes('关闭其他') &&
        menuText.includes('关闭右侧') &&
        menuText.includes('复制路径'),
    );
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await sleep(150);

    // ── 10a. DEV-006 图谱：真实 500/2000 索引、过滤、点击、局部跳数与 FPS ──
    const graphSeed = await bridge.seedGraph(created.root);
    check('图谱性能种子写入 500 页 / 2000 链接', graphSeed.ok, graphSeed.error);
    await invoke('index:rebuild');
    useTabStore.getState().openTab({ kind: 'graph', title: '知识图谱' });
    const graphText = () =>
      document.querySelector('[data-testid="global-graph-view"]')?.textContent ?? '';
    check(
      '全局图谱包含 500 页 / 2000 链接性能种子',
      await waitFor(() => {
        const match = /(\d+) 页面 · (\d+) 链接/.exec(graphText());
        return (
          Number(match?.[1] ?? 0) >= (graphSeed.pages ?? 500) &&
          Number(match?.[2] ?? 0) >= (graphSeed.links ?? 2000) &&
          document.querySelectorAll('.react-flow__node').length >= (graphSeed.pages ?? 500)
        );
      }, 20_000),
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

    const nativeOptionSetter = Object.getOwnPropertyDescriptor(
      HTMLOptionElement.prototype,
      'selected',
    )?.set;
    const folderSelect = document.querySelector<HTMLSelectElement>(
      '[data-testid="graph-folder-filter"]',
    );
    const groupOption = [...(folderSelect?.options ?? [])].find(
      (option) => option.value === 'graph/group-a',
    );
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
        return (
          activeTab?.getAttribute('data-page-path')?.startsWith('graph/group-a/group-a-node-') ??
          false
        );
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
    check(
      '局部图谱支持 2 跳扩展',
      await waitFor(() => localNodeCount() > 9, 10_000),
      `nodes=${localNodeCount()}`,
    );
    await capture('17-local-graph');

    const activePath = document
      .querySelector('[data-testid="tab"][data-active="true"]')
      ?.getAttribute('data-page-path');
    const activeSummary = activePath
      ? await invoke('index:pageSummary', { path: activePath })
      : null;
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
    check(
      'git:getTimeline 包含 initial 基线',
      initial.some((entry) => entry.kind === 'initial'),
    );
    await invoke('fs:writeTextFile', { path: 'smoke-note.md', content: '冒烟笔记' });
    // 自动提交走 30s 防抖；这里用手动提交验证提交链路，随后时间线刷新。
    const manual = await invoke('git:commit', { message: 'smoke manual commit' });
    check('手动提交成功（commitManual）', manual.status.changed === 0);
    const after = await invoke('git:getTimeline', {});
    check('手动提交形成新 HEAD（kind=manual）', (after[0]?.kind ?? '') === 'manual');
    // 切换 dock 到 git 时间线
    useUiStore.getState().setActiveDockPanel('git-timeline');
    await waitFor(() => !!document.querySelector('[data-testid="git-timeline"]'));
    const timelineReady = await waitFor(
      () =>
        (document.querySelector('[data-testid="git-timeline"]')?.textContent ?? '').includes(
          'smoke manual commit',
        ),
      15000,
    );
    const timelineText = document.querySelector('[data-testid="git-timeline"]')?.textContent ?? '';
    check('版本时间线 dock 面板渲染 commit 列表', timelineReady, timelineText.slice(0, 80));
    await capture('09-git-timeline');

    // ── 10c. DEV-015 内置插件：Mermaid + KaTeX 真实渲染与 Obsidian 兼容写盘 ──
    // 用全新独立页面，确保它是当前活动编辑器，避免历史 tab 干扰。
    await createPage('内置插件演示');
    const builtinEditor = await waitFor(
      () => !![...document.querySelectorAll('[data-testid="editor-view"] .ProseMirror')].pop(),
      12_000,
    );
    check('DEV-015 编辑器就绪', builtinEditor);
    // 显式聚焦活动编辑器（注册聚焦监听会激活对应内核）。
    const builtinEl = [
      ...document.querySelectorAll('[data-testid="editor-view"] .ProseMirror'),
    ].pop() as HTMLElement | undefined;
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
      const mermaidError = document.querySelector(
        '.nexnote-mermaid-view .nexnote-mermaid-preview.is-error',
      );
      check(
        'DEV-015 Mermaid 真实渲染 SVG（flowchart）',
        !!mermaidSvg && !mermaidError,
        mermaidError?.textContent?.slice(0, 80) ?? `svg=${!!mermaidSvg}`,
      );
      await waitFor(
        () =>
          document.querySelectorAll('.nexnote-math-view .katex, .nexnote-math-inline-view .katex')
            .length >= 2,
        10_000,
      );
      const blockKatex = !!document.querySelector('.nexnote-math-view .katex');
      const inlineKatex = !!document.querySelector('.nexnote-math-inline-view .katex');
      const katexError =
        document.querySelector('[data-math-view] .nexnote-math-preview')?.textContent ?? '';
      check(
        'DEV-015 KaTeX 块级与行内均渲染',
        blockKatex && inlineKatex,
        `block=${blockKatex} inline=${inlineKatex}${katexError ? ` · ${katexError.slice(0, 60)}` : ''}`,
      );
      await capture('19-builtin-mermaid-katex');
      // 防抖保存后读盘验证 Obsidian 原生语法。
      await sleep(2500);
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
    check(
      'DEV-015 设置页列出两个内置插件',
      hasMermaid && hasKatex,
      `mermaid=${hasMermaid} katex=${hasKatex}`,
    );
    const detailBuiltin =
      document.querySelector('[data-testid="plugin-detail"]')?.textContent ?? '';
    check(
      'DEV-015 详情页标注内置且隐藏卸载按钮',
      detailBuiltin.includes('内置插件') &&
        !document.querySelector('[data-testid="plugin-uninstall"]'),
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
    check(
      '插件贡献不渲染为底部裸露 UI',
      !document.querySelector('[data-testid="plugin-contribution-surfaces"]'),
    );
    await capture('20-builtin-plugins-settings');

    // DEV-042 需要正式 ChatDock；前面的 DEV-026 已验证并清理了未配置空态，重新建立隔离 mock profile。
    if (mockUrl && !smokeProfileId) {
      const saved = await invoke('ai:profile:save', {
        profile: {
          name: '冒烟 mock provider final',
          kind: 'openai-compatible',
          baseUrl: mockUrl,
          defaultModel: 'gpt-4o-mini',
        },
      });
      smokeProfileId = saved.id;
      await invoke('ai:profile:setDefault', { id: saved.id });
      await invoke('ai:features:set', {
        feature: 'writing',
        assignment: { profileId: saved.id, model: 'gpt-4o-mini' },
      });
    }

    // ── DEV-042 最终组合验收：ADR-0005~0009 跨票边界 ────────────────
    // 这些断言故意走真实 UI/IPC seams，而非只检查组件快照：普通编辑不触发
    // provider、Chat Dock 三档权限可达、双模式插入保持单 undo、会话与页面分离。
    // Chat Dock 默认收起是产品合同；本场景需要显式打开后再检查其内容。
    useChatStore.getState().setActive(
      {
        path: `.nexnote/sessions/${'1'.repeat(64)}.txt`,
        meta: {
          id: 'dev-042-smoke',
          title: 'DEV-042',
          profileId: null,
          model: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        turns: [{ role: 'assistant', content: 'DEV-042 回复' }],
      },
      false,
    );
    useUiStore.getState().setActiveDockPanel('ai-chat');
    await waitFor(() => !!document.querySelector('[data-testid="ai-dock-ready"]'));
    const permissionSelect = await (async () => {
      await waitFor(() => !!document.querySelector('[data-testid="chat-permission-mode"]'));
      return document.querySelector<HTMLSelectElement>('[data-testid="chat-permission-mode"]');
    })();
    check(
      'DEV-042 Chat Dock 提供对话/编辑/完全权限三档',
      !!permissionSelect &&
        [...permissionSelect.options].map((option) => option.value).join(',') ===
          'conversation,edit,full',
    );
    if (permissionSelect) {
      for (const mode of ['conversation', 'edit', 'full'] as const) {
        permissionSelect.value = mode;
        permissionSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(80);
      }
      check('DEV-042 权限模式切换不改变普通编辑器入口', permissionSelect.value === 'full');
    }
    const acceptanceNote = await invoke('fs:createNote', {
      parentDir: '',
      name: 'DEV-042 验收组合',
      content: '# DEV-042 验收组合\\n\\n- [ ] 可撤销编辑 ^dev042-anchor\\n',
      format: 'native-block',
    });
    check('DEV-042 组合验收页创建成功', !!acceptanceNote);
    await openDocumentTab('DEV-042 验收组合.md');
    const acceptanceKernel = (await waitFor(() => !!getActiveEditor())) ? getActiveEditor() : null;
    check(
      'DEV-042 双模式候选页可由活动编辑器挂载',
      !!acceptanceKernel && acceptanceKernel.getMarkdown().includes('DEV-042 验收组合'),
    );
    check(
      'DEV-042 block-id 锚点仅保留在可寻址块',
      acceptanceKernel?.getMarkdown().includes('^dev042-anchor') ?? false,
    );
    check(
      'DEV-042 Chat Dock 插入控件与单 undo seam 可达',
      !!document.querySelector('[data-testid="chat-insert-block"]') &&
        typeof acceptanceKernel?.undo === 'function',
    );
    await capture('DEV-042-final-integration');

    // ── DEV-047 源码模式编辑增强：工具栏、缩进、格式化、图表/目录/悬浮目录、页面树 ──
    // 独立 Markdown 文档承载全部场景：真实 CodeMirror 事务 + 工具栏点击 + 预览渲染。
    // H1 与文件名保持一致，避免 H1→文件名绑定在防抖保存时自动重命名 fixture。
    useUiStore.getState().setDockVisible(false);
    const dev047Path = 'DEV-047 冒烟.md';
    await invoke('fs:createNote', {
      parentDir: '',
      name: 'DEV-047 冒烟',
      content:
        '---\ntitle: DEV-047\n---\n\n# DEV-047 冒烟\n\n## 章节 甲\n\n正文甲\n\n### 章节 甲子节\n\n子节正文\n\n## 章节 乙\n\n正文乙\n',
      format: 'markdown',
    });
    await openDocumentTab(dev047Path);
    check(
      'DEV-047 Markdown 源码页打开（源码模式 + 双栏预览）',
      (await waitFor(
        () => !!document.querySelector('[data-testid="source-mode-view"] .cm-content'),
      )) && !!document.querySelector('[data-testid="live-preview"]'),
    );

    // 1) 源码页工具栏动作集（平铺或「更多」溢出菜单均视为可达）。
    const sourceToolbarRoot = (): HTMLElement | null =>
      document.querySelector<HTMLElement>(
        '[data-testid="source-mode-view"] [data-testid="editor-toolbar"]',
      );
    const sourceToolbarEntry = (id: string): HTMLButtonElement | null =>
      sourceToolbarRoot()?.querySelector<HTMLButtonElement>(
        `[data-testid="toolbar-entry-${CSS.escape(id)}"]`,
      ) ?? null;
    const sourceMoreButton = (): HTMLButtonElement | null =>
      sourceToolbarRoot()?.querySelector<HTMLButtonElement>('[data-testid="toolbar-more"]') ?? null;
    const sourceToolbarMenuItems = (): HTMLElement[] => [
      ...(document
        .querySelector('[data-testid="toolbar-more-menu"]')
        ?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ];
    const sourceToolbarReachableIds = async (): Promise<string[]> => {
      const ids = new Set(
        [
          ...(sourceToolbarRoot()?.querySelectorAll<HTMLElement>(
            'button[data-toolbar-item="true"]',
          ) ?? []),
        ]
          .map((el) => el.dataset.itemId ?? '')
          .filter((id) => id !== 'toolbar:more'),
      );
      for (const menuId of ['menu:format', 'menu:insert', 'ai']) {
        sourceToolbarEntry(menuId)?.click();
        await sleep(100);
        for (const item of document.querySelectorAll<HTMLElement>(
          '[data-testid="toolbar-menu"] [role="menuitem"]',
        ))
          ids.add((item.dataset.testid ?? '').replace('toolbar-menu-item-', ''));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      if (sourceMoreButton()) {
        sourceMoreButton()?.click();
        await sleep(250);
        for (const item of sourceToolbarMenuItems())
          ids.add((item.dataset.testid ?? '').replace('toolbar-menu-item-', ''));
        document
          .querySelector('[data-testid="toolbar-more-menu"]')
          ?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
          );
        await sleep(150);
      }
      return [...ids];
    };
    // 与 clickToolbarAction 不同：动作收进「更多」时先开菜单并等 React 渲染一拍再点
    // （同步 click 后菜单尚未挂载，立即查找会落空）。
    const clickToolbarEntry = async (id: string): Promise<boolean> => {
      let target = sourceToolbarEntry(id);
      const menuItem = (): HTMLButtonElement | null =>
        sourceToolbarRoot()?.querySelector<HTMLButtonElement>(
          `[data-testid="toolbar-menu-item-${CSS.escape(id)}"]`,
        ) ?? null;
      if (!target) {
        const menuId = id.startsWith('format:') ? 'menu:format' : 'menu:insert';
        sourceToolbarEntry(menuId)?.click();
        await sleep(250);
        target = menuItem();
      }
      if (!target && sourceMoreButton()) {
        sourceMoreButton()?.click();
        await sleep(250);
        target = menuItem();
      }
      target?.click();
      return !!target;
    };
    const dev047ToolbarIds = await sourceToolbarReachableIds();
    check(
      'DEV-047 源码页工具栏含 撤销/重做/表格/流程图/甘特图/正文目录/格式化选区/格式化全文',
      [
        'edit:undo',
        'edit:redo',
        'insert:table',
        'insert:mermaid-flowchart',
        'insert:mermaid-gantt',
        'insert:toc',
        'format:selection',
        'format:document',
      ].every((id) => dev047ToolbarIds.includes(id)),
      dev047ToolbarIds.join(' | '),
    );

    const sourceToolbar = sourceToolbarRoot();
    const sourceAi = sourceToolbar?.querySelector<HTMLButtonElement>(
      '[data-testid="toolbar-entry-ai"]',
    );
    sourceAi?.focus({ preventScroll: true });
    // Hover the AI trigger through a trusted Chromium mouse move; programmatic focus does
    // not set :focus-visible in packaged runs, while pointer discovery must also work.
    if (sourceAi) {
      const rect = sourceAi.getBoundingClientRect();
      await bridge.hoverAtPoint(
        Math.round(rect.left + rect.width / 2),
        Math.round(rect.top + rect.height / 2),
      );
      sourceAi.focus({ preventScroll: true });
      await sleep(250);
    }
    // Toolbar state can re-render the trigger after focus/hover; re-discover the
    // current node and replay the trusted pointer/focus sequence on that node.
    let currentSourceAi = sourceToolbar?.querySelector<HTMLButtonElement>(
      '[data-testid="toolbar-entry-ai"]',
    );
    if (currentSourceAi) {
      const rect = currentSourceAi.getBoundingClientRect();
      await bridge.hoverAtPoint(
        Math.round(rect.left + rect.width / 2),
        Math.round(rect.top + rect.height / 2),
      );
      currentSourceAi.focus({ preventScroll: true });
      await sleep(250);
      currentSourceAi =
        sourceToolbar?.querySelector<HTMLButtonElement>('[data-testid="toolbar-entry-ai"]') ??
        currentSourceAi;
    }
    const tooltipId = currentSourceAi?.getAttribute('aria-describedby');
    const tooltip = tooltipId ? document.getElementById(tooltipId) : null;
    const activeToolbarAi =
      document.activeElement?.getAttribute('data-testid') === 'toolbar-entry-ai';
    check(
      'Icon-first 工具栏：AI 为 Sparkles + AI + chevron，Tooltip 与 accessible name 可达',
      !!currentSourceAi &&
        currentSourceAi.getAttribute('aria-label') === 'AI' &&
        (currentSourceAi.textContent ?? '').includes('AI') &&
        !!currentSourceAi.querySelector('svg') &&
        !!currentSourceAi.querySelector('svg.lucide-chevron-down') &&
        activeToolbarAi &&
        tooltip?.getAttribute('role') === 'tooltip' &&
        !!sourceToolbar?.querySelector('[data-testid="toolbar-entry-edit:undo"]') &&
        !!sourceToolbar?.querySelector('[data-testid="toolbar-entry-menu:format"]') &&
        !!sourceToolbar?.querySelector('[data-testid="toolbar-entry-menu:insert"]'),
      currentSourceAi
        ? JSON.stringify({
            label: currentSourceAi.getAttribute('aria-label'),
            active: document.activeElement?.getAttribute('data-testid'),
            tooltipId,
            tooltipRole: tooltip?.getAttribute('role'),
            hasSvg: !!currentSourceAi.querySelector('svg'),
            hasChevron: !!currentSourceAi.querySelector('svg.lucide-chevron-down'),
            activeToolbarAi,
          })
        : '(missing AI)',
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // 预览视图是只读边界：工具栏收敛为「视图切换 + 悬浮目录」。
    const dev047TabId = useTabStore.getState().tabs.find((t) => t.pagePath === dev047Path)?.id;
    const previewSwitched = await clickToolbarEntry('view:preview');
    check(
      'DEV-047 预览视图工具栏仅剩视图切换 + 悬浮目录',
      previewSwitched &&
        (await waitFor(
          () =>
            useTabStore.getState().tabs.find((t) => t.id === dev047TabId)?.markdownView ===
            'preview',
        )) &&
        (await waitFor(() => {
          const ids = rowEntryIds().filter((id) => id !== 'toolbar:more');
          return (
            !moreButton() && ids.join(',') === 'view:source,view:split,view:preview,view:outline'
          );
        })),
      rowEntryIds().join(' | '),
    );
    await clickToolbarEntry('view:split');
    await waitFor(
      () => useTabStore.getState().tabs.find((t) => t.id === dev047TabId)?.markdownView === 'split',
    );

    // 2) 多行缩进：跨两行非空选区 Tab +2 / Shift+Tab -2，单事务一次撤销。
    const dev047Source = getActiveSourceEditor();
    check('DEV-047 源码编辑器句柄可用', !!dev047Source?.view);
    if (dev047Source) {
      const dev047View = dev047Source.view;
      const dev047Text = (): string => dev047View.state.doc.toString();
      dev047View.focus();
      dev047View.dispatch({
        changes: { from: dev047View.state.doc.length, insert: '缩进行甲\n缩进行乙' },
      });
      const indentAnchor = dev047Text().indexOf('缩进行甲');
      const indentHead = dev047Text().indexOf('缩进行乙') + '缩进行乙'.length;
      dev047View.dispatch({ selection: { anchor: indentAnchor, head: indentHead } });
      const indentKey = (shift: boolean): void => {
        dev047View.contentDOM.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey: shift,
            bubbles: true,
            cancelable: true,
          }),
        );
      };
      indentKey(false);
      await sleep(200);
      check(
        'DEV-047 Tab：跨两行选区每行 +2 空格',
        /(^|\n) {2}缩进行甲\n {2}缩进行乙$/.test(dev047Text()),
        JSON.stringify(dev047Text().slice(-24)),
      );
      indentKey(true);
      await sleep(200);
      check(
        'DEV-047 Shift+Tab：每行 -2 空格回到原文',
        /(^|\n)缩进行甲\n缩进行乙$/.test(dev047Text()),
      );
      check(
        'DEV-047 缩进为单事务：一次撤销恢复 +2 状态，重做回到无缩进',
        undo(dev047View) === true &&
          /(^|\n) {2}缩进行甲\n {2}缩进行乙$/.test(dev047Text()) &&
          redo(dev047View) === true &&
          /(^|\n)缩进行甲\n缩进行乙$/.test(dev047Text()),
      );
      await sleep(250);

      // 3) 轻量格式化：空行合并 / 标题与列表标记规范化；frontmatter 与围栏内容不动。
      const messy =
        '\n\n##  章节  丙\n\n正文一\n\n\n\n\n正文二\n\n*item\n\n' +
        '```text\n##  围栏内标题\n*  围栏内列表\n\n\n```\n';
      dev047View.dispatch({
        changes: { from: dev047View.state.doc.length, insert: messy },
      });
      await sleep(250);
      const beforeFormat = dev047Text();
      await clickToolbarEntry('format:document');
      await sleep(250);
      check(
        'DEV-047 格式化全文：标题标记单空格、*item 补空格、连续空行合并',
        dev047Text().includes('## 章节  丙') &&
          dev047Text().includes('* item') &&
          dev047Text().includes('正文一\n\n正文二'),
        JSON.stringify(dev047Text().slice(-160)),
      );
      check(
        'DEV-047 格式化全文：围栏代码内容逐字节不变',
        dev047Text().includes('```text\n##  围栏内标题\n*  围栏内列表\n\n\n```'),
      );
      check(
        'DEV-047 格式化全文：一次撤销恢复格式化前原文',
        undo(dev047View) === true && dev047Text() === beforeFormat,
      );
      redo(dev047View); // 保留格式化后状态，供后续场景使用
      await sleep(2_500); // 防抖保存 + IPC 写盘
      const dev047FormattedOnDisk = await invoke('fs:readTextFile', { path: dev047Path });
      check(
        'DEV-047 格式化全文写盘：frontmatter 原样、规范化正文落盘',
        dev047FormattedOnDisk.startsWith('---\ntitle: DEV-047\n---\n') &&
          dev047FormattedOnDisk.includes('* item'),
        dev047FormattedOnDisk.slice(0, 60),
      );

      // 4) 图表插入：mermaid 围栏模板 + 预览渲染 + 单事务撤销整块移除。
      await clickToolbarEntry('insert:mermaid-flowchart');
      await sleep(250);
      check(
        'DEV-047 流程图插入：源码出现 ```mermaid 与 flowchart TD 模板',
        dev047Text().includes('```mermaid\nflowchart TD') && dev047Text().includes('A[开始]'),
      );
      check(
        'DEV-047 流程图插入：LivePreview 渲染 SVG 图表',
        await waitFor(
          () => !!document.querySelector('[data-testid="live-preview"] .nexnote-mermaid-view svg'),
          15_000,
        ),
      );
      check(
        'DEV-047 流程图插入：一次撤销整块移除',
        undo(dev047View) === true &&
          !dev047Text().includes('flowchart TD') &&
          !dev047Text().includes('```mermaid'),
      );
      // 预览防抖刷新为无图状态后再插入甘特图，避免命中上一张 SVG。
      await waitFor(
        () => !document.querySelector('[data-testid="live-preview"] .nexnote-mermaid-view svg'),
        10_000,
      );
      await clickToolbarEntry('insert:mermaid-gantt');
      await sleep(250);
      check(
        'DEV-047 甘特图插入：源码出现 gantt 模板',
        dev047Text().includes('```mermaid\ngantt') && dev047Text().includes('title 项目计划'),
      );
      check(
        'DEV-047 甘特图插入：LivePreview 渲染 SVG 图表',
        await waitFor(
          () => !!document.querySelector('[data-testid="live-preview"] .nexnote-mermaid-view svg'),
          15_000,
        ),
      );
      check(
        'DEV-047 甘特图插入：一次撤销整块移除',
        undo(dev047View) === true && !dev047Text().includes('gantt'),
      );
      await sleep(400);

      // 5) 正文目录：磁盘只有标记行，条目由渲染层实时派生；撤销/重做正确。
      await clickToolbarEntry('insert:toc');
      await sleep(250);
      const tocMarkerCount = (text: string): number =>
        text.split('\n').filter((line) => line === '<!-- nexnote:toc -->').length;
      check(
        'DEV-047 正文目录插入：源码恰有一行 <!-- nexnote:toc -->',
        tocMarkerCount(dev047Text()) === 1,
        `markers=${tocMarkerCount(dev047Text())}`,
      );
      check(
        'DEV-047 正文目录：预览渲染目录容器与派生标题条目',
        (await waitFor(
          () => !!document.querySelector('[data-testid="live-preview"] [data-table-of-contents]'),
          10_000,
        )) &&
          (await waitFor(() => {
            const items = document.querySelectorAll(
              '[data-testid="live-preview"] [data-table-of-contents-item]',
            );
            return items.length >= 3 && (items[0]?.textContent ?? '').includes('DEV-047 冒烟');
          }, 10_000)),
        `items=${document.querySelectorAll('[data-testid="live-preview"] [data-table-of-contents-item]').length}`,
      );
      check(
        'DEV-047 正文目录：一次撤销移除标记、重做恢复',
        undo(dev047View) === true &&
          tocMarkerCount(dev047Text()) === 0 &&
          redo(dev047View) === true &&
          tocMarkerCount(dev047Text()) === 1,
      );
      await sleep(2_500); // 防抖保存 + IPC 写盘
      const dev047TocOnDisk = await invoke('fs:readTextFile', { path: dev047Path });
      check(
        'DEV-047 正文目录写盘：磁盘只保留标记行（条目不落盘）',
        tocMarkerCount(dev047TocOnDisk) === 1,
        `markers=${tocMarkerCount(dev047TocOnDisk)}`,
      );

      // 关闭重开：目录条目仍从磁盘标记派生。
      const dev047Tab = useTabStore.getState().tabs.find((t) => t.pagePath === dev047Path);
      if (dev047Tab) useTabStore.getState().closeTab(dev047Tab.id);
      await openDocumentTab(dev047Path);
      check(
        'DEV-047 关闭重开：目录条目仍从磁盘标记派生',
        (await waitFor(
          () => !!document.querySelector('[data-testid="source-mode-view"] .cm-content'),
        )) &&
          (await waitFor(
            () =>
              document.querySelectorAll(
                '[data-testid="live-preview"] [data-table-of-contents-item]',
              ).length >= 3,
            15_000,
          )),
      );
      await capture('DEV-047-toc');
    } else {
      check('DEV-047 源码编辑器句柄可用', false, 'getActiveSourceEditor 为空');
    }

    // 6) 悬浮目录：更多菜单开启、条目与标题一致、点击定位、切页不残留、关闭收起。
    {
      const outlinePanel = (): HTMLElement | null =>
        document.querySelector<HTMLElement>('[data-testid="outline-panel"]');
      const outlineEntryEls = (): HTMLElement[] => [
        ...document.querySelectorAll<HTMLElement>('[data-testid^="outline-entry-"]'),
      ];
      const outlineOpened = await clickToolbarEntry('view:outline');
      check(
        'DEV-047 悬浮目录开启：条目与文档标题一致',
        outlineOpened &&
          (await waitFor(() => {
            const entries = outlineEntryEls();
            const texts = entries.map((el) => el.textContent ?? '');
            return (
              outlinePanel() !== null &&
              entries.length >= 3 &&
              texts.includes('DEV-047 冒烟') &&
              texts.includes('章节 乙')
            );
          })),
        `entries=${outlineEntryEls()
          .map((el) => el.textContent)
          .join(',')}`,
      );
      const dev047Handle2 = getActiveSourceEditor();
      const entryB = outlineEntryEls().find((el) => (el.textContent ?? '') === '章节 乙');
      entryB?.click();
      await sleep(200);
      const dev047View2 = dev047Handle2?.view;
      check(
        'DEV-047 点击悬浮目录条目：编辑器选区定位到对应标题（源码态）',
        !!dev047View2 &&
          dev047View2.state.doc
            .lineAt(dev047View2.state.selection.main.head)
            .text.startsWith('## 章节 乙'),
        dev047View2
          ? dev047View2.state.doc.lineAt(dev047View2.state.selection.main.head).text.slice(0, 24)
          : 'no view',
      );
      await openDocumentTab('DEV-042 验收组合.md');
      check(
        'DEV-047 切换页面后悬浮目录不残留旧条目',
        (await waitFor(
          () => !!document.querySelector('[data-testid="editor-view"] .ProseMirror'),
        )) && !outlinePanel(),
      );
      await openDocumentTab(dev047Path);
      await waitFor(() => !!document.querySelector('[data-testid="source-mode-view"] .cm-content'));
      check('DEV-047 切回源码页：悬浮目录默认收起', await waitFor(() => outlinePanel() === null));
      const outlineReopened =
        (await clickToolbarEntry('view:outline')) && (await waitFor(() => outlinePanel() !== null));
      document.querySelector<HTMLButtonElement>('[data-testid="outline-close"]')?.click();
      check(
        'DEV-047 关闭按钮收起悬浮目录',
        outlineReopened && (await waitFor(() => outlinePanel() === null)),
      );
    }

    // 6b) Markdown 标题折叠：可访问 disclosure、嵌套状态、目录 reveal、全部展开、重开默认展开，且不触碰字节。
    {
      const foldSource = getActiveSourceEditor();
      const foldOriginal = await invoke('fs:readTextFile', { path: dev047Path });
      const foldEditorText = foldSource?.view.state.doc.toString();
      const foldButtons = (): HTMLButtonElement[] => [
        ...document.querySelectorAll<HTMLButtonElement>('.cm-heading-fold-toggle'),
      ];
      const foldReady =
        !!foldSource &&
        (await waitFor(() => foldButtons().length >= 3)) &&
        foldButtons().every(
          (button) =>
            button.getAttribute('aria-label') === '折叠章节' &&
            button.getAttribute('aria-expanded') === 'true',
        );
      const parentFold = foldButtons()[0];
      const childFold = foldButtons()[1];
      childFold?.click();
      parentFold?.click();
      const nestedFolded =
        !!foldSource &&
        sourceFoldState(foldSource.view.state)?.folded.size === 2 &&
        !(document.querySelector('[data-testid="source-editor-pane"]')?.textContent ?? '').includes(
          '子节正文',
        );
      parentFold?.click();
      check(
        'Markdown 嵌套标题折叠：可访问控件、父重开后子折叠仍保留且原文未改',
        foldReady &&
          nestedFolded &&
          sourceFoldState(foldSource!.view.state)?.folded.size === 1 &&
          foldSource!.view.state.doc.toString() === foldEditorText,
        `folded=${foldSource ? sourceFoldState(foldSource.view.state)?.folded.size : 'no editor'}`,
      );
      const outlineForFold = document.querySelector<HTMLButtonElement>(
        '[data-testid="toolbar-entry-view:outline"]',
      );
      outlineForFold?.click();
      await waitFor(() => !!document.querySelector('[data-testid="outline-panel"]'));
      [...document.querySelectorAll<HTMLButtonElement>('[data-testid^="outline-entry-"]')]
        .find((entry) => (entry.textContent ?? '') === '章节 甲子节')
        ?.click();
      check(
        'Markdown 目录跳转自动展开祖先章节',
        !!foldSource &&
          (await waitFor(() => sourceFoldState(foldSource.view.state)?.folded.size === 0)) &&
          foldSource.view.state.doc
            .lineAt(foldSource.view.state.selection.main.head)
            .text.includes('章节 甲子节'),
      );
      parentFold?.click();
      document.querySelector<HTMLButtonElement>('[data-testid="outline-expand-all"]')?.click();
      check(
        'Markdown「全部展开」清空当前折叠且 Markdown 字节保持',
        !!foldSource &&
          (await waitFor(() => sourceFoldState(foldSource.view.state)?.folded.size === 0)) &&
          foldSource.view.state.doc.toString() === foldEditorText,
      );
      const dev047CurrentTab = useTabStore
        .getState()
        .tabs.find((tab) => tab.pagePath === dev047Path);
      if (dev047CurrentTab) {
        parentFold?.click();
        useTabStore.getState().closeTab(dev047CurrentTab.id);
        await openDocumentTab(dev047Path);
        await waitFor(
          () => !!document.querySelector('[data-testid="source-editor-pane"] .cm-content'),
        );
        const reopenedFoldSource = getActiveSourceEditor();
        check(
          'Markdown 重开全部展开且保存前后字节不变',
          !!reopenedFoldSource &&
            sourceFoldState(reopenedFoldSource.view.state)?.folded.size === 0 &&
            (await invoke('fs:readTextFile', { path: dev047Path })) === foldOriginal,
        );
      }
    }

    // 7) 页面树：点击文件夹行主体（非 chevron）切换展开/收起。
    {
      // 10a 段把侧栏切到了局部图谱；页面树检查前先切回 pages 面板（树只挂载于该面板）。
      useUiStore.getState().setActiveSidebarPanel('pages');
      await invoke('fs:mkdir', { path: 'DEV-047 目录', recursive: false });
      await invoke('fs:createNote', {
        parentDir: 'DEV-047 目录',
        name: 'DEV-047 子页',
        content: '# DEV-047 子页\n',
        format: 'native-block',
      });
      // chokidar 对新建子目录内文件的事件回流存在延迟（5b 段同款问题）：显式全量重载。
      await usePageTreeStore.getState().load();
      check(
        'DEV-047 页面树：目录与子页出现（默认展开）',
        (await waitFor(() => !!treeRow('DEV-047 目录'))) &&
          (await waitFor(() => !!treeRow('DEV-047 目录/DEV-047 子页.md'))),
      );
      const dirRow = (): Element | null => treeRow('DEV-047 目录');
      dirRow()?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      check(
        'DEV-047 点击文件夹行主体：折叠后子页隐藏（chevron 变「展开」）',
        (await waitFor(() => !treeRow('DEV-047 目录/DEV-047 子页.md'))) &&
          !!dirRow()?.querySelector('button[aria-label="展开"]'),
      );
      dirRow()?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      check(
        'DEV-047 再次点击行主体：恢复展开子页可见',
        (await waitFor(() => !!treeRow('DEV-047 目录/DEV-047 子页.md'))) &&
          !!dirRow()?.querySelector('button[aria-label="折叠"]'),
      );
      await capture('DEV-047-page-tree');
    }

    // ── DEV-048 预览视图占满 / 悬浮目录收缩 / 分栏目录点击预览跟随 ──────────
    {
      const outlinePanelEl = (): HTMLElement | null =>
        document.querySelector<HTMLElement>('[data-testid="outline-panel"]');
      const outlineEntries = (): HTMLElement[] => [
        ...document.querySelectorAll<HTMLElement>('[data-testid^="outline-entry-"]'),
      ];
      const dev047TabView = (): string | undefined =>
        useTabStore.getState().tabs.find((t) => t.pagePath === dev047Path)?.markdownView;
      const editorPane = (): HTMLElement | null =>
        document.querySelector<HTMLElement>('[data-testid="source-editor-pane"]');

      // 1) 预览视图：内容列不再受 --editor-content-width 限制，占满预览容器；
      //    编辑器窗格退出文档流（absolute，不再 relative）。
      const previewFillReady =
        (await clickToolbarEntry('view:preview')) &&
        (await waitFor(
          () =>
            dev047TabView() === 'preview' &&
            editorPane()?.classList.contains('absolute') === true &&
            !!document.querySelector('[data-testid="live-preview-content"]'),
        ));
      const dev048ContentCol = document.querySelector('[data-testid="live-preview-content"]');
      const dev048PreviewHost = dev048ContentCol?.closest('[data-testid="live-preview"]');
      const dev048Layout = document.querySelector('[data-testid="markdown-view-layout"]');
      const dev048ContentWidth = dev048ContentCol?.getBoundingClientRect().width ?? 0;
      const dev048HostWidth = dev048PreviewHost?.getBoundingClientRect().width ?? 0;
      const dev048LayoutWidth = dev048Layout?.getBoundingClientRect().width ?? 0;
      check(
        'DEV-049 预览根容器占满 Markdown 布局（宽度差 ≤ 2px）',
        previewFillReady &&
          !!dev048PreviewHost &&
          !!dev048Layout &&
          Math.abs(dev048HostWidth - dev048LayoutWidth) <= 2,
        `preview=${dev048HostWidth.toFixed(0)}px layout=${dev048LayoutWidth.toFixed(0)}px`,
      );
      check(
        'DEV-048 预览视图占满：内容列宽度 ≥ 预览容器 - 80px',
        previewFillReady && !!dev048PreviewHost && dev048ContentWidth >= dev048HostWidth - 80,
        `content=${dev048ContentWidth.toFixed(0)}px host=${dev048HostWidth.toFixed(0)}px`,
      );
      check(
        'DEV-048 预览视图占满：内容列 max-width 为 none（不再受 46rem 阅读列限制）',
        previewFillReady &&
          !!dev048ContentCol &&
          getComputedStyle(dev048ContentCol).maxWidth === 'none',
        `maxWidth=${dev048ContentCol ? getComputedStyle(dev048ContentCol).maxWidth : 'n/a'}`,
      );
      check(
        'DEV-048 预览视图编辑器窗格退出文档流（含 absolute 不含 relative）',
        editorPane()?.classList.contains('absolute') === true &&
          editorPane()?.classList.contains('relative') === false,
      );
      await capture('DEV-048-preview-fill');
      await clickToolbarEntry('view:split');
      await waitFor(() => dev047TabView() === 'split');

      // 2) 悬浮目录收缩：toggle 后仅剩展开按钮；expand 恢复条目。
      const collapseReady =
        (await clickToolbarEntry('view:outline')) &&
        (await waitFor(() => outlinePanelEl() !== null && outlineEntries().length > 0));
      document.querySelector<HTMLButtonElement>('[data-testid="outline-toggle"]')?.click();
      const collapsedOk = await waitFor(
        () =>
          outlinePanelEl()?.getAttribute('data-collapsed') === 'true' &&
          outlineEntries().length === 0 &&
          !!document.querySelector('[data-testid="outline-expand"]'),
      );
      check(
        'DEV-048 悬浮目录收缩：data-collapsed=true 且条目收起仅剩展开按钮',
        collapseReady && collapsedOk,
        `collapsed=${outlinePanelEl()?.getAttribute('data-collapsed') ?? 'none'} entries=${outlineEntries().length}`,
      );
      await capture('DEV-048-outline-collapse');
      document.querySelector<HTMLButtonElement>('[data-testid="outline-expand"]')?.click();
      check(
        'DEV-048 点击展开按钮恢复目录条目',
        await waitFor(
          () =>
            outlinePanelEl()?.getAttribute('data-collapsed') == null && outlineEntries().length > 0,
        ),
        `entries=${outlineEntries().length}`,
      );

      // 3) 分栏目录点击 → 预览直接滚到对应标题：目标标题位于文档中部
      //    （下方内容远超一屏），直接定位 delta≈0；若退化为比例同步，
      //    中部标题会落在视口中段，delta 判别阈值可区分两种机制。
      const dev048LongPath = 'DEV-048 长文.md';
      const midHeadingText = '中部目标标题';
      const dev048Section = (i: number) =>
        `## 章节 ${i}\n\n` +
        `章节 ${i} 第一段：用于撑起预览高度，使文档整体可滚动。\n\n` +
        `章节 ${i} 第二段：各节长度一致，源码与预览的滚动比例彼此接近。\n\n` +
        `章节 ${i} 第三段：收尾段落，进一步增加文档高度。\n\n`;
      const dev048LongContent =
        '---\ntitle: DEV-048\n---\n\n# DEV-048 长文\n\n' +
        Array.from({ length: 6 }, (_, i) => dev048Section(i + 1)).join('') +
        `## ${midHeadingText}\n\n` +
        '中部标题第一段：位于文档中部，点击悬浮目录条目后预览应把它滚到视口顶部附近。\n\n' +
        '中部标题第二段：直接定位与比例同步在此处的落点差异构成判别。\n\n' +
        Array.from({ length: 6 }, (_, i) => dev048Section(i + 7)).join('') +
        '## 尾声\n\n结尾段落。\n';
      await invoke('fs:createNote', {
        parentDir: '',
        name: 'DEV-048 长文',
        content: dev048LongContent,
        format: 'markdown',
      });
      await openDocumentTab(dev048LongPath);
      await clickToolbarEntry('view:split');
      const longReady =
        (await waitFor(
          () => !!document.querySelector('[data-testid="source-mode-view"] .cm-content'),
        )) &&
        (await waitFor(() => {
          const host = document.querySelector('[data-testid="live-preview"]');
          return (host?.querySelectorAll('h2').length ?? 0) >= 14;
        }, 15_000));
      const longHostNow = () => document.querySelector<HTMLElement>('[data-testid="live-preview"]');
      check(
        'DEV-048 长文页打开（分栏 + 预览渲染 14 个 H2，预览可滚动）',
        longReady && (longHostNow()?.scrollHeight ?? 0) > (longHostNow()?.clientHeight ?? 0),
        `h2=${longHostNow()?.querySelectorAll('h2').length ?? 0}`,
      );
      const outlineLongOpened =
        (await clickToolbarEntry('view:outline')) &&
        (await waitFor(
          () =>
            outlineEntries().length >= 14 &&
            outlineEntries().some((el) => (el.textContent ?? '') === midHeadingText),
        ));
      outlineEntries()
        .find((el) => (el.textContent ?? '') === midHeadingText)
        ?.click();
      const midHeadingMeasure = (): {
        scrollTop: number;
        delta: number;
        height: number;
      } | null => {
        const host = document.querySelector<HTMLElement>('[data-testid="live-preview"]');
        // ProseMirror heading fold widgets render an aria-hidden › inside each h2;
        // textContent includes that icon although the accessible heading text does not.
        const heading = [...(host?.querySelectorAll<HTMLElement>('h2') ?? [])].find((el) => {
          const text = [...el.childNodes]
            .filter((node) => !(node instanceof Element && node.matches('.nexnote-fold-toggle')))
            .map((node) => node.textContent ?? '')
            .join('')
            .trim();
          return text === midHeadingText;
        });
        if (!host || !heading) return null;
        return {
          scrollTop: host.scrollTop,
          delta: heading.getBoundingClientRect().top - host.getBoundingClientRect().top,
          height: host.getBoundingClientRect().height,
        };
      };
      await waitFor(() => {
        const m = midHeadingMeasure();
        return !!m && m.scrollTop > 0 && m.delta >= -2 && m.delta < 250;
      }, 12_000);
      // smooth 滚动按距离自适应时长：轮询到位置稳定（连续两次读数一致）再取最终值，
      // 避免在动画途中测量导致结果随机器负载抖动。
      let followMeasure = midHeadingMeasure();
      const settleDeadline = Date.now() + 8_000;
      while (Date.now() < settleDeadline) {
        await sleep(250);
        const prev = followMeasure;
        followMeasure = midHeadingMeasure();
        if (
          prev &&
          followMeasure &&
          Math.abs(prev.scrollTop - followMeasure.scrollTop) <= 1 &&
          followMeasure.delta < 250
        ) {
          break;
        }
      }
      check(
        'DEV-048 分栏目录点击：预览直接滚到中部标题（delta<250px，区别于比例同步落点）',
        outlineLongOpened &&
          !!followMeasure &&
          followMeasure.scrollTop > 0 &&
          followMeasure.delta >= -2 &&
          followMeasure.delta < 250,
        followMeasure
          ? `scrollTop=${followMeasure.scrollTop.toFixed(0)} delta=${followMeasure.delta.toFixed(0)}px viewport=${followMeasure.height.toFixed(0)}px`
          : '中部标题未找到',
      );
      await capture('DEV-048-outline-follow');
    }

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

    // ── 11b. 旧布局含 files tab 的恢复兼容（DEV-021）────────
    const legacyConfig = {
      version: 1,
      layout: { guideCompleted: true },
      lastSession: { tabs: [{ kind: 'files', title: 'Vault 文件' }] },
    };
    const planted = await bridge.writeFile(
      created.root,
      '.nexnote/config.json',
      JSON.stringify(legacyConfig, null, 2),
    );
    check('旧布局 config（残留 files tab）写入成功', planted.ok, planted.error);
    await invoke('vault:open', { path: created.root });
    // 规范化（丢弃残留 files tab）由主进程 readVaultConfig 保证，已在
    // vault-manager 单测中固定为权威证据；此处只验证含旧配置的 vault 可正常打开，
    // 且渲染层 tab 栈不出现任何 files 残留（防御性断言）。
    check(
      '含 files tab 的旧配置 vault 可正常打开',
      await waitFor(() => !!document.querySelector('[data-testid="app-sidebar"]')),
    );
    const restoredTabs = useTabStore.getState().tabs;
    check(
      '渲染层 tab 栈无 files 残留',
      restoredTabs.length > 0 && restoredTabs.every((tab) => (tab.kind as string) !== 'files'),
      restoredTabs.map((tab) => `${tab.kind}:${tab.title}`).join(','),
    );
    await capture('21-legacy-files-tab-restore');
    await invoke('vault:close');
    check(
      '旧布局恢复后可正常关闭回到向导',
      await waitFor(() => !!document.querySelector('[data-testid="onboarding"]')),
    );
  } catch (e) {
    check(
      '冒烟 harness 未抛错',
      false,
      e instanceof Error ? `${e.message}\n${e.stack}` : String(e),
    );
  }

  await bridge.finish({ finishedAt: new Date().toISOString(), checks, captures: [] });
}
