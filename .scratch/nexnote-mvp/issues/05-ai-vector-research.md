# 05 · AI 集成与本地向量检索研究

Type: research
Status: claimed

## Question

为 NexNote 原生 AI 层（OpenAI 协议唯一适配、用户自带服务商、不强制联网）提供技术事实依据：

1. OpenAI 协议兼容生态：自定义 base-url 下常见兼容服务（OpenAI 官方、OpenRouter、Ollama、vLLM、各类中转）的协议面差异（流式、tool calls、embeddings 端点可用性）。
2. SDK 选型：openai 官方 SDK vs Vercel AI SDK——流式渲染、多供应商抽象、桌面端（非 Node 服务端）适配。
3. 上下文注入模式：块级 / 选区 / 当前文档 / 关联双链文档作为上下文的组装策略与 token 预算控制先例。
4. 本地向量检索：sqlite-vec、LanceDB 及其他 embedded 向量库对比（索引构建时机、增量更新、与关系索引的协同）；embedding 来源（用户 API 的 embeddings 端点 vs 本地小模型）的取舍。
5. 渐进式召回（粗筛 → 图扩展 → 向量重排）的参考实现先例（RAG 管道、GraphRAG 类方案）。

产出选型建议与风险。
