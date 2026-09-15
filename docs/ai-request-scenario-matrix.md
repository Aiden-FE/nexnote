# AI Provider 请求场景矩阵

本矩阵是 ADR-0005「显式 AI 意图」的回归门禁。请求计数在主进程 provider 网络层（`createProviderRequestSpy`）完成，而不是通过界面 loading 状态推断。测试 spy 只在测试注入，生产环境仍使用真实 `fetch`，不改变 fail-closed 行为。

## 场景与允许请求

| 场景 | 用户显式意图 | 允许的 provider 请求 | 回归覆盖 |
| --- | --- | --- | --- |
| 输入、删除、粘贴 | 否 | 无 | `zero-implicit-ai-requests.test.ts` |
| 撤销 / 重做 | 否 | 无 | 编辑链路门禁 |
| 光标与选区变化 | 否 | 无 | 编辑链路门禁 |
| 自动保存、文件 watcher、增量关系索引 | 否 | 无 | `zero-implicit-ai-requests.test.ts` |
| H1 改名、Tab 切换 | 否 | 无 | 普通场景矩阵 |
| 打开编辑器、AI dock、预览 | 否 | 无 | 普通场景矩阵 |
| 普通搜索、页面浏览、页面跳转 | 否 | 无 | `zero-implicit-ai-requests.test.ts` |
| 配置 Profile / 保存设置 | 否 | 无（配置操作不探测 provider） | AI service tests |
| 询问 AI / 对话发送 | 是 | `POST /v1/chat/completions`（或对应兼容 provider 路径） | `ai-service.test.ts`、`ai-ipc-contract.test.ts` |
| 划词写作 | 是 | `POST /v1/chat/completions`（流式时 `stream=true`） | Agent/AI stream tests |
| 显式语义搜索 / 检索 | 是 | `POST /v1/embeddings`；向量不可用时允许降级为 FTS/双链 | retrieval tests |
| 显式重建语义索引 | 是 | `POST /v1/embeddings`（按块批量） | retrieval tests |
| 连通性测试 / 列出模型 | 是 | `GET /v1/models`，以及能力探测所需的显式 chat/embedding 请求 | `ai-openai-adapter.test.ts` |

## 边界规则

- `LinkIndexService` 的关系索引与文件 watcher 只更新本地派生 SQLite 缓存；其 `onIndexed` 回调不得隐式调用 `RetrievalService.invalidate`。
- `RetrievalService.buildAll`、`updatePages` 和 `retrieve` 是语义索引/检索操作，只有显式调用方可触发 embedding。
- 请求 spy 记录 method/path，不记录请求体或 API key；测试产物不得包含凭据。
- GUI smoke 未在本票中真实运行时必须标记 `NOT_RUN`；单元测试不能替代 GUI 验收。

## 回归命令

```sh
pnpm vitest run packages/main/tests/zero-implicit-ai-requests.test.ts
```
