import { useEffect, useRef, useState } from 'react';
import MindMap from 'simple-mind-map';
import Drag from 'simple-mind-map/src/plugins/Drag.js';
import { invoke } from '../lib/ipc';
import { subscribeSession, flushPending } from './session';
import type { SessionState } from './session';
import { MindmapToolbar } from './mindmap-toolbar';
import { MindmapDrawer } from './mindmap-drawer';
import { MINDMAP_NODE_BTN_ICONS } from './mindmap-icons';
import { DEFAULT_MINDMAP_THEME, deepMergeTheme, themePresetById } from './mindmap-themes';

/**
 * xmind 编辑器（DEV-074，ADR-0015 R3；DEV-099 操作界面）。
 * simple-mind-map 承担思维导图编辑；数据为节点树（binary:read 返回的 data.model）。
 * DEV-099：四角悬浮工具组（撤销/重做/保存、缩放/适应/主题）+ 选中节点右侧抽屉
 * （节点/形状/颜色/标记/备注/超链接）；Drag 插件启用节点拖拽；主题预设经
 * sidecar mindmapTheme 持久化。
 */

// simple-mind-map 的静态插件注册（类方法，非 React hook）；经 bind 取别名后调用，
// 避免 react-hooks/rules-of-hooks 把 usePlugin 误判为组件内 hook 调用。
const installMindMapPlugin = MindMap.usePlugin.bind(MindMap);
installMindMapPlugin(Drag);

export interface MindmapEditorProps {
  path: string;
  /** simple-mind-map 根节点树。 */
  model: unknown;
  onChange: (model: unknown) => void;
}

type MindMapWithInternals = MindMap & {
  view: { enlarge: () => void; narrow: () => void; fit: () => void; reset: () => void; scale: number };
  themeConfig: Record<string, unknown>;
  execCommand: (command: string, ...args: unknown[]) => void;
  on: (event: string, cb: (...args: never[]) => void) => void;
  off: (event: string, cb: (...args: never[]) => void) => void;
};

export function MindmapEditor({ path, model, onChange }: MindmapEditorProps): React.JSX.Element {
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
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const baseThemeRef = useRef<Record<string, unknown> | null>(null);
  // 渲染期不得读 ref（react-hooks/refs）：把实例镜像进 state 供工具栏/抽屉消费。
  const [mapInstance, setMapInstance] = useState<MindMapWithInternals | null>(null);

  // 主题应用 = base 主题 × 预设深合并；声明前置于挂载 effect（react-hooks/immutability）。
  const applyThemeConfig = (mindMap: MindMapWithInternals, id: string): void => {
    const base = baseThemeRef.current;
    if (!base) return;
    const preset = themePresetById(id);
    mindMap.setThemeConfig(
      deepMergeTheme(JSON.parse(JSON.stringify(base)) as Record<string, unknown>, preset.config),
    );
  };

  // 落盘状态（编辑中…/已保存/失败）来自宿主 session。
  useEffect(() => {
    const apply = (session: SessionState | null): void => setSaveStatus(session?.status ?? null);
    apply(null);
    return subscribeSession(apply);
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
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
    setMapInstance(mindMap);
    baseThemeRef.current = JSON.parse(JSON.stringify(mindMap.themeConfig)) as Record<string, unknown>;

    const onDataChange = (data: unknown): void => onChangeRef.current(data);
    const onScale = (value: number): void => setScale(value);
    const onNodeActive = (_node: unknown, list: unknown[]): void => {
      setActiveNodes(list ?? []);
      // grill Q7：选中自动拉开抽屉；取消选中自动收（除非手动固定开）。
      setDrawerOpen((list ?? []).length > 0);
    };
    mindMap.on('data_change', onDataChange);
    mindMap.on('scale', onScale);
    mindMap.on('node_active', onNodeActive);

    // DEV-099 快捷键：Delete 删除选中、Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 与 Ctrl+Y 重做、Ctrl/Cmd+S 立即保存。
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
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        mindMap.execCommand(e.shiftKey ? 'FORWARD' : 'BACK');
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        mindMap.execCommand('FORWARD');
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
        e.preventDefault();
        mindMap.execCommand('REMOVE_NODE');
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // 主题：sidecar 持久化优先（grill Q3/Q8）。
    void invoke('document:getMetadata', { path })
      .then((meta) => {
        const stored = (meta as { mindmapTheme?: unknown } | null)?.mindmapTheme;
        const id = typeof stored === 'string' ? stored : DEFAULT_MINDMAP_THEME;
        setThemeId(id);
        applyThemeConfig(mindMap, id);
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
          编辑
        </button>
      )}
    </div>
  );
}
