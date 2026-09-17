# DEV-051 · 划词工具栏 Icon-first 与 AI 入口统一

Type: dev
Module: editor
Status: implementation-complete
Blocked by: DEV-050（共享动作语义与 Tooltip）
Depends: DEV-023（双模式划词动作）、DEV-034（AI 下拉）、DEV-041（临时翻译）
Effort: M
Priority: P1

## Scope

依据 ADR-0006，将块编辑与 Markdown 的划词工具栏统一为紧凑、可发现、键盘可达的 Icon-first 上下文工具栏。复用 DEV-050 的动作语义与 Tooltip，不改变既有格式化、双链、AI 写作、翻译及生成取消能力。

### 交付内容

1. 两种编辑器的划词动作使用一致图标、顺序、可用状态、可访问名称与 Tooltip。
2. 格式动作与双链以纯图标呈现；AI 使用 Sparkles icon + `AI` + chevron，并把适用 AI 动作保留在文字菜单内。
3. Tooltip 支持 hover、keyboard focus、快捷键与禁用原因；菜单支持方向键、Home/End、Enter/Space、Escape 和合理的焦点归还。
4. 保留 AI 流式生成中的独立停止入口、划词翻译及既有 Accept/Reject/undo 语义。
5. 工具栏仅在存在非折叠文本选区时出现；折叠选区、空选区、预览视图及失去所属编辑器时关闭。

## 安全不变量

- 工具栏出现、选区变化、hover 与菜单打开不构成显式 AI 意图，不得自动请求 provider。
- Markdown 格式化仍是原文级局部事务，不得触发 TipTap 序列化或改写未选范围。
- 关闭工具栏或 Tooltip 不得修改选择内容；AI 取消后已呈现内容遵循既有流式结果规则。

## 验收标准

- [x] TipTap 与 CodeMirror 的划词工具栏在动作集、图标、Tooltip、AI 入口和键盘行为上保持一致。
- [x] 图标按钮均有准确 `aria-label` 和 focus-visible；禁用动作可获知原因。
- [x] AI 写作、询问 AI、划词翻译和停止生成不回归，普通选区操作零隐式 AI 请求。
- [x] Markdown 格式化与双链插入保持单事务、可撤销及未选范围字节不变。
- [x] Renderer 测试覆盖鼠标与键盘可达性、菜单焦点、Escape、空/折叠选区和预览排除。
- [x] 候选 SHA 上通过标准门禁；Electron smoke 未执行时记录 `NOT_RUN`。
- [ ] 在 `.wt/DEV-051` / `dev/DEV-051` 隔离实现，完成 Standards + Spec 双轴审查后方可合并。

## 实施证据（2026-09-17，dev/DEV-051）

- 划词格式按钮由 `selectionFormatBubbleActions()` 从 DEV-050 `EDITOR_ACTION_MODEL` 投影；TipTap 与 CodeMirror 复用同一动作、名称、图标语义、快捷键与 Tooltip 文案，不另建漂移动作目录。
- 非 AI 格式/双链改为纯图标；AI 唯一入口为 Sparkles + `AI` + chevron。AI 写作、询问 AI、划词翻译保留文字菜单；流式会话的停止入口仍独立可达，Accept/Reject/undo 保持既有路径。
- 内核和 CodeMirror 均支持 Arrow、Home、End roving；AI 菜单支持 Arrow、Home、End、Enter/Space、Escape 并向触发器归还焦点。Tooltip 不使用原生 `title`，支持 hover/focus、快捷键及禁用原因。
- 真实 renderer 覆盖纯图标/aria/Tooltip、禁用解释、工具栏及菜单键盘、菜单 Escape 与焦点归还、折叠/空/失焦关闭、两个编辑器的元数据一致性；既有真实 Markdown 单事务/undo/CRLF、AI 流/取消/Accept/Reject/翻译覆盖继续通过。
- 验证：定向 `vitest` 3 files / 60 tests 通过；全项目 `typecheck` 通过。完整 test、lint、build、changed-format、diff-check 待候选提交后运行。
- Electron smoke：`NOT_RUN`（本轮未执行）。

## 关联决策

- [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)
- [ADR-0005](../../../docs/adr/0005-explicit-ai-intent-and-streaming-results.md)
- 术语：[CONTEXT.md](../../../CONTEXT.md) 划词工具栏 / 显式 AI 意图 / 临时翻译
