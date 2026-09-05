# NexNote 原生 AI 与本地向量检索：技术调研与选型建议

> 范围：为“**OpenAI 协议唯一适配、用户自带服务商、不强制联网**”的 NexNote 原生 AI 层提供可引用的实现依据。来源优先为维护方官方文档、官方 SDK 与官方仓库；链接均应在实现前再次以目标版本复核。

## 结论先行

1. **不要把“OpenAI-compatible”当作完整行为契约。** NexNote 应定义很小的 `Provider Adapter` 内部契约与显式 `capabilities`，以运行时探测/用户确认的能力为准，而非按 provider 名称硬编码。
2. **桌面端采用主进程（或受控本地 sidecar）持钥并发网络请求，Renderer 只经 IPC 收事件。** 官方 `openai` JS SDK 的浏览器支持默认关闭，开启会暴露密钥；这与“用户自带服务商”不改变密钥隔离要求。[OpenAI SDK README](https://github.com/openai/openai-node/blob/main/README.md#requirements)
3. **MVP 选 `sqlite-vec` + 现有 SQLite 关系索引/FTS；LanceDB 仅作为大库、多模态、ANN 需求显著时的替代实现。** `sqlite-vec` 非常贴合本地单用户和同库 join，但仍是 pre-v1，必须把其 SQL 与扩展加载封在 repository 层。[sqlite-vec README](https://github.com/asg017/sqlite-vec#readme)
4. **默认实现可解释的三阶段渐进式召回：粗筛 → Link Index 扩展 → 向量重排/预算裁剪。** 先利用 NexNote 已有的 Wikilink/Backlink，不要为 MVP 引入 LLM 抽取实体图与完整 GraphRAG 索引。
5. **Embedding 是独立能力，不从聊天能力推断。** 用户应独立选择/检测 embedding endpoint 与模型；远程 API 与本地模型二选一或并存。切换 `provider + model + dimension + metric` 必须新建 generation 并重建，不能混检。

---

## 1. OpenAI 协议兼容生态：可依赖的最小面与差异

### 1.1 结论：支持面必须按能力建模

建议把对外配置统一为 `baseUrl`、`apiKey`、`chatModel`、可选 `embeddingModel`，但将实际调用收敛为：

```ts
type ProviderCapabilities = {
  chatCompletions: boolean
  responses: boolean
  streaming: 'sse' | 'ndjson' | 'none'
  tools: 'none' | 'chat-tool-calls' | 'responses-function-calls'
  toolArgumentDeltas: boolean
  embeddings: boolean
  usageInStream: boolean
  local: boolean
}
```

`chatStream()` 应只向上游产出 NexNote 自己的 `text-delta`、`tool-call-delta`、`tool-call-complete`、`usage`、`finish`、`error` 事件；`embed()` 单独返回向量和 embedding identity。这样可隔离终止帧、错误帧和工具参数流的差异。

| 服务 | 流式 | tools / function calling | embeddings | 必须处理的差异 |
| --- | --- | --- | --- | --- |
| OpenAI 官方 | Responses API 通过 `stream: true` 以 SSE 流出，官方 SDK 可 `for await` 消费。[[1]](#sources) | Responses 的函数调用输出以 `call_id` 关联，应用负责执行并回传结果；函数参数可能以 delta 到达。[[2]](#sources) | 原生 Embeddings API。[[3]](#sources) | Responses 是比 Chat Completions 更丰富的状态/输出模型；不要把其 output items 简化为纯文本后又试图继续会话。 |
| OpenRouter | `stream: true`，SSE；可能夹带 keep-alive comment；中途错误可作为 HTTP 200 内的 SSE error 事件。[[4]](#sources) | OpenRouter 要求客户端执行工具；带 tool result 的后续请求仍应携带 `tools` 供 schema 校验。[[5]](#sources) | 提供独立 embeddings API；不支持 streaming。[[6]](#sources) | usage 终帧为兼容客户端而有意偏离 OpenAI 的空 choices 形式；不得当作第二次完成。 |
| Ollama | OpenAI 兼容 `/v1/chat/completions` 支持 streaming；原生 API 的 stream 是 NDJSON，不是 SSE。[[7]](#sources) | 兼容层支持 `tools`，但官方支持表将 `tool_choice` 列为未支持。[[7]](#sources) | 兼容 `/v1/embeddings`，也有本地 embedding 模型与批量输入说明。[[7]](#sources)[[8]](#sources) | `/v1/responses` 是非 stateful：不支持 `previous_response_id` 和 `conversation`；上下文长度还需通过 Modelfile 配置，不能由兼容请求字段表达。[[7]](#sources) |
| vLLM | OpenAI-compatible server 提供 Chat/Completions 等端点；流式与模型 chat template 的细节由所部署模型决定。[[9]](#sources) | named、`auto`、`required`、`none` 等 tool choice 模式支持取决于工具 parser；自动工具调用需部署时指定相应 parser。[[10]](#sources) | 支持 embedding/pooling 模型对应的 endpoint；模型需按 embedding/pooling task 部署。[[9]](#sources) | “兼容”不代表模型输出格式天然可解析；parser、chat template 与模型组合是能力的一部分。 |
| 各类中转/自建 relay | 无可统一保证 | 无可统一保证 | 无可统一保证 | 即使声明 OpenAI-compatible，也可能只实现 Chat Completions，或丢失 usage、tool delta、embeddings、取消/错误语义；只能 capability test。 |

### 1.2 适配器行为要求

1. **连接测试拆成两项。** 以轻量 `/models` 或小 chat 测试验证聊天；以小批 input 单独验证 embeddings。两者不得互相推断。对自定义 relay，让用户可关闭 tools/embeddings，而不是把探测失败当作整个 provider 不可用。
2. **以 SSE parser 解析 SSE。** 忽略 comment，识别 `[DONE]`，并把流内 error 转成内部 `error`；不可只依赖 HTTP status。Ollama 原生模式应走单独 NDJSON parser，或强制使用其 OpenAI 兼容路径。
3. **工具参数只在完成事件后 JSON 校验并执行。** delta 只能用于 UI 显示；工具循环要保留调用 ID、原始参数、返回值、cancel/error 状态。
4. **能力降级应可见。** 没有 tools 时 UI 禁用依赖工具的操作；没有 embeddings 时仍保留 FTS + Link Index 召回；没有 stream 时使用一次性响应，而不是失败。
5. **记录诊断元数据。** 每次请求记录配置 profile（非密钥）、实际模型、endpoint family、capability snapshot、原生 finish reason、usage 和错误；不要在日志保存页面正文或 API key。

---

## 2. SDK 选型：官方 `openai` SDK vs Vercel AI SDK

| 维度 | `openai` 官方 JavaScript SDK | Vercel AI SDK |
| --- | --- | --- |
| 主要抽象 | OpenAI REST/Responses 的一方 SDK；最贴近 OpenAI 的原始事件与对象 | 多 provider 的 language-model 抽象、`streamText()` 与 UI hooks |
| 流式 | 官方声明 Responses streaming 使用 SSE，返回 async iterable。[[1]](#sources) | `streamText()` 面向流式生成；工具、文本、reasoning、finish/error 均能作为流事件处理。[[11]](#sources) |
| 多服务商 | 可传 custom `baseURL`，但协议差异由应用承担；没有跨 provider capability 抽象 | `@ai-sdk/openai-compatible` 可用 `createOpenAICompatible({ baseURL, apiKey })` 创建兼容 provider。[[12]](#sources) |
| 工具 | 原始 OpenAI Responses/function-call 语义，适合需要完整 OpenAI 行为时 | 统一 tool 生命周期，适合跨 provider 编排，但不消除上游的真实 tool-call 差异。[[11]](#sources) |
| UI 方案 | 无 UI/chat state 层 | `useChat` 默认 HTTP POST 到 `/api/chat`；自定义 transport 才能换成 IPC 或其他协议。[[13]](#sources) |
| 桌面端 | 支持 Node、Deno、Bun、Workers、Edge；浏览器默认禁用，显式 `dangerouslyAllowBrowser` 才能开启，官方明确警告密钥暴露；React Native 不支持。[[14]](#sources) | UI hooks 与默认 transport 的主要示例是浏览器 → HTTP API；可自定义 transport，但桌面 IPC、密钥与 provider 兼容仍须自行实现。[[13]](#sources) |

### 选择建议

**推荐：自有 `Provider Adapter` 为领域边界；主进程内用 `fetch`/官方 `openai` SDK 作为 OpenAI 实现细节。首版不将 Vercel AI SDK 设为核心依赖。**

理由：

- NexNote 的上游协议已经明确只接 OpenAI protocol，不需要 AI SDK 的 Anthropic/Google 等 provider 抽象；真正需要解决的是“兼容服务并不完全一致”，这必须由自己的 capability contract 承担。
- 官方 SDK 在需要 OpenAI Responses、官方 stream event 或官方工具循环时最直接；对只实现 Chat Completions 的服务可由同一 Adapter 的 SSE/fetch 实现处理。
- Vercel AI SDK **可选**用于 renderer 层的流式 UI 或以后接入更多非 OpenAI 协议时，但应包在 `AIEvent`→UI 的 adapter 后面，不能让领域模型依赖 `LanguageModel`、`useChat` 或 provider 专有类型。它的默认 `/api/chat` transport 也不适合作为桌面 IPC 架构的前提。

### 桌面安全边界

```text
Renderer / WebView
  └─ IPC: request、abort、AIEvent（无 key）
Main process / local sidecar
  ├─ OS keychain / secure storage
  ├─ Provider Adapter（HTTP、SSE/NDJSON、capabilities）
  └─ Retrieval + SQLite
```

用户“自带 API key”不等于 key 可以进入渲染层 bundle、localStorage 或普通应用日志。若未来允许浏览器直连，只能是用户明确选择的短期、受限 token 场景；不能以 `dangerouslyAllowBrowser` 作为默认桌面方案。[[14]](#sources)

---

## 3. 上下文注入与 token budget

### 3.1 四类上下文的组装优先级

上下文对象统一成可追溯的 `ContextItem`：`sourceType`、`pageId`、`blockId/range`、`contentHash`、`text`、`estimatedTokens`、`score`、`whyIncluded`。不要在 prompt 中拼匿名长字符串。

| 层 | 内容 | 组装规则 | 预算优先级 |
| --- | --- | --- | --- |
| 明确选择 | 块级 / 选区 | 用户选区原文原样保留，附页面标题与块路径；跨块选区按视觉/文档顺序合并 | 最高，hard inclusion |
| 工作上下文 | 当前页面 | 当前块附近的兄弟块、父标题路径、Frontmatter；长页面优先当前块窗口与页面摘要 | 高 |
| 关系上下文 | Wikilink / Backlink 页面 | 从当前页面和明确选择的页面出发，按 1 跳再可选 2 跳扩展；先摘要/命中块，后完整页面 | 中 |
| 检索上下文 | 全 Vault 块 | 三阶段 Progressive Recall 的结果；保留命中理由、分数、链接路径 | 按分数填充 |

**推荐装配顺序：** system instruction → 稳定的工具 schema/格式约束 → 明确选择 → 当前页面局部 → 关联页面摘要/命中块 → 检索块 → 用户问题。稳定前缀置前也符合 OpenAI prompt caching 对“重复 prompt prefix”的优化方向；但缓存只改善成本/延迟，**不增加 context window**。[[15]](#sources)

### 3.2 预算算法

对所选模型 profile 设置 `contextWindow` 与 `maxOutputTokens`；两者必须随 provider/model 保存，不能套用 OpenAI tokenizer 给所有本地模型精确计数。

```text
available = contextWindow
  - systemAndFormatTokens
  - conversationTokens
  - userInputTokens
  - toolSchemaTokens
  - reservedOutputTokens
  - safetyMargin
```

实现策略：

1. 使用该模型可用 tokenizer 计数；OpenAI 模型可本地用 `tiktoken` 做估算，但其 README 的“约 4 bytes/token”只是平均经验，不能作为精确模型。[[16]](#sources)
2. 无 tokenizer 的兼容服务使用字符近似 + 保守系数，并在 profile 上标识 `tokenEstimateMode: approximate`；实际 usage 仅用于校准与日志。
3. 先给“明确选择”和“当前局部”分配硬/软配额；剩余配额按 `relevance × linkProximity × confidence × diversityPenalty` 选 ContextItem。
4. 超限时依次降级：完整关联页面 → 页面摘要 → 相邻重复块去重 → 低分检索块；绝不静默截断用户选区，除非 UI 明示。
5. 每个最终上下文项记录原因。GraphRAG 的 Local/Global search 也采用候选优先级和 `max_data_tokens`/固定 context budget 的思路；可借鉴预算方式，不必引入其索引体系。[[17]](#sources)[[18]](#sources)

---

## 4. 本地向量检索与 embedding 取舍

### 4.1 存储方案比较

| 方案 | 优点 | 代价 / 风险 | 对 NexNote 的结论 |
| --- | --- | --- | --- |
| **sqlite-vec** | 纯 C、无依赖，SQLite 可运行处皆可运行（含 WASM）；`vec0` 可存 float/int8/binary vectors。[[19]](#sources) metadata column 可随 KNN 预过滤；partition key 可分区；auxiliary column 能回带未索引内容。[[20]](#sources) | pre-v1，预期有 breaking changes；官方文档中的 KNN 可为 brute-force，规模增长后应实测延迟。[[19]](#sources)[[21]](#sources) | **MVP 首选。** 与块、页面、Link Index、FTS 共用 SQLite 事务边界/ID；封装 extension 和 SQL，准备重建。 |
| **LanceDB embedded** | OSS 可在应用进程中运行；支持 Lance 列式数据、向量/metadata、多模态与 IVF/HNSW/PQ 等索引。[[22]](#sources)[[23]](#sources) | 需手动创建/维护索引；官方建议至少数千行再有效训练。新 append 行在优化刷新索引前走较慢 fallback；更新行会移出已有 index，更新比例大时应 rebuild。[[23]](#sources)[[24]](#sources) | **规模升级/多模态备选。** 当实际数据量或 ANN 延迟成为瓶颈后再引入，不为 MVP 提前双存储。 |
| DuckDB `vss` / hnswlib / USearch 等 | 可作为 ANN 或分析型实验的选项 | 通常需要另一套存储/索引生命周期或扩展策略；若 metadata/Link Index 仍在 SQLite，会增加跨库一致性、备份与迁移复杂度 | 不列为首版依赖；先以 benchmark 证明 sqlite-vec 不足，再在 repository 接口下替换。 |

### 4.2 推荐 schema 和更新时机

保持关系索引为事实源，向量是可重建的派生索引；避免把 Link Index 复制成向量库里的第二事实源。

```text
blocks(id, page_id, position, content_hash, text, updated_at, ...)
link_edges(from_page_id, to_page_id, kind, ...)
block_fts(...)                         -- 粗筛
block_vectors(block_id, embedding, ...) -- vec0；或独立 VectorRepository
embedding_generations(
  id, provider_profile_id, model_id, dimensions, metric,
  tokenizer_hint, status, created_at
)
vector_jobs(block_id, generation_id, content_hash, state, retry_count, ...)
```

- **索引构建：** 创建/切换 generation 时后台全量建索引；只有 generation `ready` 后才原子切换 active generation。
- **增量更新：** 块的 `content_hash` 变化即入队；删除块同步删除/排除其向量；编辑期间可 debounce。查询只读 `content_hash` 仍匹配且 generation active 的结果，避免旧正文命中旧向量。
- **与关系索引协同：** 第一阶段 SQLite FTS/Frontmatter 选 page/block 候选；第二阶段用 `link_edges` 扩展邻域；第三阶段只向 VectorRepository 查询候选或以其分数重排。`sqlite-vec` 的 metadata/partition key 可用于 vault/page scope 预过滤，不替代关系 join。[[20]](#sources)
- **迁移保护：** 锁定 sqlite-vec 版本；以 repository interface 隔离 SQL；备份中保留正文/关系真源即可，向量可重建。

### 4.3 远程 embeddings vs 本地小模型

| 维度 | 用户 API 的 embeddings endpoint | 本地 embedding model（例如 Ollama） |
| --- | --- | --- |
| 网络与隐私 | 页面/块文本离开设备；需要用户网络与服务商 | 可离线，正文不必离开设备 |
| 初始体验 | 无模型下载；但服务可能没有 embeddings 或与聊天模型不同 | 需下载模型、占用磁盘/CPU/GPU；首次索引时间可见 |
| 质量与维护 | 便于使用新的托管模型；服务商限流/计费/数据政策存在差异 | 可控且稳定，但质量、语言覆盖与速度依赖用户硬件/模型 |
| 一致性 | 更换 provider/model/dimension 必须重嵌入 | 同样必须重嵌入；Ollama 官方也要求索引与查询用同一 embedding model。[[8]](#sources) |

**明确建议：首版提供 `remote` 与 `local` 两种 embedding profile，默认不强制任选其一。**

- 用户选择 remote 时：单独做 `/embeddings` capability test、显示会外发文本与模型/成本提示；聊天 service 没有 embeddings 时可配置不同 embedding service。
- 用户选择 local 时：将 Ollama/local runtime 检测、模型下载/磁盘占用和后台排队作为显式 UI 状态；离线时仍可使用已有向量、FTS 与 Link Index。
- 每条向量至少持久化 `generationId`、`providerProfileId`、`modelId`、`dimension`、`metric`、`contentHash`。任何 identity 不同都禁止混合余弦/距离排序。

---

## 5. 渐进式召回的实现先例与 NexNote 方案

Microsoft GraphRAG 提供了有用的**检索形态**：Basic Search 是 top-k text chunks 的 vector RAG；Local Search 将知识图数据与原文 chunks 合用；Global Search 对 community reports map-reduce；DRIFT 在 local search 加入 community information。[[25]](#sources) 这证明“图扩展 + 文本/向量 + 预算”的组合是合理的，但不意味着 NexNote 应照搬其昂贵的实体抽取、community detection 和报告生成。

### 5.1 NexNote MVP 管道

```text
query / selected block / current page
  │
  ├─ A. 粗筛：FTS + title + tag + Frontmatter + recency/confidence
  │       产出 50–200 个 block/page candidates（可解释的 lexical reasons）
  ├─ B. 图扩展：由候选与当前页面走 Link Index 1 跳，必要时 2 跳
  │       衰减分数；别名归一；限制每页面/每社区的上限
  ├─ C. 向量重排：query embedding 与候选 block（或受限 top-N）求相似度
  │       score = α·vector + β·lexical + γ·link + δ·confidence − diversityPenalty
  └─ D. context packing：父子去重、相邻块合并、token budget，附 citation metadata
```

### 5.2 为什么先不做完整 GraphRAG

- NexNote 的 Wikilink/Backlink 已是用户维护的高质量关系；可直接用于 B 阶段，不必先用 LLM 从每个块再抽一张竞争性的 entity graph。
- GraphRAG 的 Local Search 适用于实体型局部问题，Global Search 适用于全数据集主题问题且是 resource-intensive。[[25]](#sources) 对 MVP 的“问当前页面/相关页面”场景，前者的图扩展思想足够，后者成本不匹配。
- Microsoft GraphRAG 官方仓库说明该项目已是 research project、处于 maintenance mode，并明确警告 indexing 成本可能很高。[[26]](#sources)

### 5.3 后续演进门槛

只有满足以下任一证据再做可安装的 Retrieval Skill（而不是 core dependency）：

- 用户确实常问“整个 Vault 的主题/冲突/趋势”，而三阶段召回无法覆盖；
- 有可量化评测集显示 link expansion + vector rerank 在跨主题问题上的 recall 不足；
- 用户愿意承担离线的 LLM 抽取成本，并可在本地/自带 provider 下设定 token/cost 上限。

届时先试“页面摘要 + 社区摘要”这类增量派生数据；每项都可删除、可重建、可禁用，避免阻塞编辑主路径。

---

## 风险清单与架构决策

| 风险 | 后果 | 缓解 / 应写入架构决策的规则 |
| --- | --- | --- |
| 兼容服务协议漂移 | 流终止、usage、tools 或 embeddings 在某服务失效 | `ProviderCapabilities`、连接测试、provider contract fixtures；业务层只见 NexNote `AIEvent` |
| Renderer 持 API key | key 被 DevTools、bundle、日志或恶意内容获取 | key 仅在主进程/sidecar + OS keychain；IPC 不接受任意 host/header 覆盖 |
| stream 中途 error 被误判成功 | UI 显示完成但正文不完整/工具状态错误 | 解析 SSE 事件而非只看 200；内部 `error` 是终态，保留 partial text 但标注失败 |
| 工具 delta 提早执行 | 参数不完整、重复或越权操作 | 仅 `tool-call-complete` 后 schema validate；每个调用必须显式确认/授权 |
| embedding identity 混合 | 相似度不可比较、召回悄然劣化 | generation schema；切换即后台重建，ready 后原子切换 |
| sqlite-vec 版本变化或规模瓶颈 | 升级/性能破坏 | repository 隔离、锁版本、重建命令、真实 Vault benchmark；LanceDB 为可替换后端 |
| 全量上下文拼接 | 费用、延迟、回答质量下降，挤掉工具/输出 | 固定 output reserve、分层压缩、父子/相邻去重、可解释 token ledger |
| 过早 GraphRAG | 高索引成本、复杂度与已有 Link Index 重叠 | MVP 只做原生三阶段；以离线评测和实际需求决定扩展 |

## 可直接采纳的决策文本

> NexNote AI 供应商适配器仅保证自身定义的 chat stream、tool、embedding 与 capability 契约，不承诺任意 OpenAI-compatible service 的完整 OpenAI 行为。网络访问和 API key 只在主进程或本地 sidecar；Renderer 经 IPC 接收脱敏流事件。MVP 的检索以 SQLite FTS/关系索引为真源、sqlite-vec 为可重建派生向量索引，实现“粗筛 → Link Index 扩展 → 向量重排 → token budget packing”；embedding provider/model 变更创建新的 generation，完成重建后切换。LanceDB 与 GraphRAG 类索引均为经 benchmark/需求证明后才启用的演进项。

---

## Sources

1. <a id="sources"></a>[OpenAI JavaScript SDK README — Streaming responses](https://github.com/openai/openai-node/blob/main/README.md#streaming-responses)
2. [OpenAI JavaScript SDK — Tools / function calling](https://github.com/openai/openai-node/blob/main/docs/tools.md)
3. [OpenAI API reference / OpenAPI definition — Embeddings](https://platform.openai.com/docs/api-reference/embeddings)
4. [OpenRouter — Streaming](https://openrouter.ai/docs/api_reference/streaming)
5. [OpenRouter — Tool calling](https://openrouter.ai/docs/guides/features/tool-calling)
6. [OpenRouter — Embeddings](https://openrouter.ai/docs/api_reference/embeddings)
7. [Ollama — OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
8. [Ollama — Embeddings](https://docs.ollama.com/capabilities/embeddings)
9. [vLLM — OpenAI-compatible server](https://docs.vllm.ai/en/stable/serving/online_serving/openai_compatible_server/)
10. [vLLM — Tool calling](https://docs.vllm.ai/en/stable/features/tool_calling/)
11. [Vercel AI SDK — Generating and streaming text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text)
12. [Vercel AI SDK — OpenAI-compatible providers](https://ai-sdk.dev/providers/openai-compatible-providers)
13. [Vercel AI SDK UI — Transport](https://ai-sdk.dev/v5/docs/ai-sdk-ui/transport)
14. [OpenAI JavaScript SDK README — Requirements / browser warning](https://github.com/openai/openai-node/blob/main/README.md#requirements)
15. [OpenAI — Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
16. [OpenAI — tiktoken](https://github.com/openai/tiktoken)
17. [Microsoft GraphRAG — Local Search](https://microsoft.github.io/graphrag/query/local_search/)
18. [Microsoft GraphRAG — Global Search](https://microsoft.github.io/graphrag/query/global_search/)
19. [sqlite-vec README](https://github.com/asg017/sqlite-vec#readme)
20. [sqlite-vec — vec0 virtual table features](https://github.com/asg017/sqlite-vec/blob/main/site/features/vec0.md)
21. [sqlite-vec — KNN](https://github.com/asg017/sqlite-vec/blob/main/site/features/knn.md)
22. [LanceDB — Enterprise / embedded architecture](https://docs.lancedb.com/enterprise)
23. [LanceDB — Vector index](https://docs.lancedb.com/indexing/vector-index)
24. [LanceDB — Updating and modifying table data](https://docs.lancedb.com/tables/update)
25. [Microsoft GraphRAG — Query overview](https://microsoft.github.io/graphrag/query/overview/)
26. [microsoft/graphrag README](https://github.com/microsoft/graphrag#readme)
