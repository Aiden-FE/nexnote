# 04 · 竞品块模型与存储格式研究

Type: research
Status: resolved

## Question

在「源文件 = Markdown + YAML frontmatter、兼容双链元数据、目标 Obsidian vault 互操作」的立场下，调研行业先例的块 ↔ 文件映射方案：

- Obsidian：vault 目录格式、frontmatter 约定、wikilink / 别名语法、`.obsidian` 索引与插件生态对第三方格式的假设。
- Notion：公开 API 呈现的 block model（块类型、嵌套、properties）。
- 思源 SiYuan（开源）：块 ID 与 .sy 文档格式、块引用机制、Markdown 导入导出的损益。
- AFFiNE（开源）：BlockSuite 块存储与文档模型。
- Logseq：大纲式块模型的 Markdown 持久化方式。

聚焦回答：段落 / 标题 / 列表 / 表格 / 媒体 / 嵌套块在纯 Markdown 中**无损表达 vs 需降级 or sidecar** 的边界在哪里；块 ID 内嵌（HTML 注释 / data 属性 / 链接锚点）各先例怎么写。产出映射边界结论。

## Answer

报告：[docs/research/competitor-arch.md](../../../docs/research/competitor-arch.md)（全部一手来源：官方文档仓库 / 官方 API 文档 / 项目源码，含 SiYuan 导出配置源码核验）。

Gist：
1. 无损边界：段落/ATX 标题/列表任务列表/纯网格 GFM 表格/围栏代码块/图片落在 CommonMark+GFM+LaTeX（Obsidian 官方方言组合）内，纯 Markdown 可无损往返。
2. 关系层必然方言：块 ID/块引用无标准位置，先例三种内嵌形态——Obsidian 链接锚点式 `^id`（结构块独立行、列表项挂行、字符集 `[a-zA-Z0-9-]`）、SiYuan IAL 式 `{: id=".." }`、Logseq 行内属性 `id:: uuid`；**无一家用 HTML 注释或 data 属性**；Notion(UUIDv4)/AFFiNE(Yjs) 根本不落文件。
3. 结构层必然降级：任意嵌套容器、合并单元格/列宽/表 caption、列布局（super block/column/edgeless）Markdown 表达不了，先例存私有结构（AST/IAL/CRDT），导出线性化或丢弃。
4. 表现层必然丢弃：块颜色/内联样式/折叠（Notion color 枚举、SiYuan style IAL）。
5. 块引用导出有成熟三档降级先例（SiYuan BlockRefMode 源码：锚文本/siyuan:// 块链/脚注+锚点哈希，默认第三档；Obsidian 官方自认 block ref 外部不工作）。
6. 索引 sidecar 均可重建（Obsidian IndexedDB metadata cache、SiYuan temp/ blocktree.db+FTS5），源目录只留标准文件。

结论（供架构决策票引用）：NexNote 页面元数据走 YAML frontmatter（对齐 Obsidian 六类型 + tags/aliases/cssclasses 保留名）；块 ID 采用 Obsidian 兼容 `^id` 锚点语法（目标生态零成本互操作），导入时兼容解析 Logseq `id::` 与 SiYuan IAL；块引用导出内置三档降级；Link Index 做成可从 vault 全量重建的派生缓存；Markdown 表达不了的块属性宁可降级视图，不发明第二套文件内嵌语法。
