import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, LoaderCircle, Save } from 'lucide-react';
import { createEditor } from '@nexnote/kernel';
import { invoke } from '../lib/ipc';
import { useTabStore, type PaneId, type TabDescriptor } from '../stores/tab-store';
import { FrontmatterPanel } from '../features/frontmatter/FrontmatterPanel';
import { useDocumentPropertiesStore } from '../features/frontmatter/document-properties-store';
import { useIndexStore } from '../stores/index-store';
import type { FrontmatterData } from '@nexnote/kernel';
import { parseFrontmatterYaml, serializeFrontmatterYaml, splitFrontmatter } from '@nexnote/kernel';
import { collectVaultTags, inspectFrontmatter } from '../features/frontmatter/frontmatter-utils';
import {
  bindH1ToTitle,
  firstH1,
  pagePathForTitle,
  sanitizePageTitle,
  titleFromPath,
} from './title-sync';
import { registerAppSaveListener } from './app-save';
import { registerEditor } from './active-editor';
import {
  createWritingController,
  writingBubbleActions,
  type WritingController,
  writingContextMenu,
  writingSlashItems,
} from '../features/ai/writing';
import { CHAT_ASK_ACTION, requestAskAi } from '../features/ai/chat/ask-ai';
import { openChatWikilinkOrNull } from '../features/ai/chat/chat-runtime';
import { useUiStore } from '../stores/ui-store';
import { pluginContributionRegistry } from '../registries';
import {
  buildDispatchableBlockCommands,
  buildPluginMenuItems,
  PLUGIN_MENU_ACTION_PREFIX,
} from '../features/plugins/extension-points';
import type { BlockMenuContext } from '@nexnote/kernel';
import type { EditorKernelInstance, SlashMenuItem } from '@nexnote/kernel';
import {
  withUncreated,
  filterTagCandidates,
} from './interactions/suggestions';
import {
  buildBlockMenuItems,
  runBlockMenuAction,
  type BlockNeighbors,
} from './interactions/block-menu';
import { formatBubbleActions, runFormatAction } from './interactions/formatting';
import { usePluginStore } from '../features/plugins/plugin-store';
import { usePageTreeStore } from '../stores/page-tree-store';
import {
  buildBuiltinSlashItems,
  buildBuiltinViewExtensions,
  flagsFromActivePlugins,
} from '../features/plugins/builtin/builtin-extensions';

interface EditorViewProps {
  paneId: PaneId;
  tab: TabDescriptor;
}

type LoadState =
  { phase: 'loading' } | { phase: 'ready'; markdown: string } | { phase: 'error'; message: string };

type SaveState = 'saved' | 'saving' | 'error';


/** 斜杠菜单的插件块项（DEV-017：插件注册的块类型出现在斜杠菜单）。 */
/** 媒体插入（DEV-017）：hidden file input 选择图片/附件，插入 Markdown 语法。 */
function createMediaInsertSlashItems(): SlashMenuItem[] {
  const pick = async (accept: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      document.body.append(input);
      let settled = false;
      const done = (file: File | null) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(file ? URL.createObjectURL(file) : null);
      };
      input.addEventListener('change', () => done(input.files?.[0] ?? null));
      // 取消选择（Esc/点空白）也要清掉隐藏 input，否则节点泄漏
      input.addEventListener('cancel', () => done(null));
      input.click();
    });
  };
  return [
    {
      id: 'image',
      title: '图片',
      hint: 'img',
      keywords: ['image', 'img', 'picture', 'tupian'],
      group: '媒体',
      action: ({ view }) => {
        void (async () => {
          const url = await pick('image/*');
          if (!url) return;
          // MVP：插入带 objectURL 的图片节点（保存时由外层解析持久化）
          view.dispatch(
            view.state.tr
              .replaceSelectionWith(
                view.state.schema.nodes.image!.create({ src: url, alt: '' }),
              )
              .scrollIntoView(),
          );
        })();
        return true;
      },
    },
    {
      id: 'attachment',
      title: '附件',
      hint: 'file',
      keywords: ['attachment', 'file', 'fujian'],
      group: '媒体',
      action: ({ view }) => {
        void (async () => {
          const url = await pick('*/*');
          if (!url) return;
          // 斜杠触发串已在 action 前被删除，直接在当前选区插入链接文本
          view.dispatch(view.state.tr.insertText(`[附件](${url})`));
        })();
        return true;
      },
    },
  ];
}

function buildPluginSlashItems(kernel: EditorKernelInstance): SlashMenuItem[] {
  // PluginContributionDef 与 PluginContributionView 形状同源（scopedId/pluginId/kind/title/id）
  const contributions = pluginContributionRegistry.all() as unknown as Parameters<typeof buildDispatchableBlockCommands>[0];
  const defs = buildDispatchableBlockCommands(contributions);
  return defs.map((d) => ({
    id: d.id,
    title: d.title,
    hint: d.blockType,
    keywords: ['插件', 'plugin', 'block', ...(d.keywords ?? []).map((k) => String(k))],
    group: '插件',
    action: () => {
      kernel.editor.commands.insertPluginBlock?.({ pluginId: d.pluginId, blockType: d.blockType });
      return true;
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
    prevBlockId: idx > 0 ? ids[idx - 1] ?? null : null,
    nextBlockId: idx < ids.length - 1 ? ids[idx + 1] ?? null : null,
  };
}

/**
 * React → 框架无关 kernel 桥：
 * - 从 vault IPC 读写 .md（Renderer 永不直接触碰 Node fs）
 * - 编辑防抖保存；卸载/窗口 blur 时 flush
 * - 默认文件名 ↔ 首 H1 绑定：文件名初始补 H1，H1 修改后原子 rename
 */
export function EditorView({ paneId, tab }: EditorViewProps) {
  const path = tab.pagePath ?? `${sanitizePageTitle(tab.title)}.md`;
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [displayPath, setDisplayPath] = useState(path);
  const hostRef = useRef<HTMLDivElement>(null);
  const kernelRef = useRef<EditorKernelInstance | null>(null);
  const pathRef = useRef(path);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const unmountedRef = useRef(false);
  const [fmData, setFmData] = useState<FrontmatterData>({});
  const [fmSource, setFmSource] = useState('');
  const [fmLocked, setFmLocked] = useState(false);
  const [fmParseError, setFmParseError] = useState<string | null>(null);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const indexTags = useIndexStore((s) => s.tags);
  const setDocument = useDocumentPropertiesStore((s) => s.setDocument);

  // 写作辅助编排器（DEV-010）：在 mount effect 中创建（effect 内读取 ref 合法），
  // getter 在事件触发时才经 ref 读取实时 kernel/路径；控制器本身稳定。
  const writingControllerRef = useRef<WritingController | null>(null);
  useEffect(() => {
    writingControllerRef.current = createWritingController({
      getKernel: () => kernelRef.current,
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
  }, []);

  useEffect(() => {
    pathRef.current = path;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部 tab store 路径同步
    setDisplayPath(path);
  }, [path]);

  // 新建页：不存在则写入包含 H1 的初始 Markdown；已有文件则读取。
  useEffect(() => {
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
      setSaveState('saving');
      setSaveError(null);

      // 串行化 rename/write，避免高速输入时旧保存覆盖新保存。
      saveChainRef.current = saveChainRef.current.then(async () => {
        let currentPath = pathRef.current;
        const heading = firstH1(markdown);
        if (heading) {
          const desiredTitle = sanitizePageTitle(heading);
          const desiredPath = pagePathForTitle(currentPath, desiredTitle);
          if (desiredPath !== currentPath) {
            const collision = await invoke('fs:exists', { path: desiredPath });
            if (collision) throw new Error(`无法重命名：${desiredPath} 已存在`);
            await invoke('fs:renameLinked', { from: currentPath, to: desiredPath });
            currentPath = desiredPath;
            pathRef.current = desiredPath;
            setDisplayPath(desiredPath);
            useTabStore.getState().updateTab(paneId, tab.id, {
              title: desiredTitle,
              pagePath: desiredPath,
            });
          }
        }
        await invoke('fs:writeTextFile', {
          path: currentPath,
          content: markdown,
          createParentDirs: true,
        });
      });

      try {
        await saveChainRef.current;
        if (!unmountedRef.current) setSaveState('saved');
      } catch (e) {
        if (!unmountedRef.current) {
          const message = e instanceof Error ? e.message : String(e);
          setSaveState('error');
          setSaveError(message);
        }
        throw e;
      }
    },
    [paneId, tab.id],
  );

  // load ready 后挂载 kernel；path 变化来自标题 rename 时不重挂（load.markdown 不变）。
  useEffect(() => {
    if (load.phase !== 'ready' || !hostRef.current) return;
    unmountedRef.current = false;
    const writingController = writingControllerRef.current;
    // DEV-015：内置插件（Mermaid/KaTeX）激活时叠加富预览 NodeView；
    // 斜杠项经函数式 extraSlashItems 在每次打开菜单时读取最新启停状态。
    const builtinFlags = flagsFromActivePlugins(usePluginStore.getState().plugins);
    const kernel = createEditor(hostRef.current, {
      initialMarkdown: load.markdown,
      saveDelayMs: 500,
      onContentChange: save,
      onSaveError: (e) => {
        if (!unmountedRef.current) {
          setSaveState('error');
          setSaveError(e instanceof Error ? e.message : String(e));
        }
      },
      onWikilinkActivate: (target) => {
        const pageName = target.split('#')[0] || target;
        // DEV-012：双链指向会话（type: chat）时打开对话 dock 并加载该会话。
        void openChatWikilinkOrNull(pageName).then((hit) => {
          if (hit) {
            useUiStore.getState().setActiveDockPanel('ai-chat');
            return;
          }
          const nextPath = `${sanitizePageTitle(pageName)}.md`;
          useTabStore.getState().openTab(paneId, {
            kind: 'page',
            title: titleFromPath(nextPath),
            pagePath: nextPath,
          });
        });
      },
      selectionBubble: {
        actions: [
          ...formatBubbleActions(),
          ...writingBubbleActions(),
          { id: CHAT_ASK_ACTION, title: '询问 AI' },
        ],
        onAction: (id, ctx) => {
          if (runFormatAction(id, kernelRef.current, ctx.text)) return;
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
      extraSlashItems: () => [
        ...(writingController ? writingSlashItems(writingController) : []),
        ...buildBuiltinSlashItems(flagsFromActivePlugins(usePluginStore.getState().plugins)),
        ...createMediaInsertSlashItems(),
        ...buildPluginSlashItems(kernel),
      ],
      wikilinkSuggestions: (query) => {
        const pages = usePageTreeStore.getState().entries
          .filter((e) => e.kind === 'file' && e.path.toLowerCase().endsWith('.md'))
          .map((e) => ({ path: e.path, title: titleFromPath(e.path) }));
        return withUncreated(pages, query);
      },
      // 红链回车创建：写入 `# 标题` 初始页（与新建页/激活链接同约定），已存在则不动
      onWikilinkSuggestionPick: (item) => {
        if (item.meta !== 'uncreated') return;
        const target = item.insert?.target ?? item.id;
        const pageName = target.split('#')[0] || target;
        const nextPath = `${sanitizePageTitle(pageName)}.md`;
        void (async () => {
          try {
            const exists = await invoke('fs:exists', { path: nextPath });
            if (exists) return;
            await invoke('fs:writeTextFile', {
              path: nextPath,
              content: `# ${titleFromPath(nextPath)}\n\n`,
              createParentDirs: true,
            });
          } catch {
            // 页面创建失败不阻塞插入（链接仍指向未来的页面）
          }
        })();
      },
      hashtagSuggestions: (query) =>
        filterTagCandidates(
          // 已知标签（索引 > 扫描）实时过滤，支持嵌套
          useIndexStore.getState().tags.length > 0
            ? useIndexStore.getState().tags.map((t) => t.tag)
            : knownTags,
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
    const editorRegistration = registerEditor(kernel);

    const flush = () => void kernel.flushPendingSave();
    const unregisterAppSave = registerAppSaveListener(window, () => kernel.flushPendingSave());
    window.addEventListener('blur', flush);
    return () => {
      unregisterAppSave();
      window.removeEventListener('blur', flush);
      editorRegistration.unregister();
      // 先 flush 再 destroy：destroy 会 cancel，不能颠倒。
      void kernel.flushPendingSave().finally(() => kernel.destroy());
      kernelRef.current = null;
      unmountedRef.current = true;
    };
  }, [load, paneId, save, knownTags]);

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
        if (!cancelled) setKnownTags(tags);
      })
      .catch(() => {
        // vault 未就绪等场景忽略
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // DEV-010：预加载当前页反链，供 AI 写作上下文组装（失败/无索引静默回退）。
  useEffect(() => {
    if (load.phase !== 'ready') return;
    void useIndexStore.getState().loadBacklinks(displayPath).catch(() => undefined);
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
      className="nexnote-editor-view flex h-full min-h-0 flex-col"
    >
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b px-3 text-[11px] text-muted-foreground">
        <Save className="size-3" />
        <span className="min-w-0 truncate">{displayPath}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1" title={saveError ?? undefined}>
          <StatusIcon className={`size-3 ${status.className}`} />
          {status.text}
        </span>
      </div>
      <div className="nexnote-editor-scroll min-h-0 flex-1 overflow-auto">
        <div className="nexnote-editor-relative relative mx-auto max-w-[var(--editor-content-width)] px-10 py-10">
          <FrontmatterPanel
            data={fmData}
            source={fmSource}
            knownTags={effectiveKnownTags}
            locked={fmLocked}
            parseError={fmParseError}
            onChange={(next) => {
              applyFrontmatter(next);
            }}
            onYamlChange={(source, next) => {
              applyFrontmatter(next, source);
            }}
          />
          <div ref={hostRef} data-testid="editor-host" className="nexnote-editor-host" />
        </div>
      </div>
    </div>
  );
}
