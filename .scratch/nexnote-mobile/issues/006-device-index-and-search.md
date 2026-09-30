# MOB-006 设备本地索引与中文搜索

Ticket: MOB-006 · Milestone: M2 · Branch: dev/MOB-006 · Depends: MOB-003
ADR: docs/adr/0019-mobile-data-and-capability-locality.md
Status: implemented —— 复刻桌面分词语义（CJK unigram+bigram + 拉丁前缀）；一致性单测 + 模拟器中文子串验证；截图 07

## 目标

在设备上重建派生索引并提供中文全文搜索，命中语义与桌面端一致。

## 行为

1. 建立本地 SQLite（FTS5）索引，只存派生数据（页面、链接、标签、正文），可随时从设备知识库全量重建。
2. 分词复刻桌面语义：CJK unigram + bigram、拉丁前缀匹配（对齐 `packages/main/src/indexer/index-service.ts` 的 `tok` 列策略）；实现方式与自建 tokenizer 的取舍需在票内记录。
3. 索引更新：页面写入后增量更新；提供全量重建入口（首次打开、索引版本变更、损坏恢复）。
4. 搜索体验：结果按相关度排序，命中片段高亮，可直接跳转页面；搜索在离线可用。
5. 索引文件与运行时产物不进 Git（沿用护栏意图，路径在 `.nexnote/` 之外或按护栏规则排除）。

## 边界

- v1 不做向量召回（无 embedding 生成、无向量表）。
- 不做图谱计算的重排权重（置信度只用于展示）。

## 验收

- 一致性验收：在同一个脱敏 vault 副本上，用一组固定中文查询（含 2 字子串、含拉丁前缀、含标签）对比手机端与桌面端命中集合，逐条记录差异并收敛到一致。
- 索引全量重建幂等（多次重建结果一致，抽查命中数与顺序）。
- 索引不可用时（删除/损坏）应用不崩溃，能重建。

## 跨端一致性证据（2026-09-30）

`flutter test integration_test/cross_device_test.dart` 在 iOS 模拟器上克隆评测库、写入捕获页并推送，
导出固定查询集的手机端命中集合；随后用**桌面端真实 `LinkIndexService`（FTS5）**对同一份内容跑同一组查询，
逐条比对（脚本 `.scratch/nexnote-mobile/verify/search-parity.test.ts`，`npx vitest run --config ...`）：

```
跨端命中集核对（共 6 条查询，差异 0 条）
OK   "基准"       手机端/桌面端: ["index.md"]
OK   "防抖"       手机端/桌面端: ["Inbox/跨端核对笔记.md","notes/设备端同步.md"]
OK   "双链"       手机端/桌面端: []
OK   "设备端同步"  手机端/桌面端: ["Inbox/跨端核对笔记.md","index.md","notes/设备端同步.md","refs/移动端计划.md"]
OK   "索引"       手机端/桌面端: ["Inbox/跨端核对笔记.md","index.md"]
OK   "不存在词"    手机端/桌面端: []
```

含中文子串（`基准` 命中 `搜索基准`）、标签、别名与双链目标词；未命中词两端同为 0 结果。
