import { openDocumentTab } from '../lib/open-document';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, LoaderCircle } from 'lucide-react';
import { createEditor, revealBlockFoldAt } from '@nexnote/kernel';
import { TextSelection } from '@tiptap/pm/state';
import { invoke } from '../lib/ipc';
import { useTabStore, type TabDescriptor } from '../stores/tab-store';
import { DocumentPropertiesPopover } from '../features/frontmatter/DocumentPropertiesPopover';
import { useDocumentPropertiesStore } from '../features/frontmatter/document-properties-store';
import { useIndexStore } from '../stores/index-store';
import type { FrontmatterData } from '@nexnote/kernel';
import { editorActionCatalogEntry, pluginQuickInsertMetadata } from '@nexnote/shared';
import { parseFrontmatterYaml, serializeFrontmatterYaml, splitFrontmatter } from '@nexnote/kernel';
import { collectVaultTags, inspectFrontmatter } from '../features/frontmatter/frontmatter-utils';
import { bindH1ToTitle, firstH1, sanitizePageTitle, titleFromPath } from './title-sync';
import { registerAppSaveListener } from './app-save';
import { getActiveEditor, registerEditor } from './active-editor';
import { registerModeSwitchHandler, requestSourceModeToggle } from './source/source-mode-toggle';
import {
  createWritingController,
  writingAiMenuActions,
  writingStopControl,
  type WritingController,
  writingContextMenu,
  writingSlashItems,
} from '../features/ai/writing';
import {
  createTranslationController,
  TRANSLATE_DOCUMENT_ID,
  TRANSLATE_SELECTION_ACTION_ID,
  type TranslationController,
} from '../features/ai/translation';
import { CHAT_ASK_ACTION, requestAskAi } from '../features/ai/chat/ask-ai';
import { useSettingsStore } from '../stores/settings-store';
import { onEvent } from '../lib/ipc';
import {
  classifyExternalChange,
  fileVersionOf,
  saveSourceText,
  type FileVersion,
  type PageFileIo,
} from './source/page-source-io';
import { pluginContributionRegistry } from '../registries';
import {
  buildDispatchableBlockCommands,
  buildPluginCommandSlashItems,
  buildPluginMenuItems,
  PLUGIN_MENU_ACTION_PREFIX,
} from '../features/plugins/extension-points';
import type { BlockMenuContext } from '@nexnote/kernel';
import {
  computeEditorActionContext,
  insertAtSafeBlockBoundary,
  type EditorKernelInstance,
  type SlashMenuItem,
} from '@nexnote/kernel';
import { withUncreated, filterTagCandidates } from './interactions/suggestions';
import { createRedlinkPage, currentPageCandidates } from './wikilink-page-ops';
import {
  buildBlockMenuItems,
  runBlockMenuAction,
  type BlockNeighbors,
} from './interactions/block-menu';
import {
  formatBubbleActions,
  FORMAT_BOLD,
  FORMAT_CODE,
  FORMAT_ITALIC,
  FORMAT_LINK,
  FORMAT_STRIKE,
  FORMAT_WIKILINK,
  runFormatAction,
} from './interactions/formatting';
import { usePluginStore } from '../features/plugins/plugin-store';
import { usePageTreeStore } from '../stores/page-tree-store';
import { EditorToolbar } from './toolbar/EditorToolbar';
import { OutlinePanel } from './OutlinePanel';
import {
  AI_ASK_ID,
  blockToolbarEntries,
  INSERT_ATTACHMENT_ID,
  INSERT_IMAGE_ID,
  VIEW_SOURCE_ID,
  AI_INSERT_ID,
  UNDO_ID,
  REDO_ID,
  INSERT_TABLE_ID,
  INSERT_FLOWCHART_ID,
  INSERT_GANTT_ID,
  INSERT_TOC_ID,
  TOGGLE_OUTLINE_ID,
  PARAGRAPH_ID,
} from './toolbar/entries';
import {
  applyBlockTypeAction,
  blockHeadingCapability,
  headingLevelFromAction,
} from './toolbar/heading-actions';
import { parseBlockOutline, type OutlineEntry } from './outline';
import {
  buildBuiltinSlashItems,
  buildBuiltinViewExtensions,
  flagsFromActivePlugins,
} from '../features/plugins/builtin/builtin-extensions';

interface EditorViewProps {
  tab: TabDescriptor;
}

type LoadState =
  { phase: 'loading' } | { phase: 'ready'; markdown: string } | { phase: 'error'; message: string };

type SaveState = 'saved' | 'saving' | 'error';

/**
 * 媒体插入（DEV-017 fresh 要求）：
 * - 选择文件后真正导入当前 vault（经 main 进程 IPC 原子写入），再插入 vault 相对路径
 * - 图片 → image 节点（src 为相对路径），附件 → Markdown 链接
 * - 禁止 objectURL（blob）持久化；取消/卸载无隐藏 input / 悬挂 promise / editor use-after-destroy
 */
function pickFile(accept: string): { promise: Promise<File | null>; abort: () => void } {
  let settled = false;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.style.display = 'none';
  let resolvePick: (file: File | null) => void = () => undefined;
  const abort = () => {
    if (settled) return;
    settled = true;
    input.remove();
    resolvePick(null);
  };
  const promise = new Promise<File | null>((resolve) => {
    resolvePick = resolve;
    const done = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.append(input);
    // 放在任务队列尾部触发 click，确保 DOM 已就绪（部分浏览器要求 input 已挂载）
    queueMicrotask(() => {
      if (settled) return;
      try {
        input.click();
      } catch {
        done(null);
      }
    });
  });
  return { promise, abort };
}

async function readFileAsBase64(file: File): Promise<string> {
  // 渲染进程无 Node Buffer；分块转 binary string 避免大文件栈溢出
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function attachmentTargetPath(file: File, currentPagePath: string): string {
  // 附件存到当前页面同级的 assets 目录；跨平台统一正斜杠，主进程再做 path.normalize 与沙箱校验
  const dir = currentPagePath.includes('/')
    ? currentPagePath.slice(0, currentPagePath.lastIndexOf('/'))
    : '';
  const folder = dir ? `${dir}/assets` : 'assets';
  return `${folder}/${file.name}`;
}

interface MediaInsertOptions {
  getPagePath: () => string;
  getEditor: () => EditorKernelInstance | null;
  getDestroyed: () => boolean;
  /** 登记挂起的文件选择 abort；返回反注册函数。编辑器卸载时统一取消。 */
  trackAbort: (abort: () => void) => () => void;
}

/** 媒体插入（DEV-017）：导入当前 vault 后按类型插入图片节点或附件链接。 */
type ImportedMediaHandler = (kernel: EditorKernelInstance, path: string) => boolean;

function createMediaInsert(options: MediaInsertOptions): {
  pickImage: (onImported?: ImportedMediaHandler) => Promise<boolean>;
  pickAttachment: (onImported?: ImportedMediaHandler) => Promise<boolean>;
} {
  const runInsert = async (
    accept: string,
    kernel: EditorKernelInstance,
  ): Promise<string | null> => {
    const { promise, abort } = pickFile(accept);
    const untrack = options.trackAbort(abort);
    const onUnload = () => abort();
    window.addEventListener('beforeunload', onUnload);
    try {
      const file = await promise;
      if (!file || options.getDestroyed() || options.getEditor() !== kernel) return null;
      const data = await readFileAsBase64(file);
      const currentPage = options.getPagePath();
      const target = attachmentTargetPath(file, currentPage);
      const { path } = await invoke('fs:importBinaryFile', {
        path: target,
        data,
        suggestionName: file.name,
        mime: file.type || undefined,
        createParentDirs: true,
        overwrite: false,
      });
      if (options.getDestroyed() || options.getEditor() !== kernel) return null;
      return path;
    } catch (e) {
      console.error('[EditorView] 媒体导入失败', e);
      return null;
    } finally {
      untrack();
      window.removeEventListener('beforeunload', onUnload);
    }
  };
  return {
    pickImage: async (onImported?: (kernel: EditorKernelInstance, path: string) => boolean) => {
      const kernel = options.getEditor();
      if (!kernel) return false;
      const path = await runInsert('image/*', kernel);
      if (!path) return false;
      if (onImported) return onImported(kernel, path);
      const { view } = kernel.editor;
      const node = view.state.schema.nodes.image?.create({ src: path, alt: '' });
      return node ? insertAtSafeBlockBoundary(view, node) : false;
    },
    pickAttachment: async (
      onImported?: (kernel: EditorKernelInstance, path: string) => boolean,
    ) => {
      const kernel = options.getEditor();
      if (!kernel) return false;
      const path = await runInsert('*/*', kernel);
      if (!path) return false;
      if (onImported) return onImported(kernel, path);
      kernel.insertMarkdownBlocks(`[附件](${path})`, kernel.editor.state.selection.from, 'after');
      return true;
    },
  };
}

/** 斜杠菜单的「图片 / 附件」项（与工具栏入口共用同一插入实现）。 */
function createMediaInsertSlashItems(options: MediaInsertOptions): SlashMenuItem[] {
  const media = createMediaInsert(options);
  const fromCatalog = (id: string) => {
    const action = editorActionCatalogEntry(id);
    if (!action?.quickInsert) throw new Error(`Missing canonical slash action: ${id}`);
    return {
      id: action.id,
      title: action.name,
      hint: action.hint,
      icon: action.icon,
      keywords: [...action.quickInsert.aliases],
      group: action.quickInsert.group,
      kind: action.quickInsert.kind,
      contract: {
        execution: action.quickInsert.execution,
        capability: action.quickInsert.capability,
      },
    };
  };
  return [
    {
      ...fromCatalog(INSERT_IMAGE_ID),
      action: ({ view, tr }) =>
        media.pickImage((_kernel, path) => {
          const node = view.state.schema.nodes.image?.create({ src: path, alt: '' });
          return node ? insertAtSafeBlockBoundary(view, node, tr) : false;
        }),
    },
    {
      ...fromCatalog(INSERT_ATTACHMENT_ID),
      action: ({ view, tr }) =>
        media.pickAttachment((_kernel, path) => {
          const paragraph = view.state.schema.nodes.paragraph;
          const link = view.state.schema.marks.link;
          if (!paragraph || !link) return false;
          return insertAtSafeBlockBoundary(
            view,
            paragraph.create(null, view.state.schema.text('附件', [link.create({ href: path })])),
            tr,
          );
        }),
    },
  ];
}

function buildPluginBlockSlashItems(_kernel: EditorKernelInstance): SlashMenuItem[] {
  // PluginContributionDef 与 PluginContributionView 形状同源（scopedId/pluginId/kind/title/id）
  const contributions = pluginContributionRegistry.all() as unknown as Parameters<
    typeof buildDispatchableBlockCommands
  >[0];
  const defs = buildDispatchableBlockCommands(contributions);
  const meta = pluginQuickInsertMetadata('block');
  return defs.map((d) => ({
    id: d.id,
    title: d.title,
    hint: d.blockType,
    icon: meta.icon,
    keywords: [...meta.quickInsert.aliases, ...(d.keywords ?? []).map((k) => String(k))],
    group: meta.quickInsert.group,
    kind: meta.quickInsert.kind,
    contract: { execution: meta.quickInsert.execution, capability: meta.quickInsert.capability },
    available: (context) => context.capabilities.has('plugin-defined'),
    action: ({ view, tr }) => {
      const node = view.state.schema.nodes.pluginBlock?.create({
        pluginId: d.pluginId,
        blockType: d.blockType,
        data: '{}',
      });
      return node ? insertAtSafeBlockBoundary(view, node, tr) : false;
    },
  }));
}

/** 块菜单执行时的相邻块（供上移/下移）。 */
function neighborsFor(kernel: EditorKernelInstance, blockId: string): BlockNeighbors {
  const ids: string[] = [];
  kernel.editor.state.doc.forEach((n) => {
    const id = (n.attrs as { blockId?: string }).blockId;
    if (typeof id === 'string' && id) ids.push(id);
  });
  const idx = ids.indexOf(blockId);
  if (idx < 0) return { prevBlockId: null, nextBlockId: null };
  return {
    prevBlockId: idx > 0 ? (ids[idx - 1] ?? null) : null,
    nextBlockId: idx < ids.length - 1 ? (ids[idx + 1] ?? null) : null,
  };
}

/**
 * React → 框架无关 kernel 桥：
 * - 从 vault IPC 读写 .md（Renderer 永不直接触碰 Node fs）
 * - 编辑防抖保存；卸载/窗口 blur 时 flush
 * - 默认文件名 ↔ 首 H1 绑定：文件名初始补 H1，H1 修改后原子 rename
 */
export function EditorView({ tab }: EditorViewProps) {
  const path = tab.pagePath ?? `${sanitizePageTitle(tab.title)}.md`;
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const saveStateRef = useRef<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [displayPath, setDisplayPath] = useState(path);
  const [conflict, setConflict] = useState<FileVersion | null>(null);
  const conflictRef = useRef<FileVersion | null>(null);
  const baseVersionRef = useRef<FileVersion | null>(null);
  const baseTextRef = useRef('');
  const dirtyRef = useRef(false);
  const vaultSettings = useSettingsStore((s) => s.vault);
  const autoSaveMs = vaultSettings?.editor.autoSaveMs ?? 1500;
  const hostRef = useRef<HTMLDivElement>(null);
  const kernelRef = useRef<EditorKernelInstance | null>(null);
  const pathRef = useRef(path);
  // H1 rename updates the tab path after the current kernel has already saved the document.
  // Mark that metadata transition so the path-dependent load effect does not remount it.
  const renameTargetRef = useRef<string | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const unmountedRef = useRef(false);
  const [fmData, setFmData] = useState<FrontmatterData>({});
  const [fmSource, setFmSource] = useState('');
  const [fmLocked, setFmLocked] = useState(false);
  const [fmParseError, setFmParseError] = useState<string | null>(null);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  // 内核 hashtag 闭包经 ref 读取实时值，避免标签扫描完成后重挂编辑器
  const knownTagsRef = useRef<string[]>([]);
  const indexTags = useIndexStore((s) => s.tags);
  const setDocument = useDocumentPropertiesStore((s) => s.setDocument);

  // 挂起的文件选择器（工具栏与斜杠菜单共用）：编辑器卸载时统一 abort，
  // 避免隐藏 input / 悬挂 promise。
  const pendingFilePicksRef = useRef(new Set<() => void>());

  // DEV-047 悬浮目录：局部 UI 状态（不落 store）；数据在内核 update 时惰性解析。
  const [outlineVisible, setOutlineVisible] = useState(false);
  const outlineVisibleRef = useRef(false);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  useEffect(() => {
    outlineVisibleRef.current = outlineVisible;
  }, [outlineVisible]);

  // 写作辅助编排器（DEV-010）：在 mount effect 中创建（effect 内读取 ref 合法），
  // getter 在事件触发时才经 ref 读取实时 kernel/路径；控制器本身稳定。
  const writingControllerRef = useRef<WritingController | null>(null);
  useEffect(() => {
    writingControllerRef.current = createWritingController({
      getKernel: () => kernelRef.current,
      getPageId: () => (useTabStore.getState().activeTabId === tab.id ? tab.id : null),
      getContext: () => {
        const markdown = kernelRef.current?.getMarkdown() ?? '';
        const idx = useIndexStore.getState();
        const backlinks =
          idx.backlinksFor === pathRef.current
            ? idx.backlinks.map((b) => ({ title: b.fromTitle, snippet: b.snippet }))
            : [];
        return { markdown, backlinks };
      },
    });
    return () => {
      writingControllerRef.current = null;
    };
  }, [tab.id]);

  // 临时翻译编排器（DEV-041）：划词浮层 + 全文临时视图；经 ref 读取实时文档与路径。
  // 卸载时关闭两个会话（关闭即弃，绝不写回文档）。
  const translationControllerRef = useRef<TranslationController | null>(null);
  useEffect(() => {
    translationControllerRef.current = createTranslationController({
      getDocumentText: () => kernelRef.current?.getMarkdown() ?? '',
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

  useEffect(() => {
    pathRef.current = path;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部 tab store 路径同步
    setDisplayPath(path);
  }, [path]);

  // 新建页：不存在则写入包含 H1 的初始 Markdown；已有文件则读取。
  useEffect(() => {
    // H1 rename already saved this document and updated pathRef before updateTab.
    // Keep the existing kernel and its selection/scroll state; only metadata changed.
    if (renameTargetRef.current === path) {
      renameTargetRef.current = null;
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoad({ phase: 'loading' });
        setSaveError(null);
      }
    });

    void (async () => {
      try {
        const exists = await invoke('fs:exists', { path });
        let markdown: string;
        if (exists) {
          markdown = await invoke('fs:readTextFile', { path });
        } else {
          markdown = `# ${titleFromPath(path)}\n\n`;
          await invoke('fs:writeTextFile', { path, content: markdown, createParentDirs: true });
        }

        // 默认绑定：无首 H1 则用文件名补一个（保留 frontmatter 在最前）
        if (!firstH1(markdown)) markdown = bindH1ToTitle(markdown, titleFromPath(path));
        if (!cancelled) {
          pathRef.current = path;
          const inspected = inspectFrontmatter(markdown);
          setFmData(inspected.data);
          setFmSource(inspected.source);
          setFmLocked(inspected.locked);
          setFmParseError(inspected.parseError);
          baseTextRef.current = markdown;
          const info = await invoke('fs:stat', { path });
          baseVersionRef.current = fileVersionOf(info);
          dirtyRef.current = false;
          setLoad({ phase: 'ready', markdown });
        }
      } catch (e) {
        if (!cancelled) {
          setLoad({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path]);

  const save = useCallback(
    async (markdown: string) => {
      if (unmountedRef.current) return;
      if (conflictRef.current) throw new Error('外部修改冲突，等待用户选择');
      saveStateRef.current = 'saving';
      setSaveState('saving');
      setSaveError(null);
      const io: PageFileIo = {
        stat: (p) => invoke('fs:stat', { path: p }),
        read: (p) => invoke('fs:readTextFile', { path: p }),
        exists: (p) => invoke('fs:exists', { path: p }),
        write: (p, content) =>
          invoke('fs:writeTextFile', { path: p, content, createParentDirs: true }),
        renameLinked: async (from, to) => {
          await invoke('fs:renameLinked', { from, to });
        },
      };
      const writeSnapshot = async () => {
        const fromPath = pathRef.current;
        const result = await saveSourceText({
          io,
          path: fromPath,
          text: markdown,
          baseVersion: baseVersionRef.current,
        });
        if (result.kind === 'conflict') {
          conflictRef.current = result.diskVersion;
          setConflict(result.diskVersion);
          setSaveState('error');
          setSaveError('磁盘文件已被外部修改，已暂停自动保存');
          throw new Error('外部修改冲突，等待用户选择');
        }
        baseTextRef.current = markdown;
        baseVersionRef.current = result.version;
        if (result.renamedFrom) {
          const tree = usePageTreeStore.getState();
          const format = tree.entries.find((e) => e.path === result.renamedFrom)?.format;
          tree.applyEvent({ kind: 'unlink', path: result.renamedFrom });
          tree.applyEvent({ kind: 'add', path: result.path, format });
          // The tab pagePath updates next; the load effect consumes this marker and
          // treats the transition as pure metadata instead of a full page reload.
          renameTargetRef.current = result.path;
          pathRef.current = result.path;
          setDisplayPath(result.path);
          useTabStore.getState().updateTab(tab.id, {
            title: result.title ?? titleFromPath(result.path),
            pagePath: result.path,
          });
        }
        if (kernelRef.current?.getMarkdown() === markdown) dirtyRef.current = false;
      };
      saveChainRef.current = saveChainRef.current.then(writeSnapshot, writeSnapshot);
      try {
        await saveChainRef.current;
        saveStateRef.current = 'saved';
        if (!unmountedRef.current) setSaveState('saved');
      } catch (e) {
        if (!unmountedRef.current) {
          saveStateRef.current = 'error';
          setSaveState('error');
          if (!conflictRef.current) setSaveError(e instanceof Error ? e.message : String(e));
        }
        throw e;
      }
    },
    [tab.id],
  );

  // load ready 后挂载 kernel；path 变化来自标题 rename 时不重挂（load.markdown 不变）。
  useEffect(() => {
    if (load.phase !== 'ready' || !hostRef.current) return;
    unmountedRef.current = false;
    const writingController = writingControllerRef.current;
    const trackAbort = (abort: () => void) => {
      pendingFilePicksRef.current.add(abort);
      return () => {
        pendingFilePicksRef.current.delete(abort);
      };
    };
    // DEV-015：内置插件（Mermaid/KaTeX）激活时叠加富预览 NodeView；
    // 斜杠项经函数式 extraSlashItems 在每次打开菜单时读取最新启停状态。
    const builtinFlags = flagsFromActivePlugins(usePluginStore.getState().plugins);
    const kernel = createEditor(hostRef.current, {
      initialMarkdown: load.markdown,
      saveDelayMs: autoSaveMs,
      onDocChange: () => {
        // 用户文档变更立即置 dirty：不得等防抖保存回调（间隔内退出/外部改盘需保护未落盘内容）。
        dirtyRef.current = true;
      },
      onContentChange: (markdown) => save(markdown),
      onSaveError: (e) => {
        if (!unmountedRef.current) {
          saveStateRef.current = 'error';
          setSaveState('error');
          setSaveError(e instanceof Error ? e.message : String(e));
        }
      },
      onWikilinkActivate: (target) => {
        const pageName = target.split('#')[0] || target;
        const nextPath = `${sanitizePageTitle(pageName)}.md`;
        void openDocumentTab(nextPath, titleFromPath(nextPath));
      },
      selectionBubble: {
        // DEV-034：AI 动作收口为单一「AI」下拉；格式化/双链等非 AI 动作保持平铺。
        actions: formatBubbleActions(),
        aiMenu: { label: 'AI', actions: writingAiMenuActions() },
        // 生成中的独立停止控件（会话非流式时隐藏）
        extraControl: writingStopControl(),
        onAction: (id, ctx) => {
          if (runFormatAction(id, kernelRef.current, ctx.text)) return;
          // DEV-041：划词翻译只开只读浮层，不写回、不改选区语义。
          if (id === TRANSLATE_SELECTION_ACTION_ID) {
            translationControllerRef.current?.translateSelection({
              text: ctx.text,
              coords: ctx.coords,
            });
            return;
          }
          if (id === CHAT_ASK_ACTION) {
            requestAskAi(ctx.text, titleFromPath(pathRef.current), pathRef.current);
            return;
          }
          writingController?.trigger(id, ctx);
        },
      },
      contextMenu: {
        build: (ctx) => [
          ...writingContextMenu(ctx),
          {
            id: CHAT_ASK_ACTION,
            title: '💬 询问 AI（送入对话）',
            disabled: !ctx.text.trim(),
          },
          // DEV-014：插件菜单扩展点（每次右键读取最新注册表）。
          ...buildPluginMenuItems(pluginContributionRegistry.all()),
        ],
        onAction: (id, ctx) => {
          if (id === CHAT_ASK_ACTION) {
            requestAskAi(ctx.text, titleFromPath(pathRef.current), pathRef.current);
            return;
          }
          if (id.startsWith('plugin-menu:')) {
            const scopedId = id.slice(PLUGIN_MENU_ACTION_PREFIX.length);
            const separator = scopedId.indexOf(':');
            const pluginId = scopedId.slice(0, separator);
            const commandId = scopedId.slice(separator + 1);
            void invoke('plugins:runCommand', {
              pluginId,
              commandId,
            });
            return;
          }
          writingController?.trigger(id, ctx);
        },
      },
      extraExtensions: buildBuiltinViewExtensions(builtinFlags),
      extraSlashItems: () => {
        const pluginState = usePluginStore.getState();
        return [
          ...(writingController ? writingSlashItems(writingController) : []),
          ...buildBuiltinSlashItems(flagsFromActivePlugins(pluginState.plugins)),
          ...createMediaInsertSlashItems({
            getPagePath: () => pathRef.current,
            getEditor: () => kernelRef.current,
            getDestroyed: () => unmountedRef.current,
            trackAbort,
          }),
          ...buildPluginBlockSlashItems(kernel),
          ...buildPluginCommandSlashItems(pluginState.contributions, pluginState.commands, (def) =>
            invoke('plugins:runCommand', def).then(
              () => true,
              () => false,
            ),
          ),
        ];
      },
      wikilinkSuggestions: (query) => {
        return withUncreated(currentPageCandidates(), query);
      },
      // 红链回车创建：原子 create-if-absent 写入 `# 标题` 初始页；已存在则不动（不覆盖）
      onWikilinkSuggestionPick: (item) => {
        createRedlinkPage(item);
      },
      hashtagSuggestions: (query) =>
        filterTagCandidates(
          // 已知标签（索引 > 扫描）实时过滤，支持嵌套
          useIndexStore.getState().tags.length > 0
            ? useIndexStore.getState().tags.map((t) => t.tag)
            : knownTagsRef.current,
          query,
        ),
      blockMenu: {
        build: (ctx: BlockMenuContext) =>
          buildBlockMenuItems(ctx, {
            getKernel: () => kernelRef.current,
            buildAiSubmenu: (blockCtx) => writingContextMenu({ target: blockCtx.target }),
            pluginItems: buildPluginMenuItems(pluginContributionRegistry.all()),
            canFold: (blockCtx) => kernelRef.current?.canFoldBlock(blockCtx.blockId) ?? false,
            isFolded: (blockCtx) => kernelRef.current?.isBlockFolded(blockCtx.blockId) ?? false,
          }),
        onAction: (id, ctx) => {
          if (id.startsWith(PLUGIN_MENU_ACTION_PREFIX)) {
            const scopedId = id.slice(PLUGIN_MENU_ACTION_PREFIX.length);
            const sep = scopedId.indexOf(':');
            void invoke('plugins:runCommand', {
              pluginId: scopedId.slice(0, sep),
              commandId: scopedId.slice(sep + 1),
            });
            return;
          }
          if (runBlockMenuAction(id, ctx, kernel, neighborsFor(kernel, ctx.blockId))) return;
          // AI 写作（writeingContextMenu 的 ai-* id）与未知 id 交给写作控制器
          writingController?.trigger(id, ctx);
        },
      },
    });
    kernelRef.current = kernel;
    const refreshOutline = () => {
      if (outlineVisibleRef.current) setOutline(parseBlockOutline(kernel.editor.state.doc));
    };
    kernel.editor.on('update', refreshOutline);
    // DEV-041：选区消失（折叠）时关闭划词翻译浮层，避免浮层滞留旧译文。
    const onSelectionUpdate = () => {
      const { from, to } = kernel.editor.state.selection;
      if (from === to) translationControllerRef.current?.closeSelection();
    };
    kernel.editor.on('selectionUpdate', onSelectionUpdate);
    const editorRegistration = registerEditor(kernel);
    const unregisterModeSwitch = registerModeSwitchHandler(tab.id, async () => {
      await kernel.flushPendingSave();
      await saveChainRef.current;
      return saveStateRef.current !== 'error';
    });

    const flush = () => void kernel.flushPendingSave();
    const unregisterAppSave = registerAppSaveListener(window, () => kernel.flushPendingSave());
    window.addEventListener('blur', flush);
    return () => {
      unregisterAppSave();
      unregisterModeSwitch();
      window.removeEventListener('blur', flush);
      kernel.editor.off('selectionUpdate', onSelectionUpdate);
      kernel.editor.off('update', refreshOutline);
      editorRegistration.unregister();
      // 卸载时取消所有挂起的文件选择器（隐藏 input / 悬挂 promise）。
      // 集合身份稳定，无需进依赖数组。
      // eslint-disable-next-line react-hooks/exhaustive-deps -- 上面的 ref 集合身份稳定
      for (const abort of pendingFilePicksRef.current) abort();
      pendingFilePicksRef.current.clear();
      // 先 flush 再 destroy：destroy 会 cancel，不能颠倒。
      void kernel.flushPendingSave().finally(() => kernel.destroy());
      kernelRef.current = null;
      unmountedRef.current = true;
    };
  }, [load, save, tab.id, autoSaveMs]);

  useEffect(() => {
    const io: PageFileIo = {
      stat: (p) => invoke('fs:stat', { path: p }),
      read: (p) => invoke('fs:readTextFile', { path: p }),
      exists: async () => false,
      write: async () => {
        throw new Error('unused');
      },
      renameLinked: async () => {
        throw new Error('unused');
      },
    };
    return onEvent('fs:changed', (event) => {
      if (event.kind !== 'change' || event.path !== pathRef.current) return;
      // origin:'app'（应用自身写入）绝不弹冲突，仅静默刷新基线；
      // dirty 时保持本地 buffer（本地可能有更新输入，继续等 autosave），
      // clean 时静默重载磁盘内容（如 renameWithLinks 联动重写了本页）。
      if (event.origin === 'app') {
        void (async () => {
          try {
            const [text, info] = await Promise.all([
              invoke('fs:readTextFile', { path: pathRef.current }),
              invoke('fs:stat', { path: pathRef.current }),
            ]);
            baseVersionRef.current = fileVersionOf(info);
            baseTextRef.current = text;
            // 竞态防护：读取期间用户又开始输入（dirty）则只刷新基线，不动编辑器
            if (!dirtyRef.current && kernelRef.current?.getMarkdown() !== text) {
              kernelRef.current?.setMarkdown(text);
            }
          } catch {
            // 文件竞态消失（如被改名/删除）：交给页面树 unlink 流程
          }
        })();
        return;
      }
      void classifyExternalChange({
        io,
        path: pathRef.current,
        baseVersion: baseVersionRef.current,
        baseText: baseTextRef.current,
        dirty: dirtyRef.current,
      }).then((result) => {
        if (result.kind === 'unchanged') return;
        if (result.kind === 'reload') {
          void invoke('fs:readTextFile', { path: pathRef.current }).then((text) => {
            baseTextRef.current = text;
            baseVersionRef.current = result.version;
            dirtyRef.current = false;
            kernelRef.current?.setMarkdown(text);
          });
          return;
        }
        conflictRef.current = result.version;
        setConflict(result.version);
      });
    });
  }, []);

  // 仅替换 ProseMirror 文档首部 frontmatter 节点，保留正文选择与撤销映射。
  const applyFrontmatter = useCallback((next: FrontmatterData, sourceOverride?: string) => {
    const kernel = kernelRef.current;
    if (!kernel) return;
    const editor = kernel.editor;
    const first = editor.state.doc.firstChild;
    const type = editor.state.schema.nodes.frontmatter;
    if (!type) return;
    const yaml = sourceOverride ?? serializeFrontmatterYaml(next);

    if (first?.type.name === 'frontmatter') {
      if (first.textContent !== yaml) {
        const tr =
          yaml.length > 0
            ? editor.state.tr.replaceWith(
                0,
                first.nodeSize,
                type.create(null, editor.state.schema.text(yaml)),
              )
            : editor.state.tr.delete(0, first.nodeSize);
        editor.view.dispatch(tr);
      }
    } else if (yaml.length > 0) {
      editor.view.dispatch(
        editor.state.tr.insert(0, type.create(null, editor.state.schema.text(yaml))),
      );
    }
    setFmData(next);
    setFmSource(yaml);
    setFmLocked(false);
    setFmParseError(null);
  }, []);

  // 属性面板数据源：编辑内容变化时刷新。
  useEffect(() => {
    if (load.phase !== 'ready') return;
    const kernel = kernelRef.current;
    const markdown = kernel?.getMarkdown() ?? load.markdown;
    const { yaml } = splitFrontmatter(markdown);
    let parsed: FrontmatterData = fmData;
    if (yaml !== null) {
      try {
        parsed = parseFrontmatterYaml(yaml);
      } catch {
        // 保持之前的结构化数据
      }
    }
    setDocument({ filePath: displayPath, markdown, data: parsed });
  }, [load, displayPath, saveState, setDocument, fmData]);

  // 已知标签：递归扫描 vault 全部 Markdown，接口与 DEV-004 索引替换 seam 一致。
  useEffect(() => {
    if (load.phase !== 'ready') return;
    let cancelled = false;
    void collectVaultTags({
      listDir: (relativePath) => invoke('fs:listDir', { path: relativePath }),
      readTextFile: (relativePath) => invoke('fs:readTextFile', { path: relativePath }),
    })
      .then((tags) => {
        if (!cancelled) {
          knownTagsRef.current = tags;
          setKnownTags(tags);
        }
      })
      .catch(() => {
        // vault 未就绪等场景忽略
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // DEV-010：预加载当前页反链，供 AI 写作上下文组装（失败/无索引静默回退）。
  // DEV-017：同时加载页面摘要（含别名），供双链建议匹配 alias。
  useEffect(() => {
    if (load.phase !== 'ready') return;
    void useIndexStore
      .getState()
      .loadBacklinks(displayPath)
      .catch(() => undefined);
    void useIndexStore
      .getState()
      .loadPageSummaries()
      .catch(() => undefined);
  }, [load.phase, displayPath]);

  // DEV-004 索引标签为实时真值；索引未就绪时回退到全库扫描标签。
  const effectiveKnownTags = useMemo(
    () => (indexTags.length > 0 ? indexTags.map((t) => t.tag) : knownTags),
    [indexTags, knownTags],
  );

  const status = useMemo(() => {
    if (saveState === 'saving')
      return { icon: LoaderCircle, text: '保存中…', className: 'animate-spin' };
    if (saveState === 'error')
      return { icon: AlertCircle, text: '保存失败', className: 'text-destructive' };
    return { icon: Check, text: '已保存', className: '' };
  }, [saveState]);
  const StatusIcon = status.icon;

  // 标题工具能力随选区实时变化：以惰性 getter 交给工具栏在交互时求值，
  // 避免每次选区变化重渲工具栏（refs 只在事件/渲染求值时读取）。
  const blockHeadingState = useMemo(
    () => ({
      disabled: () => !blockHeadingCapability(getActiveEditor()).enabled,
      disabledReason: () => blockHeadingCapability(getActiveEditor()).reason,
    }),
    [],
  );

  /**
   * DEV-035 工具栏命令分发（ADR-0006）：动作表由 toolbar/entries 声明，处理在这里按
   * 当前编辑器实时状态执行——有选区作用于选区，无选区作用于光标所在块。
   */
  const runToolbarCommand = (id: string): void => {
    const view = (): EditorKernelInstance['editor']['view'] | null =>
      kernelRef.current?.editor.view ?? null;
    const selectionText = (): string => {
      const v = view();
      if (!v) return '';
      const { from, to } = v.state.selection;
      return from === to ? '' : v.state.doc.textBetween(from, to, '\n');
    };
    if (id === PARAGRAPH_ID || headingLevelFromAction(id) !== null) {
      if (kernelRef.current) applyBlockTypeAction(kernelRef.current, id);
      return;
    }
    switch (id) {
      case TOGGLE_OUTLINE_ID: {
        const next = !outlineVisibleRef.current;
        outlineVisibleRef.current = next;
        setOutlineVisible(next);
        if (next && kernelRef.current) {
          setOutline(parseBlockOutline(kernelRef.current.editor.state.doc));
        }
        return;
      }
      case UNDO_ID:
        kernelRef.current?.editor.commands.undo();
        return;
      case REDO_ID:
        kernelRef.current?.editor.commands.redo();
        return;
      case INSERT_TABLE_ID:
        kernelRef.current?.editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
        return;
      case INSERT_FLOWCHART_ID:
        kernelRef.current?.editor.commands.insertMermaidFlowchart();
        return;
      case INSERT_GANTT_ID:
        kernelRef.current?.editor.commands.insertMermaidGantt();
        return;
      case INSERT_TOC_ID:
        kernelRef.current?.editor.commands.insertTableOfContents();
        return;
      case FORMAT_BOLD:
      case FORMAT_ITALIC:
      case FORMAT_STRIKE:
      case FORMAT_CODE:
      case FORMAT_LINK:
      case FORMAT_WIKILINK:
        // 工具栏入口允许空选区：光标处设置存储 mark / 插入 `[[` 骨架。
        runFormatAction(id, kernelRef.current, selectionText(), { allowEmptySelection: true });
        return;
      case INSERT_IMAGE_ID:
      case INSERT_ATTACHMENT_ID: {
        const media = createMediaInsert({
          getPagePath: () => pathRef.current,
          getEditor: () => kernelRef.current,
          getDestroyed: () => unmountedRef.current,
          trackAbort: (abort) => {
            pendingFilePicksRef.current.add(abort);
            return () => pendingFilePicksRef.current.delete(abort);
          },
        });
        if (id === INSERT_IMAGE_ID) void media.pickImage();
        else void media.pickAttachment();
        return;
      }
      case AI_ASK_ID: {
        const v = view();
        if (!v) return;
        // 无选区时送入当前块正文，避免入口在光标处失效。
        const target = v.state.selection.empty ? 'block' : 'selection';
        requestAskAi(
          computeEditorActionContext(v, target).text,
          titleFromPath(pathRef.current),
          pathRef.current,
        );
        return;
      }
      case AI_INSERT_ID: {
        const v = view();
        if (!v) return;
        const instruction = window.prompt('AI 插入指令', '请基于当前上下文补充内容');
        if (!instruction?.trim()) return;
        const ctx = computeEditorActionContext(v, 'cursor');
        writingControllerRef.current?.trigger('ai:expand', {
          ...ctx,
          text: instruction.trim(),
          target: 'cursor',
        });
        return;
      }
      case VIEW_SOURCE_ID:
        void requestSourceModeToggle(tab.id);
        return;
      case TRANSLATE_DOCUMENT_ID:
        // DEV-041：全文翻译打开临时只读视图，不进入文档树、不写盘。
        translationControllerRef.current?.translateDocument();
        return;
    }
    // 其余为 AI 写作子动作：与斜杠 `/ai` 同语义（无选区时以光标处为目标）。
    const v = view();
    if (!v) return;
    const target = v.state.selection.empty ? 'cursor' : 'selection';
    writingControllerRef.current?.trigger(id, computeEditorActionContext(v, target));
  };

  if (load.phase === 'loading') {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> 正在打开 {path}…
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
      data-testid="editor-view"
      data-path={displayPath}
      className="nexnote-editor-view relative flex h-full min-h-0 flex-col"
    >
      <EditorToolbar
        label="编辑器工具栏"
        entries={blockToolbarEntries({
          sourceModeToggle: tab.format === 'markdown',
          headingState: blockHeadingState,
        })}
        onCommand={runToolbarCommand}
        tools={
          <DocumentPropertiesPopover
            data={fmData}
            source={fmSource}
            knownTags={effectiveKnownTags}
            locked={fmLocked}
            parseError={fmParseError}
            onChange={applyFrontmatter}
            onYamlChange={(source, next) => applyFrontmatter(next, source)}
          />
        }
        status={
          <span
            data-testid="editor-save-status"
            className="flex shrink-0 items-center gap-1"
            aria-label={saveError ? `${status.text}：${saveError}` : status.text}
          >
            <StatusIcon className={`size-3 ${status.className}`} />
            {status.text}
          </span>
        }
      />
      <div className="nexnote-editor-scroll min-h-0 flex-1 overflow-auto">
        <div className="nexnote-editor-relative relative mx-auto max-w-[var(--editor-content-width)] px-10 py-10">
          {conflict && (
            <div
              data-testid="editor-conflict-banner"
              className="flex shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
            >
              <AlertCircle className="size-3.5" />
              <span className="flex-1">磁盘文件已被外部修改，本地还有未保存的修改。</span>
              <button
                type="button"
                data-testid="conflict-keep-local"
                onClick={() => {
                  void (async () => {
                    const info = await invoke('fs:stat', { path: pathRef.current });
                    baseVersionRef.current = fileVersionOf(info);
                    conflictRef.current = null;
                    setConflict(null);
                    dirtyRef.current = true;
                    await kernelRef.current?.flushPendingSave();
                  })();
                }}
              >
                保留本地
              </button>
              <button
                type="button"
                data-testid="conflict-take-disk"
                onClick={() =>
                  void invoke('fs:readTextFile', { path: pathRef.current }).then((text) => {
                    baseTextRef.current = text;
                    dirtyRef.current = false;
                    conflictRef.current = null;
                    kernelRef.current?.setMarkdown(text);
                    setConflict(null);
                    void invoke('fs:stat', { path: pathRef.current }).then((info) => {
                      baseVersionRef.current = fileVersionOf(info);
                    });
                  })
                }
              >
                读取磁盘并重载
              </button>
            </div>
          )}
          <div ref={hostRef} data-testid="editor-host" className="nexnote-editor-host" />
        </div>
      </div>
      {outlineVisible && (
        <OutlinePanel
          entries={outline}
          onNavigate={(entry) => {
            const editor = kernelRef.current?.editor;
            const pos = entry.pos ?? 0;
            // DEV-054（ADR-0013）：目录跳转目标被折叠祖先遮蔽时只展开必要祖先，
            // 目标标题自身若已折叠则保持折叠。
            if (editor) revealBlockFoldAt(editor.view, pos);
            // pos 指向 heading 节点起点；+1 进入节点内部，文本选区落在标题文本上。
            editor?.view.dispatch(
              editor.view.state.tr
                .setSelection(TextSelection.create(editor.view.state.doc, pos + 1))
                .scrollIntoView(),
            );
            editor?.commands.focus();
          }}
          onClose={() => setOutlineVisible(false)}
          className="absolute right-3 top-10 z-20"
        />
      )}
    </div>
  );
}
