/**
 * DEV-099：xmind 主题预设（grill 确认 5 套 curated）。
 * 库核心只内置 default 主题配置；预设以「覆盖默认配置的局部对象」表达，
 * 应用时 deepMerge(baseThemeConfig, preset) 后交给 mindMap.setThemeConfig。
 * 选择经 binary:mindmapTheme:set 持久化到 sidecar（mindmapTheme 字段）。
 */

export interface MindmapThemePreset {
  id: string;
  label: string;
  /** 覆盖 default 主题配置的局部对象。 */
  config: Record<string, unknown>;
}

export const MINDMAP_THEME_PRESETS: MindmapThemePreset[] = [
  {
    id: 'classic',
    label: '经典绿',
    config: {
      backgroundColor: '#fafafa',
      lineColor: '#549688',
      root: { fillColor: '#549688', color: '#ffffff', borderColor: 'transparent' },
      second: { fillColor: '#ffffff', color: '#1f2328', borderColor: '#549688' },
      node: { fillColor: 'transparent', color: '#1f2328', borderColor: 'transparent' },
    },
  },
  {
    id: 'business',
    label: '商务蓝',
    config: {
      backgroundColor: '#f5f7fa',
      lineColor: '#2f6fed',
      root: { fillColor: '#2f6fed', color: '#ffffff', borderColor: 'transparent' },
      second: { fillColor: '#ffffff', color: '#1f2328', borderColor: '#2f6fed' },
      node: { fillColor: 'transparent', color: '#1f2328', borderColor: 'transparent' },
    },
  },
  {
    id: 'warm',
    label: '暖橙',
    config: {
      backgroundColor: '#fff8f2',
      lineColor: '#e8833a',
      root: { fillColor: '#e8833a', color: '#ffffff', borderColor: 'transparent' },
      second: { fillColor: '#ffffff', color: '#1f2328', borderColor: '#e8833a' },
      node: { fillColor: 'transparent', color: '#1f2328', borderColor: 'transparent' },
    },
  },
  {
    id: 'dark',
    label: '暗色',
    config: {
      backgroundColor: '#1f2328',
      lineColor: '#4b5563',
      root: { fillColor: '#30363d', color: '#e6edf3', borderColor: '#444c56' },
      second: { fillColor: '#21262d', color: '#e6edf3', borderColor: '#444c56' },
      node: { fillColor: 'transparent', color: '#adbac7', borderColor: 'transparent' },
    },
  },
  {
    id: 'minimal',
    label: '极简灰',
    config: {
      backgroundColor: '#ffffff',
      lineColor: '#9ca3af',
      root: { fillColor: '#111827', color: '#ffffff', borderColor: 'transparent' },
      second: { fillColor: '#ffffff', color: '#374151', borderColor: '#d1d5db' },
      node: { fillColor: 'transparent', color: '#374151', borderColor: 'transparent' },
    },
  },
];

export const DEFAULT_MINDMAP_THEME = 'classic';

export function themePresetById(id: string): MindmapThemePreset {
  const fallback = MINDMAP_THEME_PRESETS[0] as MindmapThemePreset;
  return MINDMAP_THEME_PRESETS.find((preset) => preset.id === id) ?? fallback;
}

/** 递归合并普通对象（数组与叶子值直接覆盖），用于 base 主题配置 + 预设。 */
export function deepMergeTheme(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      out[key] = deepMergeTheme(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}
