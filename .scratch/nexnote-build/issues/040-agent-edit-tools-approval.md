# DEV-040 · Agent 编辑工具与审批批次

Type: dev
Module: ai
Status: closed
Blocked by: DEV-039（权限模式）
Depends: DEV-032（工具循环）、DEV-036（光标插入基座）
Effort: L
Priority: P1

## Scope

注册写工具使 AI 对话能编辑当前选中文档或选区：作用域限当前会话上下文涉及的文档；写回复用统一写回语义（单事务、单 undo）。编辑模式产出轮次 diff 批次（整批或逐项取舍）；完全权限模式自动执行但保留五护栏与全审计；禁止 shell、页面删除/重命名、vault 配置等非文档操作。工具审计（名称/目标/结果摘要）在对话流可见。

## 验收标准

1. 「编辑当前选区」「在文档末尾追加」等指令端到端可用（mock provider 验证）。
2. 编辑模式逐项/整批取舍生效；拒绝项不落盘。
3. 完全权限模式直写后单步 undo 撤销整个操作；越界请求被拒并审计。
4. 每次写回在编辑器中体现为单 undo 单元；与 DEV-036 插入原语一致。
5. request-spy 断言仅显式意图链路发请求；通过 typecheck、测试、lint、build、diff-check；Electron smoke 覆盖审批与直写两路径。

## 流程与决策

在 `.wt/DEV-040` / `dev/DEV-040` 隔离实现，双轴审查通过后合并。详见 [ADR-0009](../../../docs/adr/0009-chat-permission-modes.md)、[ADR-0005](../../../docs/adr/0005-explicit-ai-intent-and-streaming-results.md)。
