import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Code2, Eye, EyeOff, LoaderCircle, Save } from 'lucide-react';
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
import { handleSourceBubbleAction, SOURCE_CHAT_ASK_ACTION } from './source-ai-assist';
import { writingBubbleActions } from '../../features/ai/writing';
import { LivePreview, type InternalLinkNavigation } from './LivePreview';
import { parseWholePage } from './parse-guard';
import { registerModeSwitchHandler, requestSourceModeToggle } from './source-mode-toggle';
import { syncScrollRatio } from './scroll-sync';
import { sourceWikilinkCompletion } from './wikilink-completion';
import { createRedlinkPage, currentPageCandidates } from '../wikilink-page-ops';
import { DocumentPropertiesPopover } from '../../features/frontmatter/DocumentPropertiesPopover';
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
  const previewVisible = tab.previewVisible !== false;
  const vaultSettings = useSettingsStore((state) => state.vault);
  const autoSaveMs = vaultSettings?.editor.autoSaveMs ?? 1500;

  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SourceEditorHandle | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
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
    setPreviewText(composeDocument());
  }, [absorbText, composeDocument]);

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
        setPreviewText(composeDocument());
      }
    } catch {
      // 文件竞态消失（如被改名/删除）：交给页面树 unlink 流程
    }
  }, [absorbText, composeDocument]);

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
        scheduleSave();
      },
      onScroll: (scrollDOM) => {
        const preview = previewScrollRef.current;
        if (!preview) return;
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
      // 划词工具栏（与块编辑一致，DEV-023 按钮集统一）：格式化五项 + 双链 +
      // 询问 AI + 白名单写作动作。格式化为 Markdown 语法包裹（单事务可 undo，
      // 不经块编辑器序列化）；AI 流式预览经共享 WritingAssistantLayer（WorkspaceView
      // 全局挂载），Accept 单事务写回可 undo。
      extraExtensions: [
        sourceWikilinkCompletion({ getPages: currentPageCandidates, onPick: createRedlinkPage }),
        sourceSelectionBubble({
          actions: [
            ...sourceFormatBubbleActions(),
            ...writingBubbleActions(),
            { id: SOURCE_CHAT_ASK_ACTION, title: '询问 AI' },
          ],
          onAction: (id, ctx) => {
            const editor = editorRef.current;
            if (!editor) return;
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

  // ── 预览导航：先保存，成功后经统一入口按目标文档格式打开 ──
  const navigate = useCallback(
    (link: InternalLinkNavigation): void => {
      void (async () => {
        const nextPath = link.wikilink ? wikilinkPath(link.target) : `${link.target}.md`;
        try {
          await flush(); // 保存失败则取消导航
        } catch {
          return;
        }
        if (!(await invoke('fs:exists', { path: nextPath }))) {
          await invoke('fs:writeTextFile', {
            path: nextPath,
            content: `# ${titleFromPath(nextPath)}\n\n`,
            createParentDirs: true,
          });
        }
        // 经统一文档入口导航（ADR-0004）：sidecar markdown 保持在源码编辑器，绝不挂 TipTap。
        await openDocumentTab(nextPath, titleFromPath(nextPath));
      })();
    },
    [flush],
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

  const status =
    saveState === 'saving'
      ? { icon: LoaderCircle, text: '保存中…', className: 'animate-spin' }
      : saveState === 'error'
        ? { icon: AlertCircle, text: '保存失败', className: 'text-destructive' }
        : { icon: Check, text: '已保存', className: '' };
  const StatusIcon = status.icon;

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
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b px-3 text-[11px] text-muted-foreground">
        <Save className="size-3" />
        <span className="min-w-0 truncate">{displayPath}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1" title={saveError ?? undefined}>
          <StatusIcon className={`size-3 ${status.className}`} />
          {status.text}
        </span>
        {isMarkdown && (
          <DocumentPropertiesPopover
            data={fm.data}
            source={fm.source}
            knownTags={knownTags}
            locked={fm.locked}
            parseError={fm.parseError}
            onChange={(next) => applyFrontmatterEdit(serializeFrontmatterYaml(next), next)}
            onYamlChange={(source, next) => applyFrontmatterEdit(source, next)}
          />
        )}
        {tab.format === 'markdown' ? (
          <button
            type="button"
            data-testid="preview-toggle"
            title={previewVisible ? '隐藏预览（⌘/Ctrl+E）' : '显示预览（⌘/Ctrl+E）'}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent"
            onClick={() => useTabStore.getState().togglePreview(tab.id)}
          >
            {previewVisible ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            {previewVisible ? '隐藏预览' : '显示预览'}
          </button>
        ) : (
          <button
            type="button"
            data-testid="source-mode-toggle"
            title="切回块编辑模式（⌘/Ctrl+E）"
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent"
            onClick={() => void requestSourceModeToggle(tab.id)}
          >
            <Code2 className="size-3" /> 块编辑
          </button>
        )}
      </div>

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

      <div className="flex min-h-0 flex-1">
        <div
          data-testid="source-editor-pane"
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden border-r"
          ref={hostRef}
        />
        {previewVisible && (
          <LivePreview
            markdown={previewText}
            sourcePath={displayPath}
            onNavigate={navigate}
            scrollRef={previewScrollRef}
          />
        )}
      </div>
    </div>
  );
}
