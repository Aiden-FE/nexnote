# DEV-052 · 块编辑器接入共享 `/` 快捷输入

Type: dev
Module: editor
Status: implementation-complete
Blocked by: DEV-050（共享动作模型）
Depends: DEV-038（现有快捷插入）、DEV-047（结构插入与标题目录）
Effort: M
Priority: P1


## 实施记录（2026-09-17，dev/DEV-052）

- 实现共享快捷插入动作定义（分组、中文/英文/Markdown 记号别名、编辑模式能力），块编辑菜单按“基础块、插入、AI、插件”分组并在组内按匹配度排序。
- 真实 TipTap contenteditable DOM 的 KeyboardEvent/InputEvent + DOMObserver 验收覆盖段落、标题、列表、引用触发；代码块、行内代码、URL、路径、数学和单词内部不触发；以及 Tab 确认、Escape、Backspace、空态和 undo/redo。
- 块类型在已有正文时过滤；结构动作在当前顶层块后插入，双链/AI/插件按能力分组；普通交互不触发 AI。
- 初始候选 `f4c8343` 的 Standards/Spec 审查发现触发词 eligibility、数学 fail-closed、结构安全插入、共享模型与测试真实性缺口；追加 `2339b40`、`4c649b1`、`75e5355` 修复为 shared catalog 投影、execution/context contract、插件能力过滤与拆分的 quick-insert 模块。
- 最终验证记录（候选 `75e5355`）：定向 4 files / 32 tests passed；`CI=true pnpm typecheck`、完整 `pnpm test`（152 files passed / 1 skipped，1292 tests passed / 2 skipped）、`pnpm lint`（0 errors，4 个既有 warnings）、`pnpm build`、`bash scripts/check-changed-format.sh master`、`git diff --check master...HEAD` 均通过。
- 二审数据安全修复候选 `4bf9985`：修正真实输入后的 trigger 范围、裸 `/` 消费、跨块 selection 失效、override dedupe、媒体/AI/插件/内置动作 contract、canonical Mermaid/AI/media 元数据与 toolbar hint/shortcut 投影；定向 5 files / 52 tests、完整测试 152 files passed / 1 skipped，1293 tests passed / 2 skipped，typecheck/lint/build/changed-format/diff-check 均通过。
- happy-dom 验收使用明确的浏览器默认输入 helper（keydown → DOM selection mutation → InputEvent → DOMObserver flush），断言实际节点与选区；最终真实 Chromium packaged 链路保留给 DEV-057 smoke。Electron smoke：`NOT_RUN`。

## Scope

依据 ADR-0006，让块编辑器的 `/` 菜单使用共享动作模型，并从“仅普通段落”的现状扩展为当前可编辑行的安全快捷输入。交付必须由真实键盘输入链路验证，不得用直接调用编辑器 hook 代替用户行为。

### 交付内容

1. `/` 可在普通段落、标题、列表项与引用的行首或空白后触发；代码块、行内代码、URL、路径、数学表达式和单词内部不触发。
2. 支持中文名称、英文别名及 Markdown 记号过滤；方向键、Enter/Tab、Escape 和 Backspace 行为遵循 ADR-0006。
3. 菜单按基础块、插入、AI、插件分组；过滤后按匹配度重排，最近使用不得越过分组或能力边界。
4. 正文、H1–H6、列表、任务列表、引用和代码块作为类型转换，仅在触发词前无有效正文时显示。
5. 分隔线、表格、媒体、图表和正文目录作为独立结构插入；已有正文时仅在安全块边界插入。双链与 AI 可在当前光标执行。
6. 确认动作消费 `/` 与过滤文本；Escape 关闭并保留原文；无匹配时显示空态，不意外执行命令。

## 安全不变量

- 非触发上下文中的 `/` 必须作为普通文本写入。
- 菜单打开、过滤、导航和取消不得产生 AI 请求；只有确认 AI 动作才构成显式 AI 意图。
- 结构动作不得截断已有文本、误改相邻块或跨越当前页面；操作进入当前 TipTap undo/redo 历史。

## 验收标准

- [ ] 真实键盘输入可在段落、标题、列表项和引用中打开菜单，并在所有排除上下文中保持普通 `/`。
- [ ] 中文、英文和记号别名过滤及全套键盘行为可用；确认和取消后的原文精确符合决策。
- [ ] 三类动作的上下文可见性与执行结果正确，已有正文不出现不安全类型转换。
- [ ] 插件动作按块编辑能力接入，不适用动作不展示。
- [ ] 集成测试通过浏览器输入事件驱动真实 TipTap，不直接调用 `handleTextInput` 冒充验收。
- [ ] 既有块菜单、选区工具栏、AI、插入与 undo/redo 测试不回归。
- [ ] 候选 SHA 上通过标准门禁；Electron smoke 未执行时记录 `NOT_RUN`。
- [ ] 在 `.wt/DEV-052` / `dev/DEV-052` 隔离实现，完成 Standards + Spec 双轴审查后方可合并。

## 关联决策

- [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)
- 术语：[CONTEXT.md](../../../CONTEXT.md) 快捷插入 / 块编辑模式 / 显式 AI 意图
