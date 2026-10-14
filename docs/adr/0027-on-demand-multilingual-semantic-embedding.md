---
status: accepted
---

# 按需下载的多语言内置语义向量模型

NexNote 的本地 embedding 统一为真正的语义模型，不再保留 `local-hash-384` 词法向量后端。默认候选为 MIT 许可的 `Xenova/multilingual-e5-small`（上游 `intfloat/multilingual-e5-small`）int8/quantized ONNX 权重：模型不随安装包捆绑，用户显式启用内置语义向量时按固定 revision、文件 SHA-256 与许可材料下载到应用数据目录；下载失败、校验失败或用户未启用时，召回退回 FTS + 双链，不静默外发文本。远程 embedding Profile 仍可作为用户主动配置的高质量替代方案。

## Consequences

- 内置后端必须区分 `query:` 与 `passage:` 输入；multilingual-e5 官方模型卡说明缺失前缀会显著降低检索质量。
- Embedding model identity 必须包含模型 ID、revision、dtype/量化格式、维度与度量；任何变化创建新 generation 并全量重建，禁止与旧向量混排。
- 推理在 Electron utility process/native ONNX baseline 中执行，不阻塞主进程；全量索引必须支持进度、取消和错误恢复。
- 发布门槛包括中英及混合语言检索评测、低配机查询/索引进度/RSS 指标、下载代理与断点/重试行为、离线二次启动、权限与隐私文案、三平台真实包启动检查。
- 不把用户下载的模型或原生执行代码放在 vault；模型缓存属于应用派生数据，可删除后重新下载。

## Considered Options

- **随安装包捆绑 BGE-small-zh**：体积小且中文质量好，但应用是多语言产品，且安装包所有用户都承担模型成本；否决。
- **保留 `local-hash-384` 作为 fallback**：零成本但不是语义模型，会造成双重模型成本、双重 UX 和错误质量预期；否决。
- **仅提供远程 embeddings**：质量容易保证，但与离线/本地优先目标冲突；仅作为显式配置的替代方案。
