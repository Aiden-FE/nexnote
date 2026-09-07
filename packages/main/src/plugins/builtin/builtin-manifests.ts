import type { PluginManifest, PluginPermission } from '@nexnote/shared';

/**
 * 内置示范插件（DEV-015）：Mermaid 图表 + KaTeX 数学公式。
 *
 * 纯 UI 插件：仅声明 `read` 能力（不需要网络/文件/外部命令），
 * 宿主（kernel + renderer）负责块渲染，因此不启动沙箱帧、不可卸载。
 * 仍走与第三方插件一致的 manifest 解析 / 能力声明 / 贡献点 / 启停管线。
 */
const BUILTIN_COMMON: {
  version: string;
  minAppVersion: string;
  capabilities: PluginPermission[];
  permissions: PluginPermission[];
  builtin: true;
} = {
  version: '1.0.0',
  minAppVersion: '0.1.0',
  capabilities: ['read'],
  permissions: ['read'],
  builtin: true as const,
};

export const MERMAID_PLUGIN_ID = 'com.nexnote.mermaid';
export const KATEX_PLUGIN_ID = 'com.nexnote.katex';

export const builtinMermaidManifest: PluginManifest = {
  ...BUILTIN_COMMON,
  id: MERMAID_PLUGIN_ID,
  name: 'Mermaid 图表（内置）',
  main: 'builtin-mermaid.js',
  description: '在笔记中以代码块编写并预览流程图、时序图、类图、状态图、甘特图等（```mermaid）。',
  contributions: {
    blockTypes: [{ id: 'mermaid', title: 'Mermaid 图表', blockType: 'mermaid', keywords: ['mermaid', '图', 'flow', 'chart'] }],
  },
};

export const builtinKatexManifest: PluginManifest = {
  ...BUILTIN_COMMON,
  id: KATEX_PLUGIN_ID,
  name: 'KaTeX 数学公式（内置）',
  main: 'builtin-katex.js',
  description: '块级 $$…$$ 与行内 $…$ LaTeX 公式渲染。',
  contributions: {
    blockTypes: [
      { id: 'math', title: '块级公式', blockType: 'math', keywords: ['math', '公式', 'latex', 'katex', '$$'] },
      { id: 'math-inline', title: '行内公式', blockType: 'math-inline', keywords: ['math', '公式', 'latex', '$'] },
    ],
  },
};

export const BUILTIN_PLUGIN_MANIFESTS: PluginManifest[] = [
  builtinMermaidManifest,
  builtinKatexManifest,
];
