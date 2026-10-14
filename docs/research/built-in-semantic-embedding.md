# 内置多语言语义向量模型评估

> 评估日期：2026-10-14 · 结论：采用 ADR-0027：按需下载 `multilingual-e5-small` int8 ONNX，移除本地哈希后端。

## 1. 现状

NexNote 已有三阶段召回（FTS → 双链 → 向量重排）、类型化 embedding Profile、embedding generation、全量/增量索引和失败降级路径。当前 `local-hash-384` 是 SHA-256 词法哈希，不是语义模型；产品文档也已经明确它弱于语义 embedding。

关键架构事实：

- `ProviderAdapter.embeddings()` 已经是本地/远程 provider 的替换位。
- `AiStore` 会记录 `profileId:model:dimensions:metric` 指纹，维度变化会推进 embedding generation。
- `RetrievalService` 已按块批量构建向量、在候选集上做余弦重排，并在模型变化时全量重建。
- `Embedder` 目前只有 `embedWithMetadata(texts)`，不能区分查询与文档输入；这是接入 E5 前必须扩展的契约。

## 2. 模型选择

| 候选 | 量化 ONNX | 维度 | 语言定位 | 许可证 | 结论 |
| --- | ---: | ---: | --- | --- | --- |
| `Xenova/multilingual-e5-small` | 118.3MB | 384 | 多语言，含中英 | 上游 MIT | **选择** |
| `Xenova/bge-small-zh-v1.5` | 24.0MB | 512 | 中文 | MIT | 中文体积优，但不符合多语言定位 |
| `Xenova/all-MiniLM-L6-v2` | 23.0MB | 384 | 英文为主 | Apache-2.0 | 不适合中文/多语言 |

`multilingual-e5-small` 检索输入必须使用 `query: ` / `passage: ` 前缀。当前模型 revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78` 的主要文件：

- `onnx/model_quantized.onnx`：118,308,185 bytes
- `tokenizer.json`：17,082,730 bytes
- `config.json`、`tokenizer_config.json`、`special_tokens_map.json`：合计约 17KB
- 首次下载的有效载荷约 135MB，不含运行时代码。

下载必须固定 revision 和每个文件 SHA-256；许可证与模型卡也要随模型缓存落地。实现可选择 Hugging Face 为源头、GitHub Release 镜像为重试源，但不能把未校验的最新版本当作稳定模型身份。

## 3. Runtime 与执行位置

推荐 Electron utility process + native ONNX runtime baseline。应用安装包携带受审计的 runtime 代码，用户显式下载模型数据，不动态下载原生执行代码。

2026-10-14 在 Apple M5 Max / 128GB 上对 BGE-small-zh int8 做过一次性可行性 smoke：

- 本地模型加载：62ms
- 单条查询 embedding：2.6ms
- 48 条中文段落：100.2ms，约 479 docs/s
- RSS：约 312MB
- 512 维向量全部有限

该结果只证明 native ONNX 方向可行，不能外推到低配机器，也不能替代 multilingual-e5 的实测。Transformers.js 4.3.1 的 `onnxruntime-node` 包目录默认包含全平台二进制，实际发布必须按平台裁剪并 `asarUnpack`，否则会把无关平台库带入安装包。

## 4. 必补的验收

1. **检索质量**：建立中、英、混合语言查询集，比较内置语义模型、FTS、FTS+双链与远程 embedding 的 recall@8 / nDCG@8；内置模型必须显著优于本地非语义路径。
2. **低配性能**：在最低支持硬件上测查询 p95、索引进度、取消恢复、CPU/RSS 曲线；不能只测 M5 Max。
3. **下载可靠性**：代理、断点续传、重复失败、磁盘不足、半下载恢复、SHA 校验失败、离线二次启动。
4. **身份一致性**：revision/dtype/维度/度量任一变化必须触发新 generation；删除模型后禁止旧 generation 参与重排。
5. **产品边界**：用户明确知道首次约 135MB 下载、后续可离线使用；模型缓存可删除；文本不会因本地 embedding 离开设备。
