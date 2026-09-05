# DEV-009 · AI Provider Adapter 与配置系统

Type: dev
Module: ai
Status: open
Blocked by: DEV-001
Depends: DEV-001
Effort: M
Priority: P0
Parallel-with: DEV-002, DEV-007

## Scope

实现 AI 供应商适配层与配置系统：多 Profile 管理、OpenAI 协议适配器、流式传输、密钥安全存储、Embedding 接口。这是 AI 层的基础设施，写作辅助、对话、召回都依赖它。

### 交付内容
1. **Provider Adapter 架构**
   - 主进程侧实现，渲染层仅通过 IPC 调用
   - 自有 Adapter 接口：`chatCompletion`, `chatCompletionStream`, `embeddings`, `listModels`, `testConnection`
   - OpenAI 协议适配器：兼容 OpenAI 官方 / 兼容服务（Azure OpenAI、本地 Ollama 等）
   - SSE 流式传输封装（统一内部事件协议，隔离不同 provider 的 SSE 格式差异）
   - capabilities 探测：连接测试时检测支持的功能（tools / streaming / embeddings）

2. **多 Profile 配置系统**
   - Profile = 名称 + base-url + api-key + 默认模型 + 参数（temperature 等）
   - 配置存储：主进程安全存储（macOS Keychain / Windows Credential Manager / Linux libsecret 存 key，其余存 JSON）
   - 设置页：Profile 管理（新增/编辑/删除/设为默认）、导入/导出（导出不含密钥）
   - 分功能指定模型：写作辅助 / 对话 / embedding 三处可分别指定 Profile + 模型
   - 连通性测试按钮：调用 testConnection 验证

3. **密钥安全**
   - 密钥仅存在于主进程 + 系统钥匙串
   - 渲染层拿不到明文 key
   - 禁止浏览器直连（所有请求走主进程 node 网络栈）

4. **Embedding 接口**
   - `embed(texts: string[]): Promise<number[][]>` 统一接口
   - 批处理（按 token 限制自动分批）
   - 本地小模型接口预留（不实现，留接口 + 降级路径）
   - 模型 / 维度 / metric 变更检测：新 generation → 标记索引需重建

5. **首启动 AI 引导向导**
   - 未配置 Profile 时，AI 入口点击 → 引导向导
   - 向导步骤：选择 provider 类型 → 填 base-url + key → 测试连通 → 选择默认模型 → 完成
   - 对话 dock 空态 = 欢迎文案 + 配置入口

6. **降级路径**
   - 无 AI 配置时，所有 AI 入口可见但点击进入引导
   - 网络请求失败：错误提示 + 重试
   - embedding 不可用时：召回管道降级为两阶段（DEV-011 处理）

## 关联决策
- Provider Adapter 设计：[ai-vector.md](../../nexnote-mvp/docs/research/ai-vector.md)
- 多 Profile 配置 + 主进程持钥：[nexnote-mvp#09](../../nexnote-mvp/issues/09-ai-architecture.md)
- 未配置降级策略：[nexnote-mvp#09](../../nexnote-mvp/issues/09-ai-architecture.md)

## 关联原型区域
- 设置页 AI 配置、对话 dock 空态引导 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（设置 + 对话 dock）

## 验收标准
- 可创建 OpenAI 协议 Profile 并通过连通性测试
- 密钥存储在系统钥匙串，渲染层无法获取明文
- chatCompletion 流式响应正常（可在调试面板验证）
- embeddings 接口返回正确维度的向量
- 未配置 AI 时，点击 AI 入口进入引导向导
- 可导入/导出 Profile（导出不含密钥）
