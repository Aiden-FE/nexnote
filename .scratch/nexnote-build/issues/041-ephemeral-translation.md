# DEV-041 · 临时翻译（划词 + 全文）

Type: dev
Module: ai
Status: open
Blocked by: DEV-031（SDK 流式链路）
Depends: DEV-034（划词 AI 下拉）、DEV-035（编辑器工具栏）
Effort: M
Priority: P1

## Scope

落实 ADR-0006 的临时翻译语义：划词工具栏 AI 下拉新增划词翻译，结果在选区旁以只读浮层展示；编辑器工具栏新增全文翻译，结果进入临时只读翻译视图。两者均为内存态，不写回、不落盘、不进入文档树，关闭即弃；翻译请求固定关闭 reasoning，与 Chat Dock 权限模式无关。

## 验收标准

1. 块编辑与源码模式均可触发划词翻译，浮层可复制，选区消失后正确关闭或清理。
2. 全文翻译打开临时只读视图，不改正文、不写文件、不进入 Tab 文档树；关闭后结果丢弃。
3. 目标语言可每次选择，并记住上次选择；请求层断言 reasoning 已关闭。
4. 翻译结果首 token 即显，取消/失败时已显示内容有明确未完成状态。
5. 与权限模式无关，翻译不获得任何文档写权限。
6. 通过 typecheck、测试、lint、build、diff-check；Electron smoke 覆盖划词与全文翻译及文件不变断言。

## 流程与决策

在 `.wt/DEV-041` / `dev/DEV-041` 隔离实现，双轴审查通过后合并。详见 [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)、[ADR-0008](../../../docs/adr/0008-vercel-ai-sdk-agent-foundation.md)。
