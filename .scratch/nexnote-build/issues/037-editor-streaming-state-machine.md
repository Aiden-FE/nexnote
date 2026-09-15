# DEV-037 · 编辑器侧 AI 流式状态机

Type: dev
Module: ai
Status: open
Blocked by: DEV-031（SDK 流式链路）、DEV-034（AI 下拉收口）
Depends: DEV-010（写作辅助）
Effort: M
Priority: P1

## Scope

落实 ADR-0005 的编辑器侧流式语义：AI 生成首片段即显示；生成中状态可见、可取消；取消、失败、断线均保留已显示内容并标记未完成；整次 AI 操作只产生一个 undo 单元。该状态机为划词 AI 写作与后续快捷插入（DEV-038）共用。

## 验收标准

1. mock provider 逐片段推送时界面增量呈现，不等待完整响应。
2. 取消、失败、断线后已生成内容保留、标记未完成、可继续编辑。
3. Accept 以单事务写回（单 undo）；Reject 恢复原文；流式过程不污染撤销栈。
4. 生成中有明确的进行中状态与停止控件（配合 DEV-034 下拉）。
5. request-spy 断言仅显式操作发请求；通过 typecheck、测试、lint、build、diff-check；Electron smoke 覆盖取消与失败场景。

## 流程与决策

在 `.wt/DEV-037` / `dev/DEV-037` 隔离实现，双轴审查通过后合并。详见 [ADR-0005](../../../docs/adr/0005-explicit-ai-intent-and-streaming-results.md)。
