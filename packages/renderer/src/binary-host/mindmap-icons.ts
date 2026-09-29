/**
 * DEV-099：xmind 节点标记（icon）集合。
 * grill 决策：shadcn/lucide 图标语言优先——以下 12 个标记取 lucide 的路径数据
 * （ISC 许可，24×24 stroke 风格），以 SVG 字符串写入 simple-mind-map 的 node icon 数据；
 * 工具栏/抽屉 UI 侧用 lucide-react 组件保持同一视觉语言。
 */

export interface MindmapMarker {
  id: string;
  label: string;
  /** 写入 model 的 SVG 字符串（simple-mind-map icon 数据）。 */
  svg: string;
}

function svg(color: string, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `${body}</svg>`
  );
}

export const MINDMAP_MARKERS: MindmapMarker[] = [
  {
    id: 'priority-high',
    label: '优先级 高',
    svg: svg('#ef4444', '<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/>'),
  },
  {
    id: 'priority-medium',
    label: '优先级 中',
    svg: svg('#f59e0b', '<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/>'),
  },
  {
    id: 'priority-low',
    label: '优先级 低',
    svg: svg('#3b82f6', '<path d="M2 20h.01"/><path d="M7 20v-4"/>'),
  },
  {
    id: 'progress-0',
    label: '进度 0%',
    svg: svg('#9ca3af', '<circle cx="12" cy="12" r="10"/>'),
  },
  {
    id: 'progress-50',
    label: '进度 50%',
    svg: svg('#3b82f6', '<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z" fill="#3b82f6" stroke="none"/>'),
  },
  {
    id: 'progress-100',
    label: '进度 100%',
    svg: svg('#22c55e', '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  },
  {
    id: 'done',
    label: '完成',
    svg: svg('#22c55e', '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  },
  {
    id: 'undone',
    label: '未完成',
    svg: svg('#ef4444', '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'),
  },
  {
    id: 'star',
    label: '星标',
    svg:
      svg('#f59e0b', '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" fill="#f59e0b" stroke="none"/>'),
  },
  {
    id: 'flag',
    label: '旗标',
    svg: svg('#6366f1', '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>'),
  },
  {
    id: 'heart',
    label: '关注',
    svg:
      svg('#ec4899', '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill="#ec4899" stroke="none"/>'),
  },
  {
    id: 'warning',
    label: '警告',
    svg:
      svg('#f97316', '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  },
];

export function markerById(id: string): MindmapMarker | undefined {
  return MINDMAP_MARKERS.find((marker) => marker.id === id);
}

/**
 * DEV-099 节点内嵌按钮图标（折叠/展开/快捷加子节点）。
 * simple-mind-map 经 Style.iconNode 以 **fill** 上色，故这里用填充型路径（非 stroke）。
 * 折叠用双左箭头（向内收拢）、展开用双右箭头（向外展开）——避免 minus 圆圈被误读为删除；
 * 尺寸由 expandBtnSize 控制（DEV-099 反馈：整体缩小一半 → 10）。
 */
export const MINDMAP_NODE_BTN_ICONS = {
  /** 节点展开态显示的按钮图标（点击后折叠）。 */
  collapse:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12.6 5.3 5.9 12l6.7 6.7 1.6-1.6L9.1 12l5.1-5.1z"/>' +
    '<path d="M18.6 5.3 11.9 12l6.7 6.7 1.6-1.6L15.1 12l5.1-5.1z"/></svg>',
  /** 节点折叠态显示的按钮图标（点击后展开）。 */
  expand:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11.4 5.3 18.1 12l-6.7 6.7-1.6-1.6L14.9 12 9.8 6.9z"/>' +
    '<path d="M5.4 5.3 12.1 12l-6.7 6.7-1.6-1.6L8.9 12 3.8 6.9z"/></svg>',
  /** 激活叶子节点右缘的快捷加子节点按钮。 */
  addChild:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
} as const;

/** 由 SVG 字符串反查标记 id（抽屉里显示节点已挂标记的高亮态）。 */
export function markerIdBySvg(svgString: string): string | undefined {
  return MINDMAP_MARKERS.find((marker) => marker.svg === svgString)?.id;
}
