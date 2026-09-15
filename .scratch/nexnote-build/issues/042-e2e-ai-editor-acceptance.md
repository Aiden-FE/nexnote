# DEV-042 · 端到端集成验收与打包 smoke

Type: dev
Module: integration
Status: open
Blocked by: DEV-027、DEV-028、DEV-029、DEV-030、DEV-031、DEV-032、DEV-033、DEV-034、DEV-035、DEV-036、DEV-037、DEV-038、DEV-039、DEV-040、DEV-041、DEV-043、DEV-044
Depends: DEV-018（打包发布）、DEV-019（集成验收）
Effort: L
Priority: P0

## Scope

对 ADR-0005~0009 及本批所有验收反馈做最终集成验证，覆盖跨票组合场景、请求层安全门禁、三种权限模式、双编辑器写回、临时翻译与会话内部化；使用仓库既定离线打包 smoke 配方构建候选产物并留证。未实际执行的跨平台或真实网络项目按协议标记 `NOT_RUN`，不得以单测或构建成功替代。

## 验收标准

1. ADR-0005~0009 每条 Consequences 至少映射一条自动化断言，无法执行的标记 `NOT_RUN` 并附人工步骤。
2. 组合场景通过：源码模式编辑 H1 不失焦 → 划词翻译 → `/` 快捷插入 → Chat Dock 完全权限编辑 → 单 undo 撤销。
3. Chat Dock 对话/编辑/完全权限三档、会话历史 JSONL、导出页面、双模式插入均通过。
4. 普通编辑全链路 request-spy 零 AI provider 请求；显式 AI 操作正常发起请求。
5. 代码高亮代表语言、Skill 弹窗窄 dock、工具栏溢出和 Tab 文件名均通过。
6. 打包 Electron smoke 全绿、退出码为 0，证据写入 `.scratch/nexnote-build/smoke/DEV-042/`。
7. 候选 SHA 通过 typecheck、测试（`env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR`）、lint、build、release-config、changed-format、diff-check。

## 流程与决策

仅在 DEV-027~041 全部合并后创建候选 SHA；在固定候选 SHA 上完成 Standards + Spec 双轴审查并 PASS 后合入。合并后在 `master` 重跑门禁，更新 README、`DEV-STATUS-CHECKPOINT.md` 和发布检查清单。

## 关联决策

- [ADR-0005](../../../docs/adr/0005-explicit-ai-intent-and-streaming-results.md)
- [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)
- [ADR-0007](../../../docs/adr/0007-chat-sessions-internal-storage.md)
- [ADR-0008](../../../docs/adr/0008-vercel-ai-sdk-agent-foundation.md)
- [ADR-0009](../../../docs/adr/0009-chat-permission-modes.md)
