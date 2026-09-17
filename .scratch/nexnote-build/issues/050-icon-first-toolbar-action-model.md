# DEV-050 · 统一编辑器动作模型与 Icon-first 顶部工具栏

Type: dev
Module: editor
Status: in-review
Blocked by: 无（可立即开始）
Depends: DEV-020（Markdown 编辑）、DEV-023（双模式划词动作）、DEV-038（快捷插入）、DEV-047（目录与结构插入）
Effort: L
Priority: P1

## Scope

依据 ADR-0006，为块编辑与 Markdown 编辑建立共享的编辑器动作语义，并将顶部编辑器工具栏改为 Icon-first。用户在两种可编辑形态中获得一致的动作名称、图标、能力判断、标题转换与无障碍反馈；低频同类动作不再占据整行空间。

### 交付内容

1. 常驻撤销、重做、标题/段落、粗体、斜体、双链和 AI，并保留当前视图适用的导航与视图入口。
2. 删除线、行内代码、外链归入“格式”；表格、图片、附件、流程图、甘特图和正文目录归入“插入”。动作组在响应式溢出时保持完整，不与“更多”混为固定分类。
3. AI 使用 Sparkles icon + `AI` + chevron；其他顶层动作默认只显示图标。下拉菜单项保留图标与可读文案。
4. 用统一 Tooltip 取代原生 `title` 作为完整交互：pointer hover 与 keyboard focus 可达，展示名称、快捷键或禁用原因，Escape 可关闭；所有图标按钮有准确 `aria-label` 与 focus-visible。
5. “标题/段落”下拉支持正文及 H1–H6，转换当前 TipTap 块或当前 Markdown 行并保留文字。跨复杂结构的多块转换禁用并解释原因。
6. H1 显示为“页面标题 H1”，说明首个正文 H1 与文件名同步；执行沿用现有冲突与错误反馈，不新增打断式确认。
7. 共享动作定义提供后续顶部工具栏、划词工具栏和 `/` 快捷输入复用的稳定语义与编辑模式能力判断。

## 验收记录（2026-09-17，dev/DEV-050）

- 共享动作模型：`EDITOR_ACTION_MODEL`（id/label/分组/模式能力）+ `editorActionsForMode`，块编辑与 CodeMirror 同 id 同文案；模式专属动作按能力过滤（图片/附件仅块编辑，格式化选区/全文仅 Markdown 编辑）。
- 常驻集合：撤销、重做、标题/段落、粗体、斜体、双链、AI（Sparkles+`AI`+chevron 唯一带文案入口）；删除线/行内代码/外链/（源码模式另含格式化选区/全文）归「格式」，表格/图片/附件/流程图/甘特图/正文目录归「插入」；视图切换器与悬浮目录按视图保留。
- Icon-first：顶层仅图标；统一 `ToolbarTooltip`（hover + keyboard focus + Escape 关闭），禁用原因进入 Tooltip 文案与 `aria-label`；移除工具栏触发器与菜单项上的原生 `title`；触发器与菜单项均有 `focus-visible` 轮廓。
- 标题/段落：正文 + H1–H6（H1 显示「页面标题 H1 · 首个正文 H1 与文件名同步」）；TipTap 经 `convertBlock`（内核已扩展 h1–h6），CodeMirror 仅替换当前行 ATX 前缀（单事务、isolateHistory、未触及字节与换行风格不变）；跨复杂结构选区禁用并在菜单/Tooltip 解释，不产生任何编辑事务。
- 文件名同步：沿用既有 first-H1 rename 链路（未改动），`rename-focus` / `source-mode-io` / `title-sync` 回归通过；后续 H1 仍由 `firstH1` 只认首个正文 H1，不触发重命名。
- 响应式溢出：`resolveToolbarLayout` 以布局单元收纳同 `overflowGroup` 相邻入口，三态视图切换器等动作组整体进出「更多」，不与固定分类混同。
- 安全不变量：无动作不写内容（打开菜单/Tooltip/键盘导航不产生事务与 AI 请求，AI 仅在点击子动作时走既有显式链路）；预览视图工具栏仅视图切换 + 悬浮目录（既有测试断言不变）。
- 测试：`editor-heading-actions.test.ts`（TipTap/CodeMirror 转换、撤销重做、复杂禁用、字节保持）、`editor-toolbar-overflow.test.tsx`（Tooltip hover/focus/Esc、动作组不拆散、原有溢出与键盘用例）、`editor-toolbar-entries.test.tsx`（常驻集合、分组菜单、H1 标注、能力过滤、预览只读、分发）。
- 门禁：typecheck、完整 vitest（150 文件 1232 通过）、lint（仅存量 4 warning）、build、changed-format（prettier 通过）、`git diff --check` 均通过；Electron smoke `NOT_RUN`（本轮未执行 GUI 冒烟）。

## 安全不变量

- 无实际编辑动作时不得改变 TipTap 内容、Markdown 原文字节、frontmatter 或文件名。
- 普通工具栏打开、hover、focus、Tooltip 和菜单导航不得产生 AI 请求；AI 请求仍要求显式 AI 意图。
- Markdown 转换必须保持未触及范围与换行风格，不得通过全量序列化制造无关 diff。
- 预览视图继续只保留视图切换与导航入口，不得恢复编辑动作。

## 验收标准

- [x] 块编辑和 Markdown 编辑的共享动作在名称、图标、可用状态及结果语义上保持一致；模式专属动作按能力隐藏或禁用。
- [x] 顶部工具栏符合常驻集合及“格式 / 插入 / AI”分组；窄窗口溢出不拆散动作组。
- [x] Tooltip 可由 hover 和键盘焦点触发，Escape 关闭；禁用按钮解释原因；不再依赖原生 `title` 完成交互。
- [x] 正文与 H1–H6 转换在 TipTap 和 CodeMirror 均可撤销/重做，保留文字；复杂跨块范围得到明确禁用反馈。
- [x] 首个正文 H1 的文件名同步及冲突处理不回归，后续 H1 不误触发重命名。
- [x] 单元与 Renderer 测试覆盖动作分组、能力过滤、Tooltip、键盘菜单、响应式溢出、标题转换和预览只读边界。
- [x] 候选 SHA 上通过 typecheck、完整测试、lint、build、changed-format 与 diff-check；Electron smoke 未执行时明确记录 `NOT_RUN`。
- [x] 在 `.wt/DEV-050` / `dev/DEV-050` 隔离实现，完成 Standards + Spec 双轴审查后方可合并。

## 关联决策

- [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)
- [ADR-0004](../../../docs/adr/0004-source-mode-replaces-split-pane.md)
- 术语：[CONTEXT.md](../../../CONTEXT.md) 编辑器工具栏 / 工具栏动作组 / Markdown 视图 / 显式 AI 意图
