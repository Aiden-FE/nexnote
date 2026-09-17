# DEV-038 · 快捷插入（/ 触发 + 工具栏入口）

Type: dev
Module: editor
Status: closed
Blocked by: DEV-035（工具栏统一）、DEV-036（光标插入基座）、DEV-037（流式状态机）
Depends: DEV-020（源码模式）
Effort: M
Priority: P1

## Scope

落实 ADR-0006 的快捷插入：`/` 仅在行首或空白之后触发快捷动作菜单（URL、路径、数学表达式、单词内不触发）；Esc 关闭并保留原文；动作确认后消费触发用的 `/` 与过滤文本。菜单保留既有非 AI 快捷动作并新增「AI 插入」：打开轻量指令输入框，提交后基于当前段落及紧邻上下文在光标处流式插入，不替换正文。编辑器工具栏提供同语义常驻按钮（经 DEV-035 溢出机制仍可达）。

## 验收标准

1. 块/源码两模式 `/` 触发、过滤、键盘选择、消费触发文本全链路可用。
2. URL/路径/单词内 `/` 不触发；Esc 后原文完整保留。
3. AI 插入结果流式写入光标处，可取消（沿用 DEV-037 状态机语义）。
4. 工具栏按钮与 `/` 同语义；窄窗口下经「更多」菜单仍可触发。
5. request-spy 断言仅显式触发；通过 typecheck、测试、lint、build、diff-check；Electron smoke 覆盖两模式与键盘链路。

## 流程与决策

在 `.wt/DEV-038` / `dev/DEV-038` 隔离实现，双轴审查通过后合并。详见 [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)。
