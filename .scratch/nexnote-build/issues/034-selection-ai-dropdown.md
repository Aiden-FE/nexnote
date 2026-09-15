# DEV-034 · 划词工具栏 AI 下拉收口

Type: dev
Module: editor
Status: open
Blocked by: 无（可立即开始）
Depends: DEV-010（写作辅助）、DEV-023（划词工具栏）
Effort: S
Priority: P1

## Scope

块编辑与源码模式的划词工具栏将多个 AI 动作折叠为单一「AI」下拉入口；保留适用动作、快捷键提示与键盘可达性，生成中提供独立停止控件。格式化五项、双链等非 AI 动作语义不变。

## 验收标准

1. 两种编辑模式的按钮集一致，AI 写作、询问 AI 等动作均可从下拉执行。
2. 下拉支持键盘打开、方向键选择、Enter 执行、Esc 关闭。
3. 生成中停止控件可点击且可键盘操作。
4. 不存在选区时不显示划词工具栏；浮层不遮挡选区。
5. 通过 typecheck、测试、lint、build、diff-check；Electron smoke 覆盖两种模式。

## 流程与决策

在 `.wt/DEV-034` / `dev/DEV-034` 隔离实现，双轴审查通过后合并。详见 [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)。
