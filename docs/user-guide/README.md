# NexNote 用户手册

> 适用版本：v0.0.29 及以后。本手册是官方产品文档的**唯一真相源**，官网 `/docs` 与 `/zh/docs` 由本目录内容构建渲染（见 [ADR-0021](../../docs/adr/0021-product-documentation-on-official-website.md)）。改这里，官网同步变。

每个主题拆成独立章节，按使用顺序排列；每章有中文与英文两个版本，共用同一个 URL slug。

| # | 章节 | 中文 | English |
| --- | --- | --- | --- |
| 1 | 快速上手 | [zh](zh/getting-started.md) | [en](en/getting-started.md) |
| 2 | 编辑器：块编辑与快捷插入 | [zh](zh/editor.md) | [en](en/editor.md) |
| 3 | 双链与知识网络 | [zh](zh/wikilinks.md) | [en](en/wikilinks.md) |
| 4 | 搜索与 AI 召回 | [zh](zh/search-and-recall.md) | [en](en/search-and-recall.md) |
| 5 | 置信度 | [zh](zh/confidence.md) | [en](en/confidence.md) |
| 6 | 版本历史与同步 | [zh](zh/git-and-sync.md) | [en](en/git-and-sync.md) |
| 7 | AI 助手与权限模式 | [zh](zh/ai-assistant.md) | [en](en/ai-assistant.md) |
| 8 | 插件 | [zh](zh/plugins.md) | [en](en/plugins.md) |
| 9 | 表格与思维导图 | [zh](zh/spreadsheets-and-mindmaps.md) | [en](en/spreadsheets-and-mindmaps.md) |
| 10 | 设置与快捷键 | [zh](zh/settings.md) | [en](en/settings.md) |
| 11 | 故障排查 | [zh](zh/troubleshooting.md) | [en](en/troubleshooting.md) |

章节的 `order` frontmatter 决定官网索引排序，两种语言必须一致；`slug` 决定 URL，两种语言共用同一个。

写作约定：

- 以当前代码为准，不以旧版本手册为准；发现矛盾时改文档或改代码，但必须让二者一致。
- 术语对齐仓库根目录的 [CONTEXT.md](../../CONTEXT.md)。
- 面向最终用户，不写实现细节与内部术语。

相关：常见问题见 [docs/faq.md](../faq.md)（同批次校正中）。
