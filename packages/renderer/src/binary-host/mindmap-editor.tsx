import { useEffect, useRef, useState } from 'react';
import MindMap from 'simple-mind-map';
import Drag from 'simple-mind-map/src/plugins/Drag.js';
import {
  MINDMAP_STRUCTURE_CLASS_BY_ID,
  isMindmapStructureId,
  type MindmapStructureId,
} from '@nexnote/shared';
import { invoke } from '../lib/ipc';
import {
  getSession,
  markExplicitStructure,
  subscribeSession,
  flushPending,
  sessionStatusText,
} from './session';
import type { SessionState } from './session';
import { MindmapToolbar } from './mindmap-toolbar';
import { MindmapDrawer } from './mindmap-drawer';
import { MINDMAP_NODE_BTN_ICONS } from './mindmap-icons';
import { DEFAULT_MINDMAP_THEME, deepMergeTheme, themePresetById } from './mindmap-themes';
import { DEFAULT_MINDMAP_STRUCTURE, countRootChildren, structureById } from './mindmap-structures';
import { applyMindmapLayout, clearXStructureAssignments } from './mindmap-layouts';
import { useI18n } from '../lib/i18n';

/**
 * xmind 编辑器（DEV-074，ADR-0015 R3；DEV-099 操作界面）。
 * simple-mind-map 承担思维导图编辑；数据为节点树（binary:read 返回的 data.model）。
 * DEV-099：四角悬浮工具组（撤销/重做/保存、缩放/适应/主题）+ 选中节点右侧抽屉
 * （节点/形状/颜色/标记/备注/超链接）；Drag 插件启用节点拖拽；主题预设经
 * sidecar mindmapTheme 持久化。
 */

type MindMapLike = MindMap & {
  addPlugin: (plugin: unknown) => void;
  removePlugin: (plugin: unknown) => void;
};

export interface MindmapEditorProps {
  path: string;
  /** simple-mind-map 根节点树。 */
  model: unknown;
  onChange: (model: unknown) => void;
}

type MindMapWithInternals = MindMap & {
  view: {
    enlarge: () => void;
    narrow: () => void;
    fit: () => void;
    reset: () => void;
    scale: number;
  };
  themeConfig: Record<string, unknown>;
  execCommand: (command: string, ...args: unknown[]) => void;
  on: (event: string, cb: (...args: never[]) => void) => void;
  off: (event: string, cb: (...args: never[]) => void) => void;
};

/** DEV-114：把受支持结构写入 root 节点数据（文件权威），且不触发历史/重绘。 */
function applyRootStructureClass(
  mindMap: MindMapWithInternals | null,
  id: MindmapStructureId,
): void {
  if (!mindMap) return;
  const structureClass =
    MINDMAP_STRUCTURE_CLASS_BY_ID[id as keyof typeof MINDMAP_STRUCTURE_CLASS_BY_ID];
  if (!structureClass) return;
  const renderTree = (
    mindMap.renderer as unknown as { renderTree?: { data: Record<string, unknown> } }
  ).renderTree;
  if (!renderTree) return;
  renderTree.data.structureClass = structureClass;
}

export function MindmapEditor({ path, model, onChange }: MindmapEditorProps): React.JSX.Element {
  const t = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MindMapWithInternals | null>(null);
  // onChange 经 useEffect 同步进 ref，避免渲染期写 ref（react-hooks/refs）。
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [scale, setScale] = useState(1);
  const [activeNodes, setActiveNodes] = useState<unknown[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPinnedOpen, setDrawerPinnedOpen] = useState(false);
  const [themeId, setThemeId] = useState(DEFAULT_MINDMAP_THEME);
  const [structure, setStructure] = useState<MindmapStructureId>(DEFAULT_MINDMAP_STRUCTURE);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const baseThemeRef = useRef<Record<string, unknown> | null>(null);
  // 渲染期不得读 ref（react-hooks/refs）：把实例镜像进 state 供工具栏/抽屉消费。
  const [mapInstance, setMapInstance] = useState<MindMapWithInternals | null>(null);
  // X 结构可用性的依据：根节点一级子节点数。model prop 只在加载时变化，编辑中的增删
  // 需从 data_change 的实时树刷新，否则删除子节点后菜单不会按 ADR-0020 决策 4 置灰。
  const [rootChildCount, setRootChildCount] = useState(() => countRootChildren(model));

  // 主题应用 = base 主题 × 预设深合并；声明前置于挂载 effect（react-hooks/immutability）。
  const applyThemeConfig = (mindMap: MindMapWithInternals, id: string): void => {
    const base = baseThemeRef.current;
    if (!base) return;
    const preset = themePresetById(id);
    mindMap.setThemeConfig(
      deepMergeTheme(JSON.parse(JSON.stringify(base)) as Record<string, unknown>, preset.config),
    );
  };

  // 结构切换 = setLayout（库内已支持）+ 自研布局挂载 + 拖拽插件按结构装载。
  // setLayout 不写节点数据、不触发 data_change，因此 .xmind 字节不受切结构影响（ADR-0020 决策 5）。
  const applyStructure = (mindMap: MindMapWithInternals, id: MindmapStructureId): void => {
    const option = structureById(id);
    // 自研布局（向上 / X）未在库内 Drag 的布局分发里登记，拖拽会让占位符静默错位，
    // 因此这两种结构下不装载 Drag 插件（ADR-0020 Consequences）。
    const withDrag = mindMap as unknown as MindMapLike;
    if (option.custom) withDrag.removePlugin(Drag);
    else withDrag.addPlugin(Drag);
    applyMindmapLayout(mindMap, option.layout);
  };

  // 落盘状态（编辑中…/已保存/失败）来自宿主 session。
  useEffect(() => {
    const apply = (session: SessionState | null): void =>
      setSaveStatus(sessionStatusText(session?.status ?? null));
    apply(null);
    return subscribeSession(apply);
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
    clearXStructureAssignments();
    // simple-mind-map 构造函数选项极多（140+ 默认项），运行时自带默认值合并，这里用窄类型传参。
    type MindMapOptions = ConstructorParameters<typeof MindMap>[0];
    const mindMap = new MindMap({
      el: hostRef.current,
      data: model,
      layout: 'logicalStructure',
      readonly: false,
      // DEV-099 反馈：节点上的折叠/展开/加子节点按钮整体缩小一半（默认 20 → 10）；
      // 折叠图标改用双左箭头（minus 圆圈易被误读为删除），展开用双右箭头。
      expandBtnSize: 10,
      expandBtnStyle: { color: '#808080', fill: '#fff', fontSize: 8, strokeColor: '#333333' },
      expandBtnIcon: {
        open: MINDMAP_NODE_BTN_ICONS.collapse,
        close: MINDMAP_NODE_BTN_ICONS.expand,
      },
      quickCreateChildBtnIcon: { icon: MINDMAP_NODE_BTN_ICONS.addChild, style: {} },
    } as unknown as MindMapOptions) as unknown as MindMapWithInternals;
    mapRef.current = mindMap;
    // 观测口：键盘/布局/结构等集成测试从宿主容器取实例（DEV-102/107 测试约定）。
    hostRef.current.dataset.mindMapInstance = 'attached';
    (hostRef.current as unknown as { __mindMap?: MindMapWithInternals }).__mindMap = mindMap;
    setMapInstance(mindMap);
    baseThemeRef.current = JSON.parse(JSON.stringify(mindMap.themeConfig)) as Record<
      string,
      unknown
    >;

    const onDataChange = (data: unknown): void => {
      setRootChildCount(countRootChildren(data));
      onChangeRef.current(data);
    };
    const onScale = (value: number): void => setScale(value);
    const onNodeActive = (_node: unknown, list: unknown[]): void => {
      setActiveNodes(list ?? []);
      // grill Q7：选中自动拉开抽屉；取消选中自动收（除非手动固定开）。
      setDrawerOpen((list ?? []).length > 0);
    };
    mindMap.on('data_change', onDataChange);
    mindMap.on('scale', onScale);
    mindMap.on('node_active', onNodeActive);

    // DEV-099 快捷键：Ctrl/Cmd+S 立即保存（库没有的能力）+ Cmd+Shift+Z 重做
    // （库只注册了 Control+y 重做，缺 macOS 惯用的 Cmd+Shift+Z）。
    // DEV-107：Delete/Backspace 与 Ctrl/Cmd+Z / Ctrl/Cmd+Y 不得在此分发——库的
    // KeyCommand 在同一个 window 上已注册同样的快捷键（'Del|Backspace' → REMOVE_NODE、
    // 'Control+z' → BACK、'Control+y' → FORWARD），此处再执行一次会形成双重分发：
    // 单选删除末尾节点后库自动激活相邻兄弟（deleteNodeActive 默认开），第二次
    // REMOVE_NODE 立即把它连带删掉。删除键链路全权交给库。
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      // 文本输入/节点编辑中不拦截（节点双击编辑是 contenteditable）。
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flushPending();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        mindMap.execCommand('FORWARD');
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // 主题与结构：主题仍是 sidecar；结构已改为文件权威（DEV-114）。sidecar 只作为
    // legacy 来源：受支持结构的首笔保存会迁移为字节权威，up/x 保留原文件结构直到显式更改。
    void invoke('document:getMetadata', { path })
      .then((meta) => {
        const stored = (meta as { mindmapTheme?: unknown } | null)?.mindmapTheme;
        const themeKey = typeof stored === 'string' ? stored : DEFAULT_MINDMAP_THEME;
        setThemeId(themeKey);
        applyThemeConfig(mindMap, themeKey);
        const storedStructure = (meta as { mindmapStructure?: unknown } | null)?.mindmapStructure;
        const readStructure =
          (getSession() as { mindmap?: { structureId?: MindmapStructureId | null } | null })
            ?.mindmap?.structureId ?? null;
        const nextStructure =
          readStructure ??
          (isMindmapStructureId(storedStructure) ? storedStructure : null) ??
          DEFAULT_MINDMAP_STRUCTURE;
        setStructure(structureById(nextStructure).id);
        // 重新加载的文档按其当前一级子节点数决定 X 结构是否可用
        setRootChildCount(countRootChildren(model));
      })
      .catch(() => undefined);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      mindMap.off('data_change', onDataChange);
      mindMap.off('scale', onScale);
      mindMap.off('node_active', onNodeActive);
      mindMap.destroy();
      mapRef.current = null;
      setMapInstance(null);
    };
    // model 变化（重新加载）时重建实例。
  }, [path, model]);

  // 结构在实例就绪后套用（含实例重建、sidecar 回读后的重放）。
  useEffect(() => {
    if (!mapInstance) return;
    applyStructure(mapInstance, structure);
  }, [mapInstance, structure]);

  const handleStructureChange = (id: MindmapStructureId): void => {
    // 只改状态：套用由 [mapInstance, structure] effect 统一执行，避免 setLayout 跑两遍。
    setStructure(id);
    if (MINDMAP_STRUCTURE_CLASS_BY_ID[id as keyof typeof MINDMAP_STRUCTURE_CLASS_BY_ID]) {
      applyRootStructureClass(mapRef.current, id);
      markExplicitStructure(id);
    }
    void invoke('binary:mindmapStructure:set', { path, structure: id }).catch(() => undefined);
  };

  const handleThemeChange = (id: string): void => {
    setThemeId(id);
    const mindMap = mapRef.current;
    if (mindMap) applyThemeConfig(mindMap, id);
    void invoke('binary:mindmapTheme:set', { path, theme: id }).catch(() => undefined);
  };

  const showDrawer = drawerOpen || drawerPinnedOpen;

  return (
    <div data-testid="mindmap-editor" className="relative h-full min-h-0 w-full overflow-hidden">
      <div ref={hostRef} className="h-full w-full" />
      <MindmapToolbar
        mindMap={mapInstance}
        scale={scale}
        themeId={themeId}
        saveStatus={saveStatus}
        structure={structure}
        rootChildCount={rootChildCount}
        onStructureChange={handleStructureChange}
        onThemeChange={handleThemeChange}
        onSaveNow={() => void flushPending()}
      />
      <MindmapDrawer
        mindMap={mapInstance}
        activeNodes={activeNodes}
        open={showDrawer}
        onClose={() => {
          setDrawerPinnedOpen(false);
          setDrawerOpen(false);
        }}
      />
      {!showDrawer && activeNodes.length > 0 && (
        <button
          type="button"
          data-testid="mindmap-drawer-reopen"
          onClick={() => setDrawerPinnedOpen(true)}
          className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-l-md border border-r-0 border-neutral-200/80 bg-white/80 px-1 py-3 text-xs text-neutral-600 shadow-sm backdrop-blur hover:bg-white dark:border-neutral-700/80 dark:bg-neutral-800/80 dark:text-neutral-300"
        >
          {t('binary.drawer.edit')}
        </button>
      )}
    </div>
  );
}
