import { invoke } from '../lib/ipc';
import { openDocumentTab } from '../lib/open-document';
import { commandRegistry } from '../registries';
import { useTabStore, openPage } from '../stores/tab-store';
import { createPage } from '../features/editor/create-page';
import { useUiStore } from '../stores/ui-store';
import { useTagStore } from '../stores/tag-store';
import { useThemeStore } from '../theme/theme-store';
import { dockPanelRegistry } from '../registries';
import { getActiveEditor } from '../editor/active-editor';
import { getActiveSourceEditor } from '../editor/source/active-source-editor';
import { applySourceFormat } from '../editor/source/source-formatting';
import { FORMAT_WIKILINK, runFormatAction } from '../editor/interactions/formatting';
import { TextSelection } from '@tiptap/pm/state';
import { undo } from '@codemirror/commands';
import { openSettings } from '../lib/open-settings';
import { deleteEntry, moveEntry } from '../features/sidebar/page-tree/ops';
import { BUILTIN_PLUGIN_IDS } from '@nexnote/shared';

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
                'ai:rewrite,ai:polish,ai:condense,ai:expand,ai:fillgaps,ai:evidence,chat:ask-selection',
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
      useTabStore.getState().openTab({
        kind: 'page',
        title: '冒烟页面 A',
        pagePath: '冒烟页面 A.md',
      });
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
        !document.querySelector('[data-testid="source-mode-toggle"]'),
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
      '源码模式无块编辑交互',
      !document.querySelector('[data-testid="slash-menu"]') &&
        !document.querySelector('[data-testid="selection-bubble"]') &&
        !document.querySelector('[data-testid="block-menu"]') &&
        !document.querySelector('[data-testid="drag-handle"]'),
    );
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
          'ai:rewrite,ai:polish,ai:condense,ai:expand,ai:fillgaps,ai:evidence,chat:ask-selection' &&
        (sourceMenu()?.textContent ?? '').includes('⌘⌥R'),
    );
    (document.activeElement ?? document.body).dispatchEvent(
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

    // Markdown 的 Cmd/Ctrl+E 是预览分栏开关，不切换为 TipTap。
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'e',
        [isMac ? 'metaKey' : 'ctrlKey']: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    document.querySelector<HTMLButtonElement>('[data-testid="preview-toggle"]')?.click();
    const markdownTabId = useTabStore.getState().tabs.find((t) => t.pagePath === markdownPath)?.id;
    const hidePreview = async (): Promise<void> => {
      if (markdownTabId) useTabStore.getState().togglePreview(markdownTabId, false);
      await sleep(150);
    };
    const showPreview = async (): Promise<void> => {
      if (markdownTabId) useTabStore.getState().togglePreview(markdownTabId, true);
      await sleep(150);
    };
    await hidePreview();
    check(
      'Markdown Cmd/Ctrl+E 隐藏预览但保持源码',
      (await waitFor(() => !document.querySelector('[data-testid="live-preview"]'))) &&
        !!document.querySelector('[data-testid="source-editor-pane"] .cm-content'),
    );
    await showPreview();
    check(
      'Markdown Cmd/Ctrl+E 恢复双栏预览',
      (await waitFor(() => !!document.querySelector('[data-testid="live-preview"]'))) &&
        !!document.querySelector('[data-testid="source-editor-pane"] .cm-content'),
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
        await showPreview();
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

    // ── 5b. DEV-025 字段目录：7 标准字段可见、已添加禁用、面板写回 YAML 头 ──
    // 按需 Popover 需显式打开才能访问字段目录。
    document
      .querySelector<HTMLButtonElement>('[data-testid="document-properties-trigger"]')
      ?.click();
    await waitFor(() => !!document.querySelector('[data-testid="frontmatter-panel"]'));
    document.querySelector<HTMLButtonElement>('[data-testid="add-field-trigger"]')?.click();
    check(
      '字段目录打开：7 个标准字段全部可见',
      (await waitFor(() => !!document.querySelector('[data-testid="field-catalog"]'))) &&
        document.querySelectorAll('[data-testid="field-catalog-item"]').length === 7,
    );
    const catalogTitleItem = document.querySelector<HTMLButtonElement>(
      '[data-testid="field-catalog-item"][data-field="title"]',
    );
    check(
      '已添加标准字段禁用并标「已添加」',
      catalogTitleItem?.disabled === true &&
        (catalogTitleItem?.textContent ?? '').includes('已添加'),
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
    check('源码补全：CodeMirror 可聚焦', !!completionCm);
    if (completionCm) {
      completionCm.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, '# 源码模式改名页\n\n链接到[[');
      const tooltipOpen = await waitFor(
        () => !!document.querySelector('.cm-tooltip-autocomplete li'),
      );
      check(
        '源码模式输入 [[ 弹出页面候选',
        tooltipOpen &&
          [...(document.querySelectorAll('.cm-tooltip-autocomplete li') ?? [])].some((li) =>
            (li.textContent ?? '').includes('源码模式跳转目标'),
          ),
      );
      await capture('05b-source-wikilink-completion');
      completionCm.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      check(
        'Esc 关闭补全且不改动文本',
        (await waitFor(() => !document.querySelector('.cm-tooltip-autocomplete'))) &&
          !completionCm.textContent?.includes('源码模式跳转目标]]'),
      );
      document.execCommand('insertText', false, '源码模式跳转目标');
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
      document.execCommand('insertText', false, '\n\n红链 [[冒烟红链页');
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
      '新建笔记：打开 tab，编辑器头显示页面路径',
      await waitFor(() => {
        const editor = document.querySelector(
          '[data-testid="editor-view"][data-path="冒烟首页.md"]',
        );
        return !!editor && editor.textContent?.includes('冒烟首页.md');
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
