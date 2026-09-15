# DEV-033 · 会话内部化 JSONL 存储

Type: dev
Module: ai
Status: open
Blocked by: DEV-031（SDK 流式链路）
Depends: DEV-012（对话 dock）
Effort: L
Priority: P1

## Scope

落实 ADR-0007：会话存于 `.nexnote/sessions/{hash}.txt`，内容为 JSONL，hash 由会话 id 派生且不变；会话不再是页面，不进入左侧文档树、索引、反链或双链。Chat Dock 提供历史列表与搜索；「导出为页面」是唯一进入页面体系的路径。本项目无存量用户，不做迁移。

## 验收标准

1. 重启后历史会话可列出、搜索、续聊；流式未完成/取消/失败状态可见并可恢复。
2. `.nexnote/sessions` 不被 Git 跟踪；会话不出现在文档树、页面索引和双链候选。
3. 续聊追加 JSONL 行，重命名不改 hash 文件名。
4. 导出产物是普通页面，与会话脱钩、可编辑可双链。
5. `chatFolder`、`type: chat` 页面化路径和旧双链拦截移除。
6. 通过 typecheck、测试、lint、build、diff-check；Electron smoke 覆盖历史续聊与导出。

## 流程与决策

在 `.wt/DEV-033` / `dev/DEV-033` 隔离实现，双轴审查通过后合并。详见 [ADR-0007](../../../docs/adr/0007-chat-sessions-internal-storage.md)、[CONTEXT.md](../../../CONTEXT.md)「AI 会话」。
