# DEV-048 · 悬浮目录与预览视图跟进修复（v0.0.12 验收反馈）

Type: dev
Module: editor
Status: in-progress
Blocked by: DEV-047（已随 v0.0.12 发布）
Depends: DEV-045（三视图）、DEV-047（悬浮目录/正文目录）
Effort: S
Priority: P1

## Scope

v0.0.12 验收反馈的三项缺陷：

1. **预览视图未占满**：预览视图下内容列仍受 `--editor-content-width: 46rem` 限制，释放出的左半空间变成空白；用户预期预览占满内容区。
2. **悬浮目录不可收缩**：面板顶栏左侧图标只是装饰，无法把面板收缩成小图标，遮挡正文。
3. **分栏目录点击预览不跟随**：点击悬浮目录条目只有 CodeMirror 选区/滚动更新，右侧预览未跟随（比例滚动同步对内容高度分布不同的两侧无法保证落在标题处，且会被编辑器滚动事件回写打断）。

## 修复决策

- LivePreview 新增 `fillContent`：预览视图（独占内容区）时内容列 `max-w-none`，分栏保持阅读列宽度；同时清理编辑器窗格 `relative`+`absolute` 冲突类（Tailwind v4 中 `.relative` 生成在后会覆盖 `.absolute`，此前依赖巧合生效）。
- OutlinePanel 顶栏图标改为收缩开关：收缩态仅保留小图标按钮（`outline-expand`），展开态 `outline-toggle`；关闭按钮语义不变（彻底隐藏）。
- 分栏目录点击：编辑器单事务选区定位之外，预览按归一化文本直接滚到对应 heading（与预览视图共用 `matchPreviewHeading`）；导航后挂起比例滚动同步 1200ms，防止 CodeMirror 滚动事件触发的 `syncScrollRatio` 回写打断 smooth 滚动（真实 smoke 复现过：delta 805px > viewport）。

## 安全不变量

- 悬浮目录仍为临时 UI：收缩状态同样只在面板打开期间存在，不写盘。
- 预览视图只读边界不变；分栏比例、三视图切换、原文保真不受影响。
- 不引入新的持久化格式。

## 验收标准

1. 预览视图内容列宽度 ≈ 容器宽度（smoke 断言 ≥ 容器-80px），编辑器窗格 `absolute` 且不再携带 `relative`。
2. 悬浮目录可经顶栏图标收缩/展开；收缩态无条目、无关闭按钮，仅小图标。
3. 分栏视图点击目录条目：编辑器选区定位 + 预览滚到对应标题（目标标题距容器顶 < 视口高），且不被比例同步打断。
4. 既有 246 项 smoke 与全量单测零回归；门禁 typecheck/lint/test/build/format/diff-check 通过。

## 验收记录（2026-09-17）

- Electron smoke：252/252（原 246 零回归 + 新增 6 项，连续三次全绿），证据 `.scratch/nexnote-build/smoke/DEV-048/`。
- 定向单测 13/13（收缩交互、分栏双联动、预览占满 + 纯函数）。
- 全量门禁与发布记录见合并提交与 v0.0.13 tag。
