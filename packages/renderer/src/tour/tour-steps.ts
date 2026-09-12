/**
 * 新手引导分步内容。
 * 每步通过 `data-tour` 属性定位真实界面区域；目标缺失时引导卡片自动居中（优雅降级）。
 * 文案面向最终用户，说明控制在两句以内。
 */
export interface TourStep {
  /** 稳定 id（测试与日志使用） */
  id: string;
  /** 目标区域选择器：`[data-tour="<id>"]` */
  targetSelector: string;
  title: string;
  description: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'page-tree',
    targetSelector: '[data-tour="page-tree"]',
    title: '页面树与新建',
    description:
      '左侧页面树展示知识库中的所有页面与文件夹。点击「新建」可选择块编辑、Markdown 格式，或从 DOCX 文档导入。',
  },
  {
    id: 'editor',
    targetSelector: '[data-tour="editor"]',
    title: '两种编辑模式',
    description:
      '块编辑文档使用所见即所得的块编辑器；Markdown 文档支持源码模式与实时预览。内容会自动防抖保存，无需手动操作。',
  },
  {
    id: 'ai-dock',
    targetSelector: '[data-tour="ai-dock"]',
    title: 'AI 对话与写作',
    description:
      '右侧 Dock 提供 AI 对话与写作辅助，可边写边获得建议。通过欢迎页或命令面板都能随时展开与收起 Dock。',
  },
  {
    id: 'git-timeline',
    targetSelector: '[data-tour="git-timeline"]',
    title: '版本时间线与同步修复',
    description:
      '底部状态栏显示当前分支与未提交变更。版本时间线记录每次提交，遇到同步异常时可按提示一键诊断修复。',
  },
  {
    id: 'settings',
    targetSelector: '[data-tour="settings"]',
    title: '设置',
    description:
      '设置页可调整自动保存防抖间隔、文件后缀显示、主题与快捷键等。现在开始你的第一页笔记吧！',
  },
];
