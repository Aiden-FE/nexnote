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
  titleKey: string;
  descriptionKey: string;
  /**
   * DEV-081：进入该步前的前置动作。返回值会传给同一步的 cleanup。
   * 不在这里直接调用 ui-store —— 实际执行由 GuidedTour 在 React effect 中触发，
   * 保证副作用在正确的生命周期内。
   */
  prepare?: () => unknown;
  /**
   * DEV-081：离开该步时的清理动作。snapshot 是 prepare 的返回值。
   * 语义见 tour-steps 注释：若用户在该步期间手动改动了 dockVisible，cleanup 不强行复原。
   */
  cleanup?: (snapshot: unknown) => void;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'page-tree',
    targetSelector: '[data-tour="page-tree"]',
    titleKey: 'tour.step.pageTree.title',
    descriptionKey: 'tour.step.pageTree.description',
  },
  {
    id: 'editor',
    targetSelector: '[data-tour="editor"]',
    titleKey: 'tour.step.editor.title',
    descriptionKey: 'tour.step.editor.description',
  },
  {
    id: 'ai-dock',
    targetSelector: '[data-tour="ai-dock"]',
    titleKey: 'tour.step.aiDock.title',
    descriptionKey: 'tour.step.aiDock.description',
    // DEV-081：进入该步前快照 dockVisible，由 GuidedTour 决定展开动作。
    prepare: () => null,
    cleanup: () => undefined,
  },
  {
    id: 'git-timeline',
    targetSelector: '[data-tour="git-timeline"]',
    titleKey: 'tour.step.gitTimeline.title',
    descriptionKey: 'tour.step.gitTimeline.description',
  },
  {
    id: 'settings',
    targetSelector: '[data-tour="settings"]',
    titleKey: 'tour.step.settings.title',
    descriptionKey: 'tour.step.settings.description',
  },
];
