---
status: accepted
---

# 以 Vercel AI SDK 作为 AI Agent 编排基座

AI Agent（对话、写作、翻译及后续技能与工具）统一基于 Vercel AI SDK（`ai`）在主进程实现：流式输出、工具调用循环、结构化输出都走 SDK。现有裸 fetch + 自写 SSE 解析的路径（OpenAIProtocolAdapter、ToolLoopRuntime 的 pre-tool 注入式工具）迁移到 SDK，不长期双轨并存。供应商 Profile（OpenAI 兼容协议）仍是唯一模型接入层：SDK 经 OpenAI-compatible client 指向用户配置的 base-url/API key/模型，不绕过 Provider Adapter 另建第二套接入。

技能与工具在主进程维护统一注册表：检索 Skill 与 Agent 工具同处注册，对话、写作、翻译共享，新增能力以注册项扩展而非新链路。

## Consequences

- 「工具结果拼进 system message」的过渡实现废弃，改用 SDK 原生 tool-call loop；现有 allowlist、审批与审计接点保留并接到 SDK 的工具执行路径。
- 渲染层 IPC 事件协议（agent:runEvent 的 delta/done/error 等）保持稳定，迁移不改变前端订阅方式。
- SDK 版本升级成为持续维护成本；供应商间的参数差异（如 reasoning 开关）在适配层吸收。
- `runtime.ts` 中标注「v1 不引入第三方 SDK」的 PiRuntime 占位 seam 由本决策取代。
