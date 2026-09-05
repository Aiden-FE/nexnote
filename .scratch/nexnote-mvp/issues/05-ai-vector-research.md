# 05 · AI 集成与本地向量检索研究

Type: research
Status: resolved

## Question

为 NexNote 原生 AI 层（OpenAI 协议唯一适配、用户自带服务商、不强制联网）提供技术事实依据：

1. OpenAI 协议兼容生态：自定义 base-url 下常见兼容服务（OpenAI 官方、OpenRouter、Ollama、vLLM、各类中转）的协议面差异（流式、tool calls、embeddings 端点可用性）。
2. SDK 选型：openai 官方 SDK vs Vercel AI SDK——流式渲染、多供应商抽象、桌面端（非 Node 服务端）适配。
3. 上下文注入模式：块级 / 选区 / 当前文档 / 关联双链文档作为上下文的组装策略与 token 预算控制先例。
4. 本地向量检索：sqlite-vec、LanceDB 及其他 embedded 向量库对比（索引构建时机、增量更新、与关系索引的协同）；embedding 来源（用户 API 的 embeddings 端点 vs 本地小模型）的取舍。
5. 渐进式召回（粗筛 → 图扩展 → 向量重排）的参考实现先例（RAG 管道、GraphRAG 类方案）。

产出选型建议与风险。

## Answer

- OpenAI-compatible 只作传输兼容；以 `capabilities` + 自有流事件协议隔离 SSE、tools、usage、embeddings 差异。
- 密钥与网络请求留在主进程/本地 sidecar，Renderer 仅经 IPC 收脱敏事件；禁止默认浏览器直连。
- SDK：Provider Adapter 为领域边界；官方 `openai` SDK 用于 OpenAI/Responses，Vercel AI SDK 仅作可选 UI/编排实现。
- MVP 向量库选 `sqlite-vec`，与 SQLite FTS/Link Index 共库；封装 pre-v1 依赖并保留全量重建路径。
- embedding 是独立能力：支持 remote 与 local profile；模型/维度/metric 改变必须新 generation 后重建，禁止混检。
- 召回采用“粗筛（FTS/metadata）→ Link Index 1–2 跳扩展 → 向量重排 → token packing”，而非立即引入完整 GraphRAG。
- LanceDB 是数据量、ANN 或多模态明确成为瓶颈后的备选；GraphRAG/社区摘要为可选 Retrieval Skill。
- 主要风险：兼容语义漂移、流内错误、工具 delta 早执行、密钥泄露、embedding 混用、sqlite-vec 演进与上下文超预算。

报告：[docs/research/ai-vector.md](../../../docs/research/ai-vector.md)

**明确建议：** 首版实施自有 Provider Adapter + 主进程持钥 + `sqlite-vec` 派生索引 + 原生三阶段渐进式召回。**备选：** 当实际 benchmark 证明 SQLite 向量检索不足或需多模态/ANN 时替换为 LanceDB；仅在全 Vault 全局主题问答有真实需求时再做 GraphRAG 类离线索引。
