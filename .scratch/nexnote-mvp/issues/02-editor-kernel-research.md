# 02 · 块编辑器内核选型研究

Type: research
Status: claimed

## Question

在「MD + YAML frontmatter 存储、块结构内嵌约定 + sidecar 索引、插件可扩展自定义块类型」的硬约束下，评估块编辑器内核候选：

TipTap / ProseMirror、Lexical、Slate、BlockNote、Milkdown、Remirror（可补充其他活跃候选）。

评估维度：块模型与嵌套块 / 块拖拽 / 块菜单扩展、自定义块类型的插件扩展机制、Markdown 序列化保真与**块 ID 在 Markdown 中的保留策略**（行业先例）、大文档性能、单人可维护性、license、社区活跃度。

特别关注：与 Obsidian 兼容格式先例（如 Milkdown 的 markdown-first 路线、BlockNote 的 ProseMirror 基座）。产出对比矩阵 + 建议排序。
