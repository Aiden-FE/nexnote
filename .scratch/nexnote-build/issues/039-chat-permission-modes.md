# DEV-039 · Chat Dock 权限模式

Type: dev
Module: ai
Status: open
Blocked by: DEV-032（SDK 工具循环）、DEV-033（会话 JSONL）
Depends: DEV-012（对话 dock）
Effort: M
Priority: P1

## Scope

落实 ADR-0009：对话（工具只读）/ 编辑（逐轮成批审批）/ 完全权限（自动写回 + 五护栏）三档会话级权限模式。新会话默认对话模式；模式随会话持久化（JSONL 记录）；切换器位于输入区旁、键盘可达；切换只影响之后的操作，不追溯授权已拒绝的提案。三模式仅约束 Chat Dock 的 Agent 工具，编辑器侧划词写作、翻译、快捷插入不叠加模式判断。

## 验收标准

1. 对话模式下任何写工具调用被拒绝并有明确提示；只读工具正常。
2. 编辑模式按轮次汇总提案批次，支持整批与逐项 Accept/Reject。
3. 完全权限模式自动执行且审计可见；每次写回单 undo 可撤销。
4. 模式随会话恢复；新会话默认对话模式；切换器键盘可达。
5. 五护栏生效：限当前上下文文档、禁 shell/删除/重命名/配置、单 undo、全审计、不豁免零隐式请求门禁。
6. 通过 typecheck、测试、lint、build、diff-check；Electron smoke 覆盖三档切换。

## 流程与决策

在 `.wt/DEV-039` / `dev/DEV-039` 隔离实现，双轴审查通过后合并。详见 [ADR-0009](../../../docs/adr/0009-chat-permission-modes.md)。
