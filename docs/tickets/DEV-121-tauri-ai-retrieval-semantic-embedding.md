# DEV-121 Tauri AI / 召回 / 内置语义向量迁移

- 状态：in progress
- 分类：architecture
- 优先级：P1
- 工作量：XL
- 日期：2026-10-14
- 关联：DEV-ARCH-002、DEV-118、DEV-119、ADR-0005、ADR-0008、ADR-0009、ADR-0027

## 背景

现有 AI 层包含 OpenAI-compatible Profile、流式 chat、工具调用、权限模式、代理、secret store、Agent 技能、召回与本地哈希 embedding。ADR-0027 已决定移除 `local-hash-384`，改为用户显式下载多语言 `multilingual-e5-small` int8 ONNX，本地推理不依赖外部向量接口。Tauri 终态需在 Rust product core 重建这些能力。

## 方案

1. **远程 AI provider**：Rust HTTP/SSE 流式解析、取消、超时、代理与错误脱敏；OpenAI-compatible chat/tool 契约；secrets 进入系统 keychain 等效存储，Renderer 只拿 opaque token。
2. **权限与 Agent**：显式 AI 意图不变；conversation/edit/full 权限模式、工具审批与审计迁移；Agent 工具注册表与技能召回调用链迁移。
3. **内置语义向量**：模型下载管理固定 revision、SHA-256、断点、代理、失败清理与许可材料；实现 `query:` / `passage:` 输入语义；完成 Rust ONNX/runtime 选型 spike（如 `ort`、Candle 等）并明确量化支持与平台库；模型缓存位于 app data，可删除重下；generation identity 包含 model/revision/dtype/dimension/metric。
4. **召回**：FTS → Link expansion → semantic rerank；索引构建可取消、有进度、失败降级为两阶段；不同 model identity 的向量不得混用。
5. **评测**：建立中、英、混合语言查询集，对比 FTS/双链、内置语义与远程 embedding，报告 recall@8 与 nDCG@8。

## 验收标准

- [ ] 远程 provider 的流式、工具调用、取消、代理、错误路径有契约测试。
- [ ] 无显式用户意图时零网络请求的 request-spy 测试保持通过。
- [ ] 模型下载、校验、删除、离线二次启动通过；损坏缓存不会执行。
- [ ] 本地推理文本不出设备；Renderer 与插件不能读取模型文件或凭据。
- [ ] 中英混合检索质量显著优于 FTS+双链，低配性能和 RSS 达到 ADR-0027 门槛。
- [ ] macOS 实测；Windows/Linux ONNX native library 与 GUI 保持 **NOT_RUN（当前无实测条件）**。

## Out of scope

- 训练或微调 embedding 模型。
- 保留 `local-hash-384` 作为第二本地后端（ADR-0027 已否决）。
- 移动端 AI（ADR-0019 独立边界）。
