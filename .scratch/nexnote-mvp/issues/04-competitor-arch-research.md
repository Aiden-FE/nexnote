# 04 · 竞品块模型与存储格式研究

Type: research
Status: claimed

## Question

在「源文件 = Markdown + YAML frontmatter、兼容双链元数据、目标 Obsidian vault 互操作」的立场下，调研行业先例的块 ↔ 文件映射方案：

- Obsidian：vault 目录格式、frontmatter 约定、wikilink / 别名语法、`.obsidian` 索引与插件生态对第三方格式的假设。
- Notion：公开 API 呈现的 block model（块类型、嵌套、properties）。
- 思源 SiYuan（开源）：块 ID 与 .sy 文档格式、块引用机制、Markdown 导入导出的损益。
- AFFiNE（开源）：BlockSuite 块存储与文档模型。
- Logseq：大纲式块模型的 Markdown 持久化方式。

聚焦回答：段落 / 标题 / 列表 / 表格 / 媒体 / 嵌套块在纯 Markdown 中**无损表达 vs 需降级 or sidecar** 的边界在哪里；块 ID 内嵌（HTML 注释 / data 属性 / 链接锚点）各先例怎么写。产出映射边界结论。
