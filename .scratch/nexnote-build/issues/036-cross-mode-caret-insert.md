# DEV-036 · 双模式光标插入基座

Type: dev
Module: editor
Status: closed
Blocked by: 无（可立即开始）
Depends: DEV-002（编辑器内核）、DEV-020（源码模式）、DEV-012（对话 dock）
Effort: M
Priority: P1

## Scope

建立统一的当前编辑上下文插入原语：块编辑模式写入当前 TipTap 光标，Markdown 源码模式写入当前 CodeMirror 光标，均形成单次 undo；没有活动编辑器时调用方禁用。Chat Dock 的回复插入改用该原语。

## 验收标准

1. 块页和 Markdown 源码页均可将 Chat Dock 回复插入当前光标位置。
2. 无活动编辑器（设置、图谱等 Tab）时插入按钮禁用。
3. 两种编辑器插入均可单步 undo，保存/预览行为不回归。
4. 通过 typecheck、测试、lint、build、diff-check；Electron smoke 覆盖两模式。

## 流程与决策

在 `.wt/DEV-036` / `dev/DEV-036` 隔离实现，双轴审查通过后合并。详见 [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)。
