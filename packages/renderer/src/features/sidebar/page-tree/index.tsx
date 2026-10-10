import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileCode2,
  GitBranch,
  Folder,
  FolderPlus,
  FolderTree,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { ContextMenu, type ContextMenuItem } from '../../../components/ContextMenu';
import { Input } from '../../../components/ui/input';
import { usePageTreeStore } from '../../../stores/page-tree-store';
import { useUiStore } from '../../../stores/ui-store';
import { useTabStore } from '../../../stores/tab-store';
import { cn } from '../../../lib/utils';
import {
  buildTree,
  displayName,
  filterTree,
  isMarkdown,
  isDocx,
  isXlsx,
  isXmind,
  type TreeNode,
} from '../../../page-tree/tree-utils';
import * as ops from './ops';
import { NewNoteMenu } from './NewNoteMenu';
import { sidebarPanelRegistry } from '../../../registries';
import { useI18n } from '../../../lib/i18n';

/** DEV-074：可在页面树显示 / 点击打开的文档（Markdown 与三类二进制）。 */
const isOpenableDocument = (name: string): boolean =>
  isMarkdown(name) || isDocx(name) || isXlsx(name) || isXmind(name);

/**
 * 页面树面板（DEV-003）：vault 文件夹树 → .md 页面。
 * 搜索实时过滤、标签过滤、右键菜单（新建/重命名/删除/Finder）、拖拽移动、折叠记忆。
 * 文件系统变化经 fs:changed 事件实时同步（含外部修改）。
 */
sidebarPanelRegistry.register({
  id: 'pages',
  title: 'sidebar.panel.pages',
  titleIsKey: true,
  icon: FolderTree,
  render: PageTreePanel,
});

interface RenamingState {
  path: string;
  kind: 'file' | 'directory';
  value: string;
}

function PageTreePanel() {
  const t = useI18n();
  const entries = usePageTreeStore((s) => s.entries);
  const status = usePageTreeStore((s) => s.status);
  const loadError = usePageTreeStore((s) => s.error);
  const query = usePageTreeStore((s) => s.query);
  const tagFilter = usePageTreeStore((s) => s.tagFilter);
  const tagFiles = usePageTreeStore((s) => s.tagFiles);
  const selectedPath = usePageTreeStore((s) => s.selectedPath);
  // 激活态跟随当前活动 tab 的页面（打开/切换/H1 改名都会同步），点击选中仅作非页面 tab 时的回退。
  const activePagePath = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.pagePath);
  const highlightPath = activePagePath ?? selectedPath;
  const collapsedDirs = useUiStore((s) => s.treeCollapsedDirs);
  const showAllFiles = useUiStore((s) => s.treeShowAllFiles);
  const showExtensions = useUiStore((s) => s.treeShowExtensions);

  const [renaming, setRenaming] = useState<RenamingState | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  // 操作错误自动消失
  useEffect(() => {
    if (!opError) return;
    const t = setTimeout(() => setOpError(null), 4000);
    return () => clearTimeout(t);
  }, [opError]);

  const run = (fn: () => Promise<unknown>): void => {
    void fn().catch((e: unknown) => setOpError(e instanceof Error ? e.message : String(e)));
  };

  const visibleEntries = useMemo(
    () =>
      entries.filter((e) => showAllFiles || e.kind === 'directory' || isOpenableDocument(e.name)),
    [entries, showAllFiles],
  );
  const tree = useMemo(() => buildTree(visibleEntries), [visibleEntries]);
  const filtering = query.trim().length > 0 || tagFilter !== null;
  const activeTagFiles = useMemo(
    () => (tagFilter !== null && tagFiles ? new Set(tagFiles) : null),
    [tagFilter, tagFiles],
  );
  const { tree: filteredTree, expandDirs } = useMemo(
    () => filterTree(tree, { query, tagFiles: activeTagFiles, showExtensions }),
    [tree, query, activeTagFiles, showExtensions],
  );
  const collapsedSet = useMemo(() => new Set(collapsedDirs), [collapsedDirs]);

  const isExpanded = (dirPath: string): boolean =>
    filtering ? expandDirs.has(dirPath) || !collapsedSet.has(dirPath) : !collapsedSet.has(dirPath);

  const openMenuFor = (e: React.MouseEvent, node: TreeNode | null): void => {
    e.preventDefault();
    e.stopPropagation();
    const parentDir = node
      ? node.kind === 'directory'
        ? node.path
        : node.path.slice(0, Math.max(0, node.path.lastIndexOf('/')))
      : '';
    const items: ContextMenuItem[] = node
      ? [
          {
            label: t('sidebar.pageTree.newPage'),
            onSelect: () => run(() => ops.createNoteIn(parentDir)),
          },
          {
            label: t('sidebar.pageTree.newFolder'),
            onSelect: () => run(async () => void (await ops.createFolderIn(parentDir, entries))),
          },
          { kind: 'separator' },
          {
            label: t('sidebar.pageTree.rename'),
            hint: 'Enter',
            onSelect: () =>
              setRenaming({
                path: node.path,
                kind: node.kind,
                value: node.kind === 'file' ? displayName(node, { showExtensions }) : node.name,
              }),
          },
          {
            label: t('sidebar.pageTree.delete'),
            hint: t('sidebar.pageTree.trash'),
            danger: true,
            onSelect: () => run(() => ops.deleteEntry(node.path, node.name)),
          },
          { kind: 'separator' },
          {
            label: t('sidebar.pageTree.reveal'),
            onSelect: () => run(() => ops.revealInFinder(node.path)),
          },
          { kind: 'separator' },
          {
            label: t('sidebar.pageTree.importDocx'),
            onSelect: () => run(() => ops.importDocxIn(parentDir)),
          },
          {
            label: t('sidebar.pageTree.importXlsx'),
            onSelect: () => run(() => ops.importBinaryIn('xlsx', parentDir)),
          },
          {
            label: t('sidebar.pageTree.importXmind'),
            onSelect: () => run(() => ops.importBinaryIn('mindmap', parentDir)),
          },
        ]
      : [
          {
            label: t('sidebar.pageTree.newPage'),
            onSelect: () => run(() => ops.createNoteIn('')),
          },
          {
            label: t('sidebar.pageTree.newFolder'),
            onSelect: () => run(async () => void (await ops.createFolderIn('', entries))),
          },
          { kind: 'separator' },
          {
            label: t('sidebar.pageTree.importDocx'),
            onSelect: () => run(() => ops.importDocxIn('')),
          },
          {
            label: t('sidebar.pageTree.importXlsx'),
            onSelect: () => run(() => ops.importBinaryIn('xlsx', '')),
          },
          {
            label: t('sidebar.pageTree.importXmind'),
            onSelect: () => run(() => ops.importBinaryIn('mindmap', '')),
          },
        ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const rows: React.ReactNode[] = [];
  const renderNode = (node: TreeNode, depth: number): void => {
    rows.push(
      <TreeRow
        key={node.path}
        node={node}
        depth={depth}
        expanded={node.kind === 'directory' ? isExpanded(node.path) : undefined}
        showExtensions={showExtensions}
        selected={highlightPath === node.path}
        renaming={renaming?.path === node.path ? renaming : null}
        dragOver={dragOverDir === node.path}
        onToggleDir={() => useUiStore.getState().toggleTreeDir(node.path)}
        onClick={() => {
          usePageTreeStore.getState().setSelected(node.path);
          if (node.kind === 'directory') {
            useUiStore.getState().toggleTreeDir(node.path);
            return;
          }
          // 所有文档经统一入口按 sidecar / 扩展名分流，避免 Markdown 误入二进制编辑器。
          if (isOpenableDocument(node.name)) {
            void run(() => ops.openDocument(node.path, node.format));
          }
        }}
        onContextMenu={(e) => openMenuFor(e, node)}
        onRenameChange={(v) => setRenaming((r) => (r ? { ...r, value: v } : r))}
        onRenameCancel={() => setRenaming(null)}
        onRenameCommit={() => {
          if (!renaming) return;
          const { path, kind, value } = renaming;
          setRenaming(null);
          if (value.trim().length > 0) run(() => ops.renameEntry(path, kind, value));
        }}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/nexnote-path', node.path);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (node.kind !== 'directory') return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOverDir(node.path);
        }}
        onDragLeave={() => setDragOverDir((d) => (d === node.path ? null : d))}
        onDrop={(e) => {
          if (node.kind !== 'directory') return;
          e.preventDefault();
          e.stopPropagation();
          setDragOverDir(null);
          const from = e.dataTransfer.getData('application/nexnote-path');
          if (from.length > 0 && from !== node.path) {
            run(() => ops.moveEntry(from, node.path));
            return;
          }
          // 外部文件拖入目录 → 导入到该目录（与树根拖放同规则）。
          const file = e.dataTransfer.files?.[0];
          if (file) run(() => ops.importDroppedFile(file, node.path));
        }}
      />,
    );
    if (node.kind === 'directory' && isExpanded(node.path)) {
      node.children.forEach((c) => renderNode(c, depth + 1));
    }
  };
  filteredTree.forEach((n) => renderNode(n, 0));

  const tagChip =
    tagFilter !== null ? (
      <button
        type="button"
        data-testid="tree-tag-filter-chip"
        onClick={() => usePageTreeStore.getState().setTagFilter(null, null)}
        className="flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/25"
        title={t('sidebar.pageTree.clearTagFilter')}
      >
        #{tagFilter}
        <X className="size-3" />
      </button>
    ) : null;

  return (
    <div
      data-testid="sidebar-panel-pages"
      data-tour="page-tree"
      className="flex h-full min-h-0 flex-col"
    >
      {/* 工具行：搜索 + 新建 + 显示全部开关 */}
      <div className="mb-1.5 flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            data-testid="tree-search-input"
            value={query}
            onChange={(e) => usePageTreeStore.getState().setQuery(e.target.value)}
            placeholder={t('sidebar.pageTree.searchPlaceholder')}
            className="h-7 w-full rounded-md border bg-background/60 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <NewNoteMenu
          onPick={(item) => {
            if (item.kind === 'note') {
              run(() => ops.createNoteIn('', item.format));
            } else {
              // DEV-084：把空白 docx/xlsx/xmind 的创建也接入侧栏新建菜单
              // （顶栏「文件」菜单里同时提供一份，避免双入口歧义）。
              // ops.createBinaryIn 内部约定的类型是 'mindmap' 而非 'xmind'，
              // 在调用边界做一次映射，保持 NewNoteMenu 的展示语义。
              const binaryKind = item.binary === 'xmind' ? 'mindmap' : item.binary;
              run(() => ops.createBinaryIn(binaryKind, ''));
            }
          }}
        />
        <button
          type="button"
          data-testid="tree-new-folder"
          title={t('sidebar.pageTree.newFolder')}
          onClick={() => run(async () => void (await ops.createFolderIn('', entries)))}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FolderPlus className="size-3.5" />
        </button>
      </div>
      <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
        {tagChip}
        <button
          type="button"
          data-testid="tree-toggle-all-files"
          title={
            showAllFiles ? t('sidebar.pageTree.showOnlyPages') : t('sidebar.pageTree.showAllFiles')
          }
          onClick={() => useUiStore.getState().setTreeShowAllFiles(!showAllFiles)}
          className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
        >
          {showAllFiles ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
          {showAllFiles ? t('sidebar.pageTree.allFiles') : t('sidebar.pageTree.pagesOnly')}
        </button>
        <button
          type="button"
          data-testid="tree-toggle-extensions"
          title={t('sidebar.pageTree.showExtensions')}
          aria-pressed={showExtensions}
          onClick={() => useUiStore.getState().setTreeShowExtensions(!showExtensions)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FileType2 className="size-3.5" />
        </button>
        <button
          type="button"
          title={t('sidebar.pageTree.refresh')}
          onClick={() => run(() => usePageTreeStore.getState().load())}
          className="ml-auto rounded p-0.5 hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="size-3" />
        </button>
      </div>

      {/* 树本体（根区域也是拖放目标与空白右键菜单区） */}
      <div
        data-testid="page-tree"
        className={cn(
          'min-h-0 flex-1 overflow-auto rounded-md border border-transparent',
          dragOverDir === '' && 'border-primary/50 bg-primary/5',
        )}
        onContextMenu={(e) => openMenuFor(e, null)}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOverDir('');
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOverDir(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverDir(null);
          const from = e.dataTransfer.getData('application/nexnote-path');
          if (from.length > 0) {
            run(() => ops.moveEntry(from, ''));
            return;
          }
          // DEV-074：外部文件拖入 → 按扩展名导入为仓库内副本（docx/xlsx/xmind）。
          const file = e.dataTransfer.files?.[0];
          if (file) run(() => ops.importDroppedFile(file, ''));
        }}
      >
        {status === 'loading' && (
          <p className="p-2 text-xs text-muted-foreground">{t('sidebar.pageTree.loading')}</p>
        )}
        {status === 'error' && (
          <p className="m-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {t('sidebar.pageTree.loadFailed', { error: loadError ?? '' })}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => run(() => usePageTreeStore.getState().load())}
            >
              {t('sidebar.pageTree.retry')}
            </button>
          </p>
        )}
        {status === 'ready' && rows.length === 0 && (
          <p className="p-3 text-xs leading-relaxed text-muted-foreground">
            {filtering ? t('sidebar.pageTree.noMatches') : t('sidebar.pageTree.empty')}
          </p>
        )}
        {rows}
      </div>

      {opError && (
        <p
          data-testid="tree-op-error"
          className="mt-1 shrink-0 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive"
        >
          {opError}
        </p>
      )}

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menu?.items ?? []}
        onClose={() => setMenu(null)}
        testId="tree-context-menu"
      />
    </div>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: boolean | undefined;
  showExtensions: boolean;
  selected: boolean;
  renaming: RenamingState | null;
  dragOver: boolean;
  onToggleDir(): void;
  onClick(): void;
  onContextMenu(e: React.MouseEvent): void;
  onRenameChange(v: string): void;
  onRenameCancel(): void;
  onRenameCommit(): void;
  onDragStart(e: React.DragEvent): void;
  onDragOver(e: React.DragEvent): void;
  onDragLeave(): void;
  onDrop(e: React.DragEvent): void;
}

function TreeRow(p: TreeRowProps) {
  const t = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const isDir = p.node.kind === 'directory';
  // 只在进入重命名那一刻全选一次；依赖 value 会在每次输入后重新全选，导致下一个按键覆盖全部输入。
  const renameTarget = p.renaming ? `${p.renaming.kind}:${p.renaming.path}` : null;
  useEffect(() => {
    if (renameTarget && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renameTarget]);

  return (
    <div
      data-testid="tree-row"
      data-path={p.node.path}
      data-kind={p.node.kind}
      data-active={p.selected ? 'true' : undefined}
      draggable={p.renaming === null}
      onDragStart={p.onDragStart}
      onDragOver={p.onDragOver}
      onDragLeave={p.onDragLeave}
      onDrop={p.onDrop}
      onClick={p.onClick}
      onContextMenu={p.onContextMenu}
      style={{ paddingLeft: `${p.depth * 12}px` }}
      className={cn(
        'group flex cursor-pointer items-center gap-1 rounded-sm py-[3px] pr-1.5 text-[13px] leading-5',
        p.selected ? 'bg-accent text-accent-foreground' : 'text-foreground/90 hover:bg-accent/50',
        isDir && p.dragOver && 'bg-primary/15 ring-1 ring-inset ring-primary/50',
      )}
      title={
        isDir
          ? p.node.path
          : p.node.format === 'markdown'
            ? `${p.node.path} · ${t('sidebar.pageTree.markdownFile')}`
            : `${p.node.path} · ${t('sidebar.pageTree.blockFile')}`
      }
      data-format={!isDir ? (p.node.format ?? 'native-block') : undefined}
    >
      {isDir ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              p.onToggleDir();
            }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
            aria-label={p.expanded ? t('sidebar.pageTree.collapse') : t('sidebar.pageTree.expand')}
          >
            <ChevronRight
              className={cn('size-3 transition-transform', p.expanded && 'rotate-90')}
            />
          </button>
          <Folder className="size-3.5 shrink-0 text-primary/70" />
        </>
      ) : (
        <span className="w-[17px] shrink-0" />
      )}
      {!isDir && isMarkdown(p.node.name) && p.node.format !== 'markdown' && (
        <FileText
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-label={t('sidebar.pageTree.blockFile')}
        />
      )}
      {!isDir && isMarkdown(p.node.name) && p.node.format === 'markdown' && (
        <FileCode2
          className="size-3.5 shrink-0 text-primary"
          aria-label={t('sidebar.pageTree.markdownFile')}
        />
      )}
      {!isDir && isDocx(p.node.name) && (
        <FileType2
          className="size-3.5 shrink-0 text-primary/80"
          aria-label={t('sidebar.pageTree.docxFile')}
        />
      )}
      {!isDir && isXlsx(p.node.name) && (
        <FileSpreadsheet
          className="size-3.5 shrink-0 text-primary/80"
          aria-label={t('sidebar.pageTree.xlsxFile')}
        />
      )}
      {!isDir && isXmind(p.node.name) && (
        <GitBranch
          className="size-3.5 shrink-0 text-primary/80"
          aria-label={t('sidebar.pageTree.xmindFile')}
        />
      )}
      {!isDir && !isOpenableDocument(p.node.name) && (
        <FileText className="size-3.5 shrink-0 text-muted-foreground/50" />
      )}
      {p.renaming ? (
        <Input
          ref={inputRef}
          data-testid="tree-rename-input"
          value={p.renaming.value}
          onChange={(e) => p.onRenameChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') p.onRenameCommit();
            if (e.key === 'Escape') p.onRenameCancel();
          }}
          onBlur={p.onRenameCommit}
          className="h-5 min-w-0 flex-1 rounded border-ring bg-background px-1 text-xs shadow-none focus-visible:ring-1"
        />
      ) : (
        <span className={cn('truncate', isDir && 'font-medium')}>
          {displayName(p.node, { showExtensions: p.showExtensions })}
          {!isDir && isMarkdown(p.node.name) && (
            <span className="ml-1 text-[9px] uppercase text-muted-foreground">
              {p.node.format === 'markdown' ? 'MD' : t('sidebar.pageTree.blockBadge')}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
