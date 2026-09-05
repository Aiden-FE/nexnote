# 02 · 块编辑器内核选型研究

Type: research
Status: resolved

## Question

在「MD + YAML frontmatter 存储、块结构内嵌约定 + sidecar 索引、插件可扩展自定义块类型」的硬约束下，评估块编辑器内核候选：

TipTap / ProseMirror、Lexical、Slate、BlockNote、Milkdown、Remirror（可补充其他活跃候选）。

评估维度：块模型与嵌套块 / 块拖拽 / 块菜单扩展、自定义块类型的插件扩展机制、Markdown 序列化保真与**块 ID 在 Markdown 中的保留策略**（行业先例）、大文档性能、单人可维护性、license、社区活跃度。

特别关注：与 Obsidian 兼容格式先例（如 Milkdown 的 markdown-first 路线、BlockNote 的 ProseMirror 基座）。产出对比矩阵 + 建议排序。

## Answer

**要点 gist**：
1. 建议排序：**TipTap 3（主选）＞ Milkdown（第一备选）＞ BlockNote（仅原型票用）＞ Lexical（观察）＞ Slate/Plate、Remirror（不采用）**。
2. 决定性因素是「MD 为源文件」硬约束：TipTap 3 有官方 MIT `@tiptap/markdown` 包，且每个扩展可注册 `parseMarkdown`/`renderMarkdown`/`markdownTokenizer`——实现 Obsidian `^id` 锚点、callout 等私有方言的官方挂点。
3. 块 ID 保留：UniqueID 扩展（2026 年已从付费 Pro 完全开源，MIT）把 id 存 node attr，配合自定义 renderMarkdown 落盘为 `^id`；与 04 号票结论无缝衔接。
4. BlockNote 块 UX 最强但 Markdown 导入导出官方明确 lossy、权威格式是 JSON、自定义块无公开 md 序列化 hook，且 XL 功能（多列/PDF 导出）转 GPL-3.0/商业双许可 → 与 MD-first 约束冲突，仅建议 11 号原型票使用。
5. Milkdown 是唯一 markdown-first 架构（MD↔remark AST↔PM Schema 双向管道），存储保真上限最高，但块 UX 薄、单人维护。
6. 关键时点变化：ProseMirror 仓库 2026-04 迁至作者自托管 Gitea（GitHub 归档为镜像，npm 正常）；Lexical 新 `@lexical/mdast`（micromark 基座）仍 experimental。
7. 大文档：PM 系全 DOM 渲染，超大文档需分页/虚拟化兜底；BlockNote 有 ~500+ 块输入延迟的实测与修复记录（#2595/#2600）。
8. 均为 MIT/MPL 宽松许可（BlockNote core MPL-2.0），无闭源商用障碍；唯一付费风险已随 Tiptap 开源 DragHandle/UniqueID 消除。

**报告**：[docs/research/editor-kernel.md](../../../docs/research/editor-kernel.md)

**明确建议**：正式内核 = TipTap 3 + `@tiptap/markdown` + UniqueID + DragHandle + Suggestion(slash)，内核独立成框架无关包（衔接 01 号票 Electron+React+TS 结论）；备选 = Milkdown（若 MarkedJS round-trip 测试失败）；BlockNote 留给 11 号原型票验证块交互；Lexical 待 `@lexical/mdast` 转 stable 后重评。
