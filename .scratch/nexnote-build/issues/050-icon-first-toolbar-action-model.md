# DEV-050 · 统一编辑器动作模型与 Icon-first 顶部工具栏

Type: dev
Module: editor
Status: open
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

## 安全不变量

- 无实际编辑动作时不得改变 TipTap 内容、Markdown 原文字节、frontmatter 或文件名。
- 普通工具栏打开、hover、focus、Tooltip 和菜单导航不得产生 AI 请求；AI 请求仍要求显式 AI 意图。
- Markdown 转换必须保持未触及范围与换行风格，不得通过全量序列化制造无关 diff。
- 预览视图继续只保留视图切换与导航入口，不得恢复编辑动作。

## 验收标准

- [ ] 块编辑和 Markdown 编辑的共享动作在名称、图标、可用状态及结果语义上保持一致；模式专属动作按能力隐藏或禁用。
- [ ] 顶部工具栏符合常驻集合及“格式 / 插入 / AI”分组；窄窗口溢出不拆散动作组。
- [ ] Tooltip 可由 hover 和键盘焦点触发，Escape 关闭；禁用按钮解释原因；不再依赖原生 `title` 完成交互。
- [ ] 正文与 H1–H6 转换在 TipTap 和 CodeMirror 均可撤销/重做，保留文字；复杂跨块范围得到明确禁用反馈。
- [ ] 首个正文 H1 的文件名同步及冲突处理不回归，后续 H1 不误触发重命名。
- [ ] 单元与 Renderer 测试覆盖动作分组、能力过滤、Tooltip、键盘菜单、响应式溢出、标题转换和预览只读边界。
- [ ] 候选 SHA 上通过 typecheck、完整测试、lint、build、changed-format 与 diff-check；Electron smoke 未执行时明确记录 `NOT_RUN`。
- [ ] 在 `.wt/DEV-050` / `dev/DEV-050` 隔离实现，完成 Standards + Spec 双轴审查后方可合并。

## 关联决策

- [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)
- [ADR-0004](../../../docs/adr/0004-source-mode-replaces-split-pane.md)
- 术语：[CONTEXT.md](../../../CONTEXT.md) 编辑器工具栏 / 工具栏动作组 / Markdown 视图 / 显式 AI 意图
