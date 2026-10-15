# 内置语义检索质量评测（DEV-121）

> 日期：2026-10-15 · model：`Xenova/multilingual-e5-small@761b726d…`（int8 / 384 / cosine）

## Fixture 与指标

- 12 篇 Markdown 干扰/目标文档，4 条中文、英文、中英混合语义查询；每条只有一个相关目标。
- 对比路径：FTS + 双链（`disableVector:true`） vs FTS + 双链 + 全库向量召回/重排。
- 指标：recall@8 与 nDCG@8（二元相关性，理想 DCG=1）。

| Path | recall@8 | nDCG@8 |
| --- | ---: | ---: |
| FTS + 双链 | 0.000 | 0.000 |
| 内置语义三阶段 | 1.000 | 0.908 |

本轮同时修复了一个检索架构缺口：向量阶段此前只重排 FTS seeds，FTS 为零时语义召回也为零；现在会纳入已建立向量索引的全部 block，再与 FTS/双链候选合并重排。

## 本机运行证据

- 命令：`NEXNOTE_EMBEDDING_EVAL=1 cargo test retrieval_service::tests::built_in_semantic_retrieval_eval -- --nocapture`
- 硬件：Apple M5 Max，128 GB RAM（开发机，不等价于低配机）。
- 端到端 harness（模型加载 + 12 文档向量构建 + 8 次检索）：9.59s。
- 最大 RSS：627,408,896 bytes（约 598.5 MiB）。
- 模型缓存按固定 SHA-256 验证；本评测不外发文本。

低配机 p95、RSS 曲线、取消恢复仍是独立未完成项，不能用 M5 Max 结果替代。
