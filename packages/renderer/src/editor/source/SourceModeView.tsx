import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, LoaderCircle } from 'lucide-react';
import { undo as cmUndo, redo as cmRedo } from '@codemirror/commands';
import { EditorToolbar } from '../toolbar/EditorToolbar';
import { OutlinePanel } from '../OutlinePanel';
import type { TabDescriptor } from '../../stores/tab-store';
import { useTabStore } from '../../stores/tab-store';
import { usePageTreeStore } from '../../stores/page-tree-store';
import { useSettingsStore } from '../../stores/settings-store';
import { invoke, onEvent } from '../../lib/ipc';
import { sanitizePageTitle, titleFromPath } from '../title-sync';
import { registerAppSaveListener } from '../app-save';
import { openDocumentTab } from '../../lib/open-document';
import {
  classifyExternalChange,
  fileVersionOf,
  saveSourceText,
  type FileVersion,
  type PageFileIo,
} from './page-source-io';
import { createSourceEditor, type SourceEditorHandle } from './codemirror-host';
import { registerSourceEditor } from './active-source-editor';
import { sourceSelectionBubble } from './source-bubble';
import { applySourceFormat, sourceFormatBubbleActions } from './source-formatting';
import { handleSourceBubbleAction, openSourceCursorInsertSession } from './source-ai-assist';
import type { SourceBubbleContext } from './source-bubble';
import {
  aiSubActionIds,
  AI_ASK_ID,
  sourceToolbarEntries,
  VIEW_BLOCK_ID,
  VIEW_SOURCE_ID,
  VIEW_SPLIT_ID,
  VIEW_PREVIEW_ID,
  AI_INSERT_ID,
  UNDO_ID,
  REDO_ID,
  INSERT_TABLE_ID,
  INSERT_FLOWCHART_ID,
  INSERT_GANTT_ID,
  INSERT_TOC_ID,
  FORMAT_SELECTION_ID,
  FORMAT_DOCUMENT_ID,
  TOGGLE_OUTLINE_ID,
} from '../toolbar/entries';
import {
  MARKDOWN_TABLE_SNIPPET,
  MERMAID_FLOWCHART_SOURCE,
  MERMAID_GANTT_SOURCE,
  TABLE_OF_CONTENTS_MARKER,
  mermaidFence,
} from '../toolbar/snippets';
import { parseMarkdownOutline, type OutlineEntry } from '../outline';
import { matchPreviewHeading } from './preview-outline';
import type { EditorView } from '@codemirror/view';
import { writingAiMenuActions, writingStopControl } from '../../features/ai/writing';
import {
  createTranslationController,
  TRANSLATE_DOCUMENT_ID,
  TRANSLATE_SELECTION_ACTION_ID,
  type TranslationController,
} from '../../features/ai/translation';
import { LivePreview, type InternalLinkNavigation } from './LivePreview';
import { parseWholePage } from './parse-guard';
import {
  registerModeSwitchHandler,
  registerPreviewEnterHandler,
  requestMarkdownViewChange,
  requestSourceModeToggle,
} from './source-mode-toggle';
import { syncScrollRatio } from './scroll-sync';
import { sourceWikilinkCompletion } from './wikilink-completion';
import { createRedlinkPage, currentPageCandidates } from '../wikilink-page-ops';
import { DocumentPropertiesPopover } from '../../features/frontmatter/DocumentPropertiesPopover';
import { Resizer } from '../../shell/Resizer';
import {
  collectVaultTags,
  replaceFrontmatterYaml,
  splitFrontmatterParts,
  type FrontmatterParts,
} from '../../features/frontmatter/frontmatter-utils';
import {
  parseFrontmatterYaml,
  serializeFrontmatterYaml,
  type FrontmatterData,
} from '@nexnote/kernel';

type LoadState =
  { phase: 'loading' } | { phase: 'ready'; text: string } | { phase: 'error'; message: string };
type SaveState = 'saved' | 'saving' | 'error';

interface FrontmatterPanelState {
  data: FrontmatterData;
  source: string;
  locked: boolean;
  parseError: string | null;
}

const EMPTY_FRONTMATTER: FrontmatterPanelState = {
  data: {},
  source: '',
  locked: false,
  parseError: null,
};

/** IPC 适配器：renderer 永不直访 Node fs。 */
const ipcIo: PageFileIo = {
  stat: (path) => invoke('fs:stat', { path }),
  read: (path) => invoke('fs:readTextFile', { path }),
  exists: (path) => invoke('fs:exists', { path }),
  write: (path, content) => invoke('fs:writeTextFile', { path, content, createParentDirs: true }),
  renameLinked: async (from, to) => {
    await invoke('fs:renameLinked', { from, to });
  },
};

/** Wikilink 目标名 → vault 相对路径（与块编辑模式红链创建一致，逐段清洗保留嵌套路径）。 */
function wikilinkPath(pageName: string): string {
  const segments = (pageName.split('#')[0] ?? '').split('/');
  return `${segments.map((segment) => sanitizePageTitle(segment)).join('/')}.md`;
}

/**
 * 源码模式视图（DEV-020）：左 CodeMirror 源码 + 右只读 Live Preview。
 *
 * - 读取/保存均为逐字节原文，不经 TipTap 序列化；首个 H1 ↔ 文件名绑定与块编辑一致
 * - 模式切换前 flush，失败停留源码模式；切回块模式前整页解析守卫
 * - 外部文件变化：无本地修改直接重载；有未保存源码时暂停自动保存并提示选择
 * - DEV-025：format=markdown 的文档常驻 FrontmatterPanel，YAML 头从 CodeMirror 正文
 *   抽离、由面板承载；序列化仅发生在经面板实际编辑之后（未编辑往返字节不变）。
 *   native-block 文档的临时源码模式保持原语义：面板隐藏、YAML 原文在编辑框中。
 */
export function SourceModeView({ tab }: { tab: TabDescriptor }) {
  const initialPath = tab.pagePath ?? `${sanitizePageTitle(tab.title)}.md`;
  const isMarkdown = tab.format === 'markdown';
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<FileVersion | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [displayPath, setDisplayPath] = useState(initialPath);
  const [previewText, setPreviewText] = useState('');
  const [fm, setFm] = useState<FrontmatterPanelState>(EMPTY_FRONTMATTER);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const markdownView = tab.markdownView ?? (tab.previewVisible === false ? 'source' : 'split');
  const previewVisible = markdownView !== 'source';
  const previewOnly = markdownView === 'preview';
  const splitRatio = tab.splitRatio ?? 0.5;
  const vaultSettings = useSettingsStore((state) => state.vault);
  const autoSaveMs = vaultSettings?.editor.autoSaveMs ?? 1500;

  const hostRef = useRef<HTMLDivElement>(null);
  const splitHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SourceEditorHandle | null>(null);
  // 临时翻译（DEV-041）：划词浮层 + 全文临时视图；生命周期与源码编辑器一致。
  const translationControllerRef = useRef<TranslationController | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  // DEV-048：悬浮目录直接定位后的短窗内挂起源码→预览比例同步。CM 的 scrollIntoView
  // 会在当前任务结束后才派发 scroll 事件，晚于直接定位启动的 smooth 滚动，若不挂起
  // 会用比例位置覆盖标题定位（真实滚动下 smoke 复现；jsdom 单测无法覆盖该时序）。
  const outlineNavSyncSuppressedUntilRef = useRef(0);
  const pathRef = useRef(initialPath);
  // H1 rename updates the tab path after the current editor has already saved the document.
  // Mark that metadata transition so the path-dependent load effect does not remount it.
  const renameTargetRef = useRef<string | null>(null);
  const textRef = useRef('');
  const baseTextRef = useRef('');
  const baseVersionRef = useRef<FileVersion | null>(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const unmountedRef = useRef(false);
  // DEV-025：markdown 文档的 YAML 拆装状态。parts 始终指向「载入磁盘时」的原始拆分；
  // 面板编辑只更新 fmYamlRef（序列化结果）并置 fmEdited，正文编辑只更新 textRef（body）。
  const partsRef = useRef<FrontmatterParts>({ header: null, yaml: null, separator: '', body: '' });
  const fmEditedRef = useRef(false);
  const fmYamlRef = useRef<string | null>(null);
  const ready = load.phase === 'ready';
  // DEV-047 悬浮目录：局部 UI 状态，不落 store；切换三视图不重建 CodeMirror。
  const [outlineVisible, setOutlineVisible] = useState(false);
  const outlineVisibleRef = useRef(false);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);

  useEffect(() => {
    hostRef.current?.toggleAttribute('inert', previewOnly);
  }, [previewOnly]);

  useEffect(() => {
    outlineVisibleRef.current = outlineVisible;
  }, [outlineVisible]);

  /** 悬浮目录数据源：与 CodeMirror 正文（无 YAML 头）同源，点击定位偏移可直接使用。 */
  const refreshOutline = useCallback((body: string): void => {
    if (!outlineVisibleRef.current) return;
    setOutline(parseMarkdownOutline(body));
  }, []);

  /** 载入/重载原文：拆出 YAML 头并刷新面板状态（解析失败锁定源码模式、保留原文）。 */
  const absorbText = useCallback(
    (text: string): FrontmatterParts => {
      const parts = isMarkdown
        ? splitFrontmatterParts(text)
        : { header: null, yaml: null, separator: '', body: text };
      partsRef.current = parts;
      fmEditedRef.current = false;
      fmYamlRef.current = parts.yaml;
      if (!isMarkdown) {
        setFm(EMPTY_FRONTMATTER);
        return parts;
      }
      if (parts.yaml === null) {
        setFm(EMPTY_FRONTMATTER);
        return parts;
      }
      try {
        setFm({
          data: parseFrontmatterYaml(parts.yaml),
          source: parts.yaml,
          locked: false,
          parseError: null,
        });
      } catch (error) {
        setFm({
          data: {},
          source: parts.yaml,
          locked: true,
          parseError: error instanceof Error ? error.message : String(error),
        });
      }
      return parts;
    },
    [isMarkdown],
  );

  /**
   * 组装写盘文本（ADR-0004 / DEV-025 保真语义）：
   * - 未编辑 YAML：header + separator + 正文逐字节还原（正文编辑也绝不重排 YAML）
   * - 已编辑 YAML：仅替换 YAML 区域，分隔线风格、头部与正文间空行、正文字节不动
   */
  const composeDocument = useCallback((): string => {
    const parts = partsRef.current;
    const body = textRef.current;
    if (!isMarkdown) return body;
    if (!fmEditedRef.current) {
      return parts.header !== null ? parts.header + parts.separator + body : body;
    }
    const yaml = fmYamlRef.current;
    if (yaml === null || yaml.trim().length === 0) return body;
    const base = parts.header !== null ? parts.header + parts.separator + body : body;
    return replaceFrontmatterYaml(base, yaml);
  }, [isMarkdown]);

  /** 保存当前缓冲（版本检查 → H1 改名 → 逐字节写回）。串行化避免旧保存覆盖新保存。 */
  const runSave = useCallback(async (): Promise<void> => {
    const bodySnapshot = textRef.current;
    const text = composeDocument();
    const fromPath = pathRef.current;
    const result = await saveSourceText({
      io: ipcIo,
      path: fromPath,
      text,
      baseVersion: baseVersionRef.current,
    });
    if (result.kind === 'conflict') {
      // 不静默覆盖任一版本：暂停自动保存，交给横幅处理。
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      setConflict(result.diskVersion);
      setSaveState('error');
      setSaveError('磁盘文件已被外部修改，已暂停自动保存');
      throw new Error('外部修改冲突，等待用户选择');
    }
    baseVersionRef.current = result.version;
    baseTextRef.current = text;
    if (textRef.current === bodySnapshot) dirtyRef.current = false;
    if (result.renamedFrom) {
      const tree = usePageTreeStore.getState();
      tree.applyEvent({ kind: 'unlink', path: result.renamedFrom });
      tree.applyEvent({ kind: 'add', path: result.path });
      // The tab pagePath updates next; the load effect consumes this marker and
      // treats the transition as pure metadata instead of a full source reload.
      renameTargetRef.current = result.path;
      pathRef.current = result.path;
      setDisplayPath(result.path);
    }
    if (result.title || result.path !== fromPath) {
      useTabStore.getState().updateTab(tab.id, {
        title: result.title ?? titleFromPath(result.path),
        pagePath: result.path,
      });
    }
  }, [tab.id, composeDocument]);

  const runSaveTracked = useCallback(async (): Promise<void> => {
    setSaveState('saving');
    setSaveError(null);
    saveChainRef.current = saveChainRef.current.then(runSave, runSave);
    try {
      await saveChainRef.current;
      if (!unmountedRef.current) setSaveState('saved');
    } catch (error) {
      if (!unmountedRef.current) {
        setSaveState('error');
        setSaveError(
          (previous) => previous ?? (error instanceof Error ? error.message : String(error)),
        );
      }
      throw error;
    }
  }, [runSave]);

  /** 防抖保存；冲突期间不排新任务（runSave 会先失败并停表）。 */
  const scheduleSave = useCallback((): void => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void runSaveTracked().catch(() => undefined);
    }, autoSaveMs);
  }, [autoSaveMs, runSaveTracked]);

  /** 立即落盘待保存内容（无修改则不写盘：仅切换模式不得触发规范化写回）。 */
  const flush = useCallback(async (): Promise<void> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!dirtyRef.current) return;
    await runSaveTracked();
  }, [runSaveTracked]);

  /** 重载磁盘内容（外部 change / 冲突选择「读取磁盘并重载」）。 */
  const reloadFromDisk = useCallback(async (): Promise<void> => {
    const text = await invoke('fs:readTextFile', { path: pathRef.current });
    const info = await invoke('fs:stat', { path: pathRef.current });
    baseVersionRef.current = fileVersionOf(info);
    baseTextRef.current = text;
    dirtyRef.current = false;
    const parts = absorbText(text);
    editorRef.current?.setText(parts.body);
    textRef.current = parts.body;
    refreshOutline(parts.body);
    setPreviewText(composeDocument());
  }, [absorbText, composeDocument, refreshOutline]);

  /**
   * 应用自身写入（origin:'app'）变化：绝不弹冲突，静默刷新基线。
   * - clean → 静默重载磁盘内容（如 renameWithLinks 联动重写了本页链接）
   * - dirty → 仅把基线刷新到磁盘当前版本并保持本地 buffer：我们的写入不可能与
   *   用户意图冲突；buffer 与磁盘不同说明本地有更新输入，继续等 autosave。
   */
  const refreshBaselineFromDisk = useCallback(async (): Promise<void> => {
    try {
      const [text, info] = await Promise.all([
        invoke('fs:readTextFile', { path: pathRef.current }),
        invoke('fs:stat', { path: pathRef.current }),
      ]);
      baseVersionRef.current = fileVersionOf(info);
      baseTextRef.current = text;
      if (dirtyRef.current) return;
      // 竞态防护：读取期间用户又开始输入（dirty）则只刷新基线，不动编辑器
      if (text !== composeDocument()) {
        const parts = absorbText(text);
        editorRef.current?.setText(parts.body);
        textRef.current = parts.body;
        refreshOutline(parts.body);
        setPreviewText(composeDocument());
      }
    } catch {
      // 文件竞态消失（如被改名/删除）：交给页面树 unlink 流程
    }
  }, [absorbText, composeDocument, refreshOutline]);

  // ── 加载：原始字节，不做 H1 绑定（无 H1 时不补写，保持原文） ──
  useEffect(() => {
    const nextPath = tab.pagePath ?? `${sanitizePageTitle(tab.title)}.md`;
    // H1 rename already saved this document and updated pathRef before updateTab.
    // Keep the existing CodeMirror instance and its selection/scroll state.
    if (renameTargetRef.current === nextPath) {
      renameTargetRef.current = null;
      return;
    }
    pathRef.current = nextPath;
    setDisplayPath(nextPath);
    setLoad({ phase: 'loading' });
    setSaveError(null);
    let cancelled = false;
    void (async () => {
      try {
        const text = await invoke('fs:readTextFile', { path: nextPath });
        const info = await invoke('fs:stat', { path: nextPath });
        if (cancelled) return;
        baseVersionRef.current = fileVersionOf(info);
        baseTextRef.current = text;
        dirtyRef.current = false;
        const parts = absorbText(text);
        textRef.current = parts.body;
        refreshOutline(parts.body);
        setPreviewText(composeDocument());
        setLoad({ phase: 'ready', text });
      } catch (error) {
        if (!cancelled) {
          setLoad({
            phase: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // tab 标题只会随同 pagePath 改名更新；pagePath/tab 生命周期才应触发原文重载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.pagePath, tab.id]);

  // 临时翻译编排器（DEV-041）：经 ref 读取实时源码与路径，控制器本身稳定；
  // 卸载时关闭两个会话（关闭即弃，绝不写入源码）。
  useEffect(() => {
    translationControllerRef.current = createTranslationController({
      getDocumentText: () => editorRef.current?.view.state.doc.toString() ?? '',
      getDocumentMeta: () => ({
        path: pathRef.current,
        title: titleFromPath(pathRef.current),
      }),
    });
    return () => {
      translationControllerRef.current?.closeSelection();
      translationControllerRef.current?.closeDocument();
      translationControllerRef.current = null;
    };
  }, []);

  // ── 挂载 CodeMirror（每个 ready 周期一次；源码与块编辑 undo 栈天然独立） ──
  useEffect(() => {
    if (!ready || !hostRef.current || editorRef.current) return;
    unmountedRef.current = false;
    const editor = createSourceEditor(hostRef.current, {
      initialText: load.phase === 'ready' ? partsRef.current.body : '',
      onChange: (text) => {
        dirtyRef.current = true;
        textRef.current = text;
        setPreviewText(composeDocument());
        refreshOutline(text);
        scheduleSave();
      },
      onScroll: (scrollDOM) => {
        const preview = previewScrollRef.current;
        if (!preview) return;
        if (Date.now() < outlineNavSyncSuppressedUntilRef.current) return;
        const next = syncScrollRatio(
          {
            scrollTop: scrollDOM.scrollTop,
            scrollHeight: scrollDOM.scrollHeight,
            clientHeight: scrollDOM.clientHeight,
          },
          { scrollHeight: preview.scrollHeight, clientHeight: preview.clientHeight },
        );
        if (preview.scrollTop !== next) preview.scrollTop = next;
      },
      // 划词工具栏（与块编辑同一按钮集）：格式化五项 + 双链平铺，AI 写作、询问 AI
      // 与划词翻译收口为单一「AI」下拉（DEV-034 / DEV-041）。格式化为 Markdown 语法
      // 包裹（单事务可 undo，不经块编辑器序列化）；AI 流式预览经共享
      // WritingAssistantLayer（WorkspaceView 全局挂载），Accept 单事务写回可 undo；
      // 生成中由注入的停止控件取消会话；划词翻译打开只读浮层，无写回路径。
      extraExtensions: [
        sourceWikilinkCompletion({ getPages: currentPageCandidates, onPick: createRedlinkPage }),
        sourceSelectionBubble({
          actions: sourceFormatBubbleActions(),
          aiMenu: { label: 'AI', actions: writingAiMenuActions() },
          extraControl: writingStopControl(),
          // 选区消失（折叠/空文本）时关闭划词翻译浮层
          onSelectionLost: () => translationControllerRef.current?.closeSelection(),
          onAction: (id, ctx) => {
            const editor = editorRef.current;
            if (!editor) return;
            if (id === TRANSLATE_SELECTION_ACTION_ID) {
              translationControllerRef.current?.translateSelection({
                text: ctx.text,
                coords: ctx.coords,
              });
              return;
            }
            if (applySourceFormat(editor.view, id)) return;
            handleSourceBubbleAction(editor.view, id, ctx, { getDocPath: () => pathRef.current });
          },
        }),
      ],
    });
    editorRef.current = editor;
    const unregisterSourceEditor = registerSourceEditor(editor);
    return () => {
      unregisterSourceEditor();
      editorRef.current = null;
      editor.destroy();
      unmountedRef.current = true;
    };
    // scheduleSave 闭包经 ref 读实时值，此处只需随 ready 周期挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // ready 且目录可见时初始化目录数据（面板关闭期间不解析）。
  useEffect(() => {
    if (ready && outlineVisible) refreshOutline(textRef.current);
  }, [ready, outlineVisible, refreshOutline]);

  // ── 保存契约：app-wide save / 窗口 blur / 卸载（tab 关闭或切回块模式） ──
  useEffect(() => {
    const unregister = registerAppSaveListener(window, () => flush());
    const onBlur = () => void flush().catch(() => undefined);
    window.addEventListener('blur', onBlur);
    return () => {
      unregister();
      window.removeEventListener('blur', onBlur);
      void flush().catch(() => undefined);
    };
  }, [flush]);

  // ── 外部文件变化：写入前版本检查为准，不只依赖延迟到达的 watcher 事件 ──
  // origin:'app'（应用自身写入）绝不弹冲突，仅静默刷新基线/重载；
  // 未带 origin 的真外部事件保持 conflict/reload 语义。
  useEffect(() => {
    const unregister = onEvent('fs:changed', (event) => {
      const current = pathRef.current;
      if (event.kind !== 'change' || event.path !== current) return;
      if (event.origin === 'app') {
        void refreshBaselineFromDisk();
        return;
      }
      void (async () => {
        const result = await classifyExternalChange({
          io: ipcIo,
          path: current,
          baseVersion: baseVersionRef.current,
          baseText: baseTextRef.current,
          dirty: dirtyRef.current,
        });
        if (result.kind === 'unchanged') return;
        if (result.kind === 'reload') {
          try {
            await reloadFromDisk();
          } catch {
            // 文件竞态消失（如被改名）：交给页面树 unlink 流程
          }
          return;
        }
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        setConflict(result.version);
        setSaveState('error');
        setSaveError('磁盘文件已被外部修改，已暂停自动保存');
      })();
    });
    return unregister;
  }, [reloadFromDisk, refreshBaselineFromDisk]);

  // ── 模式切换生命周期：flush → 整页解析守卫；失败停留源码模式 ──
  useEffect(() => {
    return registerModeSwitchHandler(tab.id, async () => {
      try {
        await flush();
      } catch {
        setSwitchError('保存失败，已停留源码模式');
        return false;
      }
      const parsed = parseWholePage(composeDocument());
      if (!parsed.ok) {
        setSwitchError(`整页解析失败，已停留源码模式：${parsed.message}`);
        return false;
      }
      setSwitchError(null);
      return true;
    });
  }, [tab.id, flush, composeDocument]);

  // ── 进入预览视图前的 flush 守卫（编辑界面即将隐藏；失败停留当前视图）──
  useEffect(() => {
    return registerPreviewEnterHandler(tab.id, async () => {
      try {
        await flush();
      } catch {
        setSwitchError('保存失败，已停留当前视图');
        return false;
      }
      setSwitchError(null);
      return true;
    });
  }, [tab.id, flush]);

  // ── 预览导航：先保存，成功后经统一入口按目标文档格式打开 ──
  const navigate = useCallback(
    (link: InternalLinkNavigation): void => {
      void (async () => {
        const nextPath = link.wikilink ? wikilinkPath(link.target) : `${link.target}.md`;
        if (!previewOnly) {
          try {
            await flush(); // 保存失败则取消导航
          } catch {
            return;
          }
        }
        if (!(await invoke('fs:exists', { path: nextPath }))) {
          await invoke('fs:writeTextFile', {
            path: nextPath,
            content: `# ${titleFromPath(nextPath)}\n\n`,
            createParentDirs: true,
          });
        }
        // 经统一文档入口导航（ADR-0004）：sidecar markdown 保持在源码编辑器，绝不挂 TipTap；
        // 预览视图内的导航保持预览视图（无编辑界面可 flush）。
        await openDocumentTab(nextPath, titleFromPath(nextPath), {
          initialMarkdownView: previewOnly ? 'preview' : undefined,
        });
      })();
    },
    [flush, previewOnly],
  );

  /**
   * 悬浮目录定位（DEV-047 / DEV-048）：
   * - 源码/分栏：OutlineEntry 的 from/to 相对 CodeMirror 正文（无 YAML 头），单事务
   *   重设选区并滚动；分栏下预览同时按归一化文本直接滚到对应 heading——比例滚动同步
   *   只服务连续滚动场景，内容高度分布不同时无法保证落在标题处（DEV-048 反馈）。
   * - 预览视图：正文只读，收集预览 heading 元素后优先按文本匹配定位（引用/HTML 标题
   *   会使纯 ordinal 索引错位），匹配不到再回退 ordinal。
   */
  const locateOutlineEntry = useCallback(
    (entry: OutlineEntry): void => {
      const scrollPreviewToEntry = (): void => {
        const headings = [
          ...(previewScrollRef.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? []),
        ];
        matchPreviewHeading(headings, entry)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      };
      if (previewOnly) {
        scrollPreviewToEntry();
        return;
      }
      const editor = editorRef.current;
      if (!editor) return;
      const from = entry.from ?? 0;
      const to = entry.to ?? from;
      // 先挂起比例同步再滚动编辑器：让随后的 scroll 事件不覆盖下面的直接定位。
      // 窗口需覆盖 CM 滚动事件派发 + 预览 smooth 滚动全程（按距离自适应可达数百毫秒）。
      outlineNavSyncSuppressedUntilRef.current = Date.now() + 1_200;
      editor.view.dispatch({
        selection: { anchor: from, head: Math.max(from, to) },
        scrollIntoView: true,
      });
      editor.focus();
      if (previewVisible) scrollPreviewToEntry();
    },
    [previewOnly, previewVisible],
  );

  // ── 冲突选择：保留本地（以本地覆盖磁盘）/ 读取磁盘并重载 ──
  const keepLocal = useCallback((): void => {
    void (async () => {
      const info = await invoke('fs:stat', { path: pathRef.current });
      baseVersionRef.current = fileVersionOf(info);
      setConflict(null);
      setSaveState('saving');
      setSaveError(null);
      dirtyRef.current = true;
      await runSaveTracked().catch(() => undefined);
    })();
  }, [runSaveTracked]);

  const takeDisk = useCallback((): void => {
    void reloadFromDisk()
      .then(() => {
        setConflict(null);
        setSaveState('saved');
        setSaveError(null);
      })
      .catch(() => undefined);
  }, [reloadFromDisk]);

  /**
   * DEV-025 面板写回：表格 / YAML 两种编辑都走这里。
   * 序列化仅发生在真实编辑时（fmEditedRef 置位）；不可解析时面板侧不会回调，原文保留。
   */
  const applyFrontmatterEdit = useCallback(
    (yaml: string | null, data: FrontmatterData): void => {
      fmEditedRef.current = true;
      fmYamlRef.current = yaml;
      setFm({ data, source: yaml ?? '', locked: false, parseError: null });
      dirtyRef.current = true;
      setPreviewText(composeDocument());
      scheduleSave();
    },
    [composeDocument, scheduleSave],
  );

  // 标签自动补全：markdown 属性面板做全库扫描（与块编辑 EditorView 的回退扫描同一来源），
  // 扫描失败降级为空列表，不阻塞属性编辑。
  useEffect(() => {
    if (!ready || !isMarkdown) return;
    let cancelled = false;
    void collectVaultTags({
      listDir: (relativePath) => invoke('fs:listDir', { path: relativePath }),
      readTextFile: (relativePath) => invoke('fs:readTextFile', { path: relativePath }),
    })
      .then((tags) => {
        if (!cancelled) setKnownTags(tags);
      })
      .catch(() => {
        // vault 未就绪等场景忽略；标签自动补全可降级为空
      });
    return () => {
      cancelled = true;
    };
  }, [ready, isMarkdown]);

  const adjustSplitRatio = useCallback(
    (delta: number): void => {
      useTabStore.getState().setSplitRatio(tab.id, splitRatio + delta);
    },
    [splitRatio, tab.id],
  );

  const handleSplitDrag = useCallback(
    (movement: number): void => {
      const width = splitHostRef.current?.getBoundingClientRect().width ?? 0;
      if (width > 0) adjustSplitRatio(movement / width);
    },
    [adjustSplitRatio],
  );

  const status =
    saveState === 'saving'
      ? { icon: LoaderCircle, text: '保存中…', className: 'animate-spin' }
      : saveState === 'error'
        ? { icon: AlertCircle, text: '保存失败', className: 'text-destructive' }
        : { icon: Check, text: '已保存', className: '' };
  const StatusIcon = status.icon;

  /**
   * DEV-035 工具栏命令分发（ADR-0006）：源码模式下的动作落点。
   * 格式动作经 CodeMirror 单事务写回（空选区插入语法骨架）；AI 动作以选区为目标，
   * 无选区时退化到当前行（「当前段落」语义）；视图动作切换块编辑 / 预览。
   */
  const runToolbarCommand = (id: string): void => {
    const view = (): EditorView | null => editorRef.current?.view ?? null;
    const aiContext = (): SourceBubbleContext | null => {
      const v = view();
      if (!v?.state) return null;
      const selection = v.state.selection.main;
      const line = v.state.doc.lineAt(selection.from);
      const from = selection.empty ? line.from : selection.from;
      const to = selection.empty ? line.to : selection.to;
      const text = v.state.sliceDoc(from, to);
      if (!text.trim()) return null;
      const coords = v.coordsAtPos(from) ?? { top: 0, left: 0 };
      return { text, from, to, coords: { top: coords.top, left: coords.left } };
    };
    if (id === TOGGLE_OUTLINE_ID) {
      const next = !outlineVisibleRef.current;
      outlineVisibleRef.current = next;
      setOutlineVisible(next);
      if (next) setOutline(parseMarkdownOutline(textRef.current));
      return;
    }
    // 预览态是严格只读边界：导航动作在上方已处理，其余编辑命令一律忽略。
    if (previewOnly && ![VIEW_SOURCE_ID, VIEW_SPLIT_ID, VIEW_PREVIEW_ID].includes(id)) return;
    if (id === UNDO_ID || id === REDO_ID) {
      const v = view();
      if (v) (id === UNDO_ID ? cmUndo : cmRedo)(v);
      return;
    }
    if (id === FORMAT_SELECTION_ID || id === FORMAT_DOCUMENT_ID) {
      editorRef.current?.formatMarkdown(id === FORMAT_SELECTION_ID ? 'selection' : 'document');
      return;
    }
    if (id === INSERT_TABLE_ID) {
      editorRef.current?.insertBlock(MARKDOWN_TABLE_SNIPPET);
      return;
    }
    if (id === INSERT_FLOWCHART_ID || id === INSERT_GANTT_ID) {
      editorRef.current?.insertBlock(
        mermaidFence(id === INSERT_FLOWCHART_ID ? MERMAID_FLOWCHART_SOURCE : MERMAID_GANTT_SOURCE),
      );
      return;
    }
    if (id === INSERT_TOC_ID) {
      editorRef.current?.insertBlock(TABLE_OF_CONTENTS_MARKER);
      return;
    }
    if (id === TRANSLATE_DOCUMENT_ID) {
      translationControllerRef.current?.translateDocument();
      return;
    }
    if (id === AI_INSERT_ID) {
      const v = view();
      if (!v) return;
      const instruction = window.prompt('AI 插入指令', '请基于当前上下文补充内容');
      if (instruction?.trim())
        openSourceCursorInsertSession(v, instruction, { getDocPath: () => pathRef.current });
      return;
    }
    if (id === AI_ASK_ID || aiSubActionIds().includes(id)) {
      const v = view();
      const ctx = aiContext();
      if (!v || !ctx) return;
      handleSourceBubbleAction(v, id, ctx, { getDocPath: () => pathRef.current });
      return;
    }
    if (id === VIEW_BLOCK_ID) {
      void requestSourceModeToggle(tab.id);
      return;
    }
    if (id === VIEW_SOURCE_ID) {
      useTabStore.getState().setMarkdownView(tab.id, 'source');
      return;
    }
    if (id === VIEW_SPLIT_ID) {
      useTabStore.getState().setMarkdownView(tab.id, 'split');
      return;
    }
    if (id === VIEW_PREVIEW_ID) {
      void requestMarkdownViewChange(tab.id, 'preview');
      return;
    }
    const cv = view();
    if (cv) applySourceFormat(cv, id);
  };

  if (load.phase === 'loading') {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> 正在打开 {displayPath}…
      </div>
    );
  }
  if (load.phase === 'error') {
    return (
      <div className="mx-auto mt-12 max-w-lg rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        <div className="mb-1 flex items-center gap-2 font-medium">
          <AlertCircle className="size-4" /> 页面打开失败
        </div>
        <p className="text-xs">{load.message}</p>
      </div>
    );
  }

  return (
    <div
      data-testid="source-mode-view"
      data-path={displayPath}
      className="relative flex h-full min-h-0 flex-col"
    >
      <EditorToolbar
        label="编辑器工具栏"
        entries={sourceToolbarEntries({ isMarkdown, markdownView, previewVisible, previewOnly })}
        onCommand={runToolbarCommand}
        tools={
          isMarkdown && !previewOnly ? (
            <DocumentPropertiesPopover
              data={fm.data}
              source={fm.source}
              knownTags={knownTags}
              locked={fm.locked}
              parseError={fm.parseError}
              onChange={(next) => applyFrontmatterEdit(serializeFrontmatterYaml(next), next)}
              onYamlChange={(source, next) => applyFrontmatterEdit(source, next)}
            />
          ) : undefined
        }
        status={
          <span
            data-testid="editor-save-status"
            className="flex shrink-0 items-center gap-1"
            title={saveError ?? undefined}
          >
            <StatusIcon className={`size-3 ${status.className}`} />
            {status.text}
          </span>
        }
      />
      {conflict && (
        <div
          data-testid="source-conflict-banner"
          className="flex shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
        >
          <AlertCircle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">磁盘文件已被外部修改，本地还有未保存的修改。</span>
          <button
            type="button"
            data-testid="conflict-keep-local"
            className="shrink-0 rounded border px-2 py-0.5 hover:bg-accent"
            onClick={keepLocal}
          >
            保留本地
          </button>
          <button
            type="button"
            data-testid="conflict-take-disk"
            className="shrink-0 rounded border px-2 py-0.5 hover:bg-accent"
            onClick={takeDisk}
          >
            读取磁盘并重载
          </button>
        </div>
      )}
      {switchError && (
        <div
          data-testid="source-switch-error"
          className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
        >
          {switchError}
        </div>
      )}

      <div ref={splitHostRef} className="flex min-h-0 flex-1">
        <div
          data-testid="source-editor-pane"
          className={`min-h-0 min-w-0 overflow-hidden ${previewOnly ? 'absolute size-px opacity-0' : 'relative'}`}
          style={
            previewOnly
              ? undefined
              : { flex: `0 0 ${previewVisible ? `${splitRatio * 100}%` : '100%'}` }
          }
          ref={hostRef}
          aria-hidden={previewOnly}
          tabIndex={previewOnly ? -1 : undefined}
        />
        {markdownView === 'split' && (
          <Resizer
            orientation="vertical"
            testId="markdown-split-resizer"
            onDrag={handleSplitDrag}
            onDoubleClick={() => useTabStore.getState().setSplitRatio(tab.id, 0.5)}
            onKeyAdjust={(direction, coarse) => adjustSplitRatio(direction * (coarse ? 0.1 : 0.02))}
          />
        )}
        {previewVisible && (
          <LivePreview
            markdown={previewText}
            sourcePath={displayPath}
            onNavigate={navigate}
            scrollRef={previewScrollRef}
            className={previewOnly ? 'flex-1' : undefined}
            fillContent={previewOnly}
          />
        )}
      </div>
      {outlineVisible && (
        <OutlinePanel
          entries={outline}
          onNavigate={locateOutlineEntry}
          onClose={() => setOutlineVisible(false)}
          className="absolute right-3 top-10 z-20"
        />
      )}
    </div>
  );
}
