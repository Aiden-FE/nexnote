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

## 首审 FAIL 与修复记录（2026-09-18）

- DEV-051 首次 Standards + Spec 双轴/专项审查结论：**FAIL**。本节只记录审查事实和修复证据，不预填最终两轴 PASS；最终双轴验收项继续保持未勾选。
- 修复独立停止按钮 Tooltip 的 hover/focus 可见 CSS 与 Escape 关闭行为，并补 DOM class、hidden 状态和 CSS selector 回归测试。
- TipTap shortcut 分派现在执行时动态检查 `action.disabled`；禁用动作不触发 action。二审进一步统一为共享 dispatcher，并明确消费匹配但禁用的 shortcut，防止泄漏到全局命令；真实 TipTap DOM `keydown` 覆盖禁用→恢复可用。
- Tooltip、AI 菜单与工具栏 Escape 分层：编辑器级 Escape 忽略来自工具栏后代的事件；Tooltip Escape 只关闭 Tooltip；菜单 Escape 只关闭菜单并归还触发器；工具栏/编辑器自身 Escape 保持原关闭语义。TipTap 与 CodeMirror 均由真实编辑器 DOM 事件链覆盖。
- TipTap 与 CodeMirror 顶层工具栏共用 `moveSelectionBubbleToolbarFocus()`，统一 ArrowLeft/ArrowRight/Home/End 和 hidden/disabled 过滤策略，消除两份 roving 实现。
- 修复候选门禁（追加提交前）：定向 `vitest` 3 files / 64 tests、全项目 `typecheck`、完整 `test` 151 files（150 passed / 1 skipped）、1283 tests（1281 passed / 2 skipped）、`lint`（0 errors、4 个既有 warnings）、`build`、changed-format、diff-check 均通过；最终独立双轴结果仍不预填。Electron smoke：`NOT_RUN`。

## 二审 FAIL 与修复记录（2026-09-18）

- DEV-051 二次专项复审结论：**FAIL**。继续只记录结论和修复证据，最终 Standards + Spec 双轴验收项保持未勾选。
- CodeMirror 与 TipTap 现共用 selection shortcut dispatcher：格式动作及 AI 动作经真实编辑器 DOM `keydown` 分派，动态 disabled 不触发；匹配但禁用的 shortcut 仍被明确消费，尤其 `Mod+E` 不再泄漏到全局视图切换。
- AI 菜单 Enter/Space 成功执行先关闭菜单并归还 trigger；若动作同步关闭了 bubble，则微任务将焦点归还所属编辑器，activeElement 不停留在 hidden menuitem。
- 顶层控件实现真实 roving tabindex：可用控件只有一个 `tabIndex=0`，ArrowLeft/ArrowRight/Home/End 同步 tabindex 与焦点；MutationObserver 在 hidden/disabled/aria-disabled 动态变化后修复有效 tabstop。
- Escape 分层完成：首次 Escape 只关闭可见 Tooltip；菜单 Escape 只关菜单并归还 trigger；trigger/工具栏控件上的后续 Escape 关闭 bubble 并归还编辑器。TipTap 与 CodeMirror 均由真实 DOM 冒泡链覆盖。
- 两种 bubble 均监听自身 focusout：内部焦点移动保留，移到外部立即关闭；Renderer 挂载测试明确断言 preview 视图没有 selection bubble DOM。
- 二审修复候选门禁（追加提交前）：定向 `vitest` 3 files / 64 tests、全项目 `typecheck`、完整 `test` 151 files（150 passed / 1 skipped）、1287 tests（1285 passed / 2 skipped）、`lint`（0 errors、4 个既有 warnings）、`build`、changed-format、diff-check 均通过；最终独立双轴结果仍不预填。Electron smoke：`NOT_RUN`。

## 三审 FAIL 与修复记录（2026-09-18）

- DEV-051 三次专项复审结论：**FAIL**。本节记录修复，最终 Standards + Spec 双轴验收项继续不勾选。
- 动态 `disabled()` / `disabledReason()` 在 TipTap/CodeMirror 的 selection 更新中实时刷新 `aria-disabled`、`aria-label`/Tooltip 和 roving tabstop；disabled ↔ enabled 均通过真实编辑器 DOM 选区更新覆盖，未由测试直接改写控件 DOM。
- `selectionFormatBubbleActions()` 仅从 DEV-050 `EDITOR_ACTION_MODEL` 投影 label、icon、shortcut 及显式 `selectionOrder`；`⌘E` 现在由模型提供真实 Tooltip 快捷键，匹配 shortcut（含 disabled `Mod+E`）明确消费以避免全局冲突。
- 普通格式动作、AI trigger 与 stop 控件改用内核 `attachBubbleTooltip()`，统一 Tooltip 创建、hover/focus、pointer/blur 和 Escape 生命周期。
- 新增真实 `SourceModeView` + 未 mock CodeMirror 的 preview renderer 测试：存在真实选区时 bubble 仍隐藏，所有内部按钮 `tabIndex=-1` / 不可访问；同时保留 preview capability 单元覆盖。
- AI 菜单成功执行会归还 trigger；若执行同步关闭 bubble，焦点回所属 TipTap/CodeMirror 编辑器，真实 DOM 断言覆盖。
- 三审修复候选门禁（追加提交前）：定向 `vitest` 5 files / 86 tests、全项目 `typecheck`、完整 `test` 151 files（150 passed / 1 skipped）、1290 tests（1288 passed / 2 skipped）、`lint`（0 errors、4 个既有 warnings）、`build`、changed-format、diff-check 均通过；最终独立双轴结果仍不预填。Electron smoke：`NOT_RUN`。

## 关联决策

- [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)
- [ADR-0005](../../../docs/adr/0005-explicit-ai-intent-and-streaming-results.md)
- 术语：[CONTEXT.md](../../../CONTEXT.md) 划词工具栏 / 显式 AI 意图 / 临时翻译
