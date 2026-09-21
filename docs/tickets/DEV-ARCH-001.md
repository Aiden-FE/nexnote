# DEV-ARCH-001 划词工具栏宿主抽取（Selection Toolbar Host）

## 背景
improve-codebase-architecture 架构走查发现：块编辑（ProseMirror）与源码（CodeMirror）
两条划词工具栏路径存在大量重复 —— 定位数学（`frame.left + width/2` 钳制、
`translate(-50%,-100%)`）、挂载策略、滚动监听、dismiss 状态机、AI 下拉接线
各自维护一份；kernel 已抽取的部分（createBubbleAiMenu 等）只覆盖 DOM 构造。

## 变更
- **新增 `packages/kernel/src/extensions/selection-toolbar-host.ts`**：
  深模块 `createSelectionToolbarHost`，拥有 DOM 构造、挂载（parent 容器坐标 /
  viewport fixed 两种坐标空间）、定位钳制（优先 offsetParent 含块，退回 mount）、
  关闭语义（focusout / Escape 通知 / dismiss-resetDismiss 标志）。
- **新增 `selection-bubble-helpers.ts`**：共享按钮装饰 / Tooltip / AI 下拉 DOM 构造。
- **PM `selection-bubble.ts` 589 → 187 行**：适配器，把 ProseMirror 选区状态翻译为
  `host.sync(visible, coords)`；scroll 重定位由 document 捕获监听驱动。
- **CM `source-bubble.ts` 322 → 208 行**：适配器，`coordsAtPos` 推迟到 rAF
  （CodeMirror 禁止 dispatch 期间读布局）；scroll 驱动 `scheduleCoordRefresh`。
- **新增 8 例 host 单测**（`packages/kernel/tests/selection-toolbar-host.test.ts`）。

## 行为保持
- Smoke 契约选择器 `[data-selection-bubble]` / `[data-source-selection-bubble]` 不变。
- DEV-034 AI 收口下拉、DEV-041 划词翻译 onSelectionLost、DEV-063 图标注入、
  stop 控件生命周期、PM 保留 / CM 非隐藏语义全部保持。

## 审查与门禁证据（commit 47dc433）
- Standards 轴：PASS（4 项 P1/P2 全部修复于 c047075）
- Spec 轴：PASS（P1 offsetParent 防御 + 3 项 P2 修复于 47dc433）
- `pnpm typecheck` 0 errors；`pnpm lint` 0 errors
- kernel+renderer 890/890（合并后 106 文件 903/903）
- `pnpm build` PASS
- master 合并：5516bf8（--no-ff）
