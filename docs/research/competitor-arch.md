# 竞品块模型与存储格式研究：块 ↔ 文件映射边界

- 票据：[.scratch/nexnote-mvp/issues/04-competitor-arch-research.md](../../.scratch/nexnote-mvp/issues/04-competitor-arch-research.md)
- 日期：2026-09-05
- 立场前提：源文件 = Markdown + YAML frontmatter；双链元数据兼容；目标 Obsidian vault 互操作
- 来源纪律：仅采用一手来源（官方帮助文档、官方文档仓库、官方 API 文档、项目源码）；每条关键结论附来源链接

---

## 0. 核心结论（映射边界，可直接被架构决策票引用）

1. **内容层可无损**：段落、ATX 标题、有序/无序/任务列表、GFM 表格（无合并单元格）、围栏代码块、行内样式、图片链接，落在 CommonMark + GFM + LaTeX（即 Obsidian 官方声明的方言组合）内，纯 Markdown 可无损往返。Obsidian 明确自称基于 CommonMark + GFM + LaTeX + 一组扩展（wikilink/嵌入/块引用/footnote/`%%注释%%`/`==高亮==`/callout）。
2. **关系层必须"方言化"或降级**：块 ID 内嵌、块引用、块嵌入在标准 Markdown 中无位置，五家先例全部自造语法：Obsidian 用链接锚点式 `^id`、SiYuan 用 kramdown IAL `{: id="..." }`（源格式实为 JSON AST）、Logseq 用行内属性行 `id:: <uuid>`；Notion 与 AFFiNE 根本不落 Markdown，ID 由服务端/CRDT 结构持有（UUIDv4 / Yjs Y.Map 键）。**没有任何一家用 HTML 注释或 data 属性内嵌块 ID**。
3. **结构层必然降级**：任意嵌套容器（列表项内嵌表格/代码之外的非列表块、横向布局列、super block、Notion column/tab、AFFiNE hub/edgeless 画布）、合并单元格与列宽（colspan/rowspan/colgroup）、块级折叠/顺序号等，Markdown 语法树表达不了，先例一律存私有结构（AST/CRDT/属性），导出 Markdown 时线性化或丢弃。SiYuan 的容器包含规则（列表项可含任意块）比 CommonMark 更宽，是其 .sy 与 Markdown 不能无损互转的根因。
4. **表现层必然降级或丢弃**：块颜色/背景（Notion 每块 color 枚举）、内联样式（SiYuan IAL `style`）、表格 caption、图片尺寸控制等；Obsidian 用非标扩展（`![[img|100]]`）在自家生态内闭环，跨工具降级。
5. **块引用的导出降级有成熟先例**：SiYuan 源码中 `BlockRefMode` 提供「锚文本块链（`siyuan://blocks/<id>` 链接）/ 仅锚文本 / 脚注+锚点哈希」三种导出模式，默认脚注+锚点哈希；Obsidian 官方也明示 block reference 是私有扩展、"won't work outside of Obsidian"。**NexNote 的块引用导出应内置同等的三档降级策略。**
6. **索引一律 sidecar 且可重建**：Obsidian 把 metadata cache（链接/标题/标签解析结果）放在 IndexedDB，支持从 vault 文件重建；SiYuan 把 blocktree.db（块 ID→路径）与 FTS5 全文索引放 `temp/`，明确声明文件系统才是权威内容、索引可重建；AFFiNE/Logseq(DB 版) 以数据库为主存储。**NexNote 的关系索引（Link Index）应同样做成"从 vault Markdown 可全量重建"的派生缓存，源目录只留标准文件。**
7. **对 NexNote 的直接建议**：页面级元数据走 YAML frontmatter（对齐 Obsidian properties：text/list/number/checkbox/date/date&time 六类型 + `tags`/`aliases`/`cssclasses` 保留名）；块 ID 采用 Obsidian 兼容的 `^id` 锚点语法（字符集 `[a-zA-Z0-9-]`，段落行尾、结构块独立行、列表项挂 bullet 行），以"兼容读写 Obsidian vault"为第一目标；导入 Logseq（`id::`）与 SiYuan（IAL）语法作兼容解析；凡 Markdown 表达不了的块属性，宁可降级视图也不要发明第二套内嵌语法污染文件。

---

## 1. Obsidian：Markdown 文件 + 私有锚点扩展

### 1.1 Vault 目录格式

- Vault = 本地文件系统上的普通文件夹（含子文件夹），笔记为 Markdown 纯文本；可用其他编辑器/文件管理器直接改，Obsidian 自动刷新外部变更。来源：[How Obsidian stores data](https://github.com/obsidianmd/obsidian-help/blob/master/en/Files%20and%20folders/How%20Obsidian%20stores%20data.md)。
- 配置放 vault 根下 `.obsidian` 文件夹（可改名/多 profile）：设置、主题、插件等，与笔记内容分离。来源：[Configuration folder](https://github.com/obsidianmd/obsidian-help/blob/master/en/Files%20and%20folders/Configuration%20folder.md)。
- **索引是派生缓存**：Obsidian 维护 metadata cache（驱动 Graph/Outline 等），持久化在 IndexedDB，且"可能失步、可在设置中重建"——官方定位即"可从 vault 文件重建的本地缓存"。来源：同 How Obsidian stores data。
- 支持的文件类型：`.md`、`.base`、`.canvas`（JSON Canvas）、图片（avif/bmp/gif/jpeg/jpg/png/svg/webp）、音频、视频、PDF；其他格式靠社区插件扩展。来源：[Accepted file formats](https://github.com/obsidianmd/obsidian-help/blob/master/en/Files%20and%20folders/Accepted%20file%20formats.md)。
- 文件名中避免使用 `# | ^ : %% [[ ]]` 等字符（链接语法冲突）。来源：[Internal links](https://github.com/obsidianmd/obsidian-help/blob/master/en/Linking%20notes%20and%20files/Internal%20links.md)。

### 1.2 Frontmatter 约定（Properties）

- 顶部 `---` YAML 块，属性类型六种：Text / List / Number / Checkbox / Date / Date & time（+ Tags 专型）；同名字段全 vault 统一类型。来源：[Properties](https://github.com/obsidianmd/obsidian-help/blob/master/en/Editing%20and%20formatting/Properties.md)。
- 保留属性：`tags`、`aliases`（列表）、`cssclasses`；Publish 另有 `publish`/`permalink`/`description`/`image`/`cover`；`tag`/`alias`/`cssclass` 单数形式已废弃（1.9 移除）。
- 明确不支持：嵌套属性、批量编辑、**属性值内 Markdown 渲染**（设计取舍：属性只放"小而原子"的数据）；wikilink 值必须加引号 `"[[Episode IV]]"`；也接受 JSON 块但会被转存为 YAML。来源同上。

### 1.3 Wikilink / 别名 / 块 ID 语法

来源：[Internal links](https://github.com/obsidianmd/obsidian-help/blob/master/en/Linking%20notes%20and%20files/Internal%20links.md)、[Embed files](https://github.com/obsidianmd/obsidian-help/blob/master/en/Linking%20notes%20and%20files/Embed%20files.md)、[Aliases](https://github.com/obsidianmd/obsidian-help/blob/master/en/Linking%20notes%20and%20files/Aliases.md)。

- 链接双格式：wikilink `[[Note]]` 与 Markdown `[Note](Note.md)` 等价，可全局切换生成格式；路径从 vault 根起、`/` 分隔、Markdown 格式需 URL 编码。
- 锚点：`[[Note#Heading]]`（多级子标题连加 `#`）；块锚点 `[[Note#^block-id]]`。
- 别名：frontmatter `aliases` 列表（页面级复用）；一次性显示文本用 `[[Note|Display]]`。
- 嵌入：`![[...]]`，可嵌页面/标题/块/附件，图片支持 `|宽x高` 尺寸后缀。
- **块 ID 写法（链接锚点式的代表）**：
  - 简单段落：行尾空格 + `^id`，如 `... happier place. ^37066d`；
  - 结构块（列表/引用/callout/表格）：**独立一行、前后空行**；
  - 列表项：可直接放在该 bullet 行；
  - 字符集约束："Latin letters, numbers, and dashes"（`[a-zA-Z0-9-]`），自动生成示例为 6 位十六进制样式；可手写可读 id（`^quote-of-the-day`）；
  - 官方明示限制：**不支持链接到引用/callout/表格内部的特定部分**；"Block references are specific to Obsidian and not part of the standard Markdown format"。
- 方言组合：CommonMark + GFM + LaTeX，扩展语法表见 [Obsidian Flavored Markdown](https://github.com/obsidianmd/obsidian-help/blob/master/en/Editing%20and%20formatting/Obsidian%20Flavored%20Markdown.md)（`[[…]]`、`![[…]]`、`^id`、`[^id]` 脚注、`%%注释%%`、`~~删除~~`、`==高亮==`、任务列表、callout `> [!note]`、表格等）；并明确 **HTML 元素内部不渲染 Markdown**（性能与解析复杂度取舍）。

### 1.4 对第三方格式的生态假设

插件生态完全建立在"vault = 普通文件夹 + Markdown 文件 + Obsidian API 读取"之上：第三方格式要么作为附件存在（可链接/嵌入但无结构语义），要么由插件自解析。对 NexNote 的含义：只要输出标准 `.md` + frontmatter + wikilink/`^id`，即可零成本进入 Obsidian 插件生态（含 Git、Dataview 等以文件为单位的工具）。

---

## 2. Notion：API 呈现的 block model（无文件格式）

来源：[Block reference（官方 API 文档）](https://developers.notion.com/reference/block)、[Working with page content](https://developers.notion.com/guides/data-apis/working-with-page-content)。

### 2.1 块对象结构

- 每个 block：`object:"block"`、`id`（**UUIDv4**，服务端分配）、`parent`、`type`、`created_time/last_edited_time/created_by/last_edited_by`、`in_trash`、`has_children`，外加与 `type` 同名的类型专属对象（如 `paragraph.rich_text`）。
- 类型清单（约 35 种）：paragraph、heading_1..4（`is_toggleable` 时可有 children）、bulleted/numbered_list_item、to_do、toggle、code（language 枚举）、quote、callout（icon+color）、divider、equation（KaTeX，实为 rich text 子对象）、image/audio/video/file/pdf/embed/bookmark/link_preview、table+table_row（cells=二维 rich text 数组；`table_width` 创建后不可改）、column_list+column（`width_ratio`）、synced_block（原/镜像）、template、table_of_contents、child_page/child_database、tab、meeting_notes（原 transcription）、unsupported 兜底。
- 通用属性模式：文本块 = `rich_text[]` + `color` 枚举 + `children[]`；媒体块 = file object（hosted 临时 URL / external / file_upload）。

### 2.2 嵌套模型

- 支持子块的类型有明确白名单（列表项、callout、column、可折叠标题、quote、synced_block、table、template、to_do、toggle、child_page/database 等）。
- **读取时子块不内联**：响应只给 `has_children:true`，需递归调 `retrieve block children`；分页每页 100 条。这是"块树 + 惰性子节点拉取"的代表设计。
- 表格是父块 + table_row 子块的两层结构；equation/mention 是 rich text 内嵌对象——**"块"与"行内对象"两套体系并存**。

### 2.3 对本调研的含义

Notion 证明：块模型可以完全脱离文件存在（纯服务端树 + UUID），互操作只能走 API 转换；其 color/icon/布局容器等属性在 Markdown 中无对应物，导出必然降级。它是"块能力上限"的参照，而非"文件映射"的参照。

---

## 3. SiYuan（思源）：JSON AST 为真源，Markdown 是导入导出格式

来源（均为官方仓库一手材料）：[SY-FORMAT.md](https://github.com/siyuan-note/siyuan/blob/master/docs/SY-FORMAT.md)、[WORKSPACE.md](https://github.com/siyuan-note/siyuan/blob/master/docs/WORKSPACE.md)、[README FAQ](https://github.com/siyuan-note/siyuan/blob/master/README.md#faq)、源码 [kernel/model/export.go](https://github.com/siyuan-note/siyuan/blob/master/kernel/model/export.go) 与 [kernel/conf/export.go](https://github.com/siyuan-note/siyuan/blob/master/kernel/conf/export.go)。

### 3.1 存储格式与块 ID

- `.sy` 文件 = Lute 解析器（kramdown 方言）AST 序列化的 JSON：根节点 `NodeDocument`，正文为递归 `Children`；无独立 JSON Schema，Go 结构体即事实来源。
- **块 ID：22 字符 `YYYYMMDDHHMMSS-xxxxxxx`**（14 位时间戳 + 7 位 `[a-z0-9]` 随机），**工作区全局唯一**，每个规范块必有 `ID` 且与 `Properties.id` 一致。
- **文件名即 ID、目录即层级**：文档 = `data/<box>/<docID>.sy` + 同名 `<docID>/` 目录（子文档放里面，任意深度）；资源统一进 `assets/`。
- 属性用 IAL（Inline Attribute List）：扁平 `map[string]string`，块级必有 `id`/`updated`，可选 `style`/`fold`/`name`/`alias`/`memo`/`bookmark`/`colgroup`/`caption`/任意 `custom-*`。Markdown 文本形态即 kramdown IAL 语法 `{: id="..." style="..."}`（行内样式需与 `NodeKramdownSpanIAL` 成对出现，否则 round-trip 丢样式）。

### 3.2 块引用机制

- 块引用 = `NodeTextMark` 的 `block-ref` 类型：`TextMarkBlockRefID` + 锚文本，子类型 `s`（静态锚文本）/`d`（动态锚文本，跟随目标内容）。
- 块嵌入 = `NodeBlockQueryEmbed`，内容是 SQL：`{{select * from blocks where id='...'}}`。
- 块树索引 `blocktree.db`（块 ID→文件路径）在 `temp/`，官方明确是**可重建索引**；推荐通过 HTTP API/MCP/CLI 改数据以保持索引同步，直接改 `.sy` 后需"重建索引"。

### 3.3 Markdown 导入导出损益（源码核验）

- SiYuan 的 Markdown 方言**禁用**：YAML front matter 节点、footnotes、`[toc]`、Setext 标题、`{#heading-id}`、单波浪删除线、链接引用定义、缩进代码块（仅 ATX/围栏）——导入这些语法会被规范化丢弃（见 SY-FORMAT §11，源自 `kernel/util/lute.go` 的 `SetXxx(false)`）。
- 导出 Markdown 的块引用转换模式（`conf/export.go`）：
  - 模式 2：锚文本 + `siyuan://blocks/<id>` 块链；
  - 模式 3：仅锚文本；
  - 模式 4（**默认**）：脚注 + `#<defID>` 锚点哈希；
  - 0/1/5 已废弃。块嵌入默认转 Blockquote（`BlockEmbedMode:1`）。
- 导出可选 `MarkdownYFM`（默认 false）：是否补 YAML front matter；资源文件名可去掉 ID 段（`RemoveAssetsID`）。
- **第三方同步盘（网盘直同步 data 目录）官方不支持**，"否则数据可能损坏"——因为真源是 AST+索引而非文件。
- 超级块（`{{{row/col}}}` 布局容器）、数据库块（AttributeView 指向外部 `.json`）、表格合并单元格（IAL `colspan/rowspan`）、行内样式等在 Markdown 中无对应语法，导出时线性化或降级（导出流程还会专门剥离超级块的 IAL 节点，见 export.go 注释引用 issue #13451）。

---

## 4. AFFiNE / BlockSuite：CRDT 块树，Markdown 仅是转换格式

来源：[BlockSuite Store 指南](https://docs.affine.pro/blocksuite-wip/store/)、[Block Schema](https://blocksuite.io/guide/block-schema)、[blocksuite/store](https://blocksuite.io/guide/store)、[toeverything/blocksuite](https://github.com/toeverything/blocksuite)、[AFFiNE Workspaces 文档](https://docs.affine.pro/core-concepts/elements-of-affine/workspaces)、[AFFiNE PR #2037（本地 SQLite）](https://github.com/toeverything/AFFiNE/pull/2037)、[local.ts 存储引擎源码](https://github.com/toeverything/AFFiNE/blob/master/packages/frontend/core/src/modules/workspace-engine/impls/local.ts)。

### 4.1 块存储模型

- 文档（`Doc`）= Yjs subdocument 中的块树；块是 Y.Map 条目，键采用命名空间前缀：`sys:id`、`sys:flavour`、`sys:children`（子块 ID 有序列表）+ `prop:*`（业务属性），文本用 `internal.Text()`（Y.Text 的 Delta 数组）。官方文档给出的伪代码即此结构。
- flavour 即块类型（`affine:page` / `affine:note` / `affine:paragraph` / `affine:surface` 等，`namespace:type` 命名）；`defineBlockSchema` 声明 props 与 metadata（`version`、`role: root/hub/content`），可用 glob 规则约束父子关系。
- 容器语义：root 唯一、hub 可多子、content 只能被一个父持有且只能有 content 子——比 Notion 白名单更系统化的结构校验。

### 4.2 持久化与互操作

- 本地优先：Yjs update 增量 + blob 存储；桌面端每 workspace 一个 SQLite `storage.db`（PR #2037 起逐步统一到 `@affine/nbstore/sqlite` 家族：SqliteDocStorage/SqliteBlobStorage 等）。**磁盘上没有任何用户可读的 Markdown 源文件**。
- Markdown 只在导入/导出边界做块树转换（有损）：布局（edgeless 画布、多列）、块级颜色等 CRDT 属性无 Markdown 对应物。
- 对 NexNote 的含义：AFFiNE 是"私有二进制真源"路线的极端代表——块模型与协作能力最强，文件互操作性（git diff、第三方编辑器、Obsidian 生态）为零，与本项目的立场相反。

---

## 5. Logseq：Markdown 大纲化持久化（每块一行）

来源：[Properties（官方文档图谱页面）](https://github.com/logseq/docs/blob/master/pages/Properties.md)、[Block Reference](https://github.com/logseq/docs/blob/master/pages/Block%20Reference.md)、[用既有 Markdown 建图](https://github.com/logseq/docs/blob/master/pages/How%20to%20create%20a%20Logseq%20graph%20using%20existing%20Markdown%20files.md)、[首选文件格式](https://github.com/logseq/docs/blob/master/pages/setting___preferred%20file%20format.md)、[graph-parser property.cljs](https://github.com/logseq/logseq/blob/master/deps/graph-parser/src/logseq/graph_parser/property.cljs)。

### 5.1 持久化方式

- 文件图：Markdown 或 org-mode（可切换），页面文件分 `journals/`（每日一文件）、`pages/`、`assets/`；可指向既有 Markdown 目录（甚至与 Obsidian 共用，文档专门介绍了共存设置）。
- **大纲式块模型**：每个块 = 一行 bullet（`-`），嵌套靠缩进（tab）；页面即块的树。非大纲内容（独立标题、段落）会被规范化进 bullet 结构。
- 页面属性 = 页面第一个块的属性行（Logseq 语境的 "frontmatter"，但**不是 YAML**，而是 `key:: value` 行）；org 模式用 `:key:` 语法（源码：markdown 分隔符 `"::"`，org 为 `:property:`）。

### 5.2 块 ID 与引用（行内属性行式的代表）

- 块 ID 是内建属性：`id:: <uuid>`，属性行**必须紧贴所属块内容行**（连续出现才归属正确窗口）；
- 块引用：`((uuid))`；页面引用 `[[page]]`；嵌入 `{{embed ((uuid))}}` / `{{embed [[page]]}}`；带标签引用 `[label]([[page]])` / `[label](((uuid)))`；
- 属性名规则：字母数字 + `. * + ! - _ ? $ % & = < >`，大小写不敏感统一小写，`_` 自动改 `-`；属性值以换行分隔，**不能含换行**；加引号可阻止值内链接解析。
- 局限（对映射边界的关键启示）：一行一块意味着**多行块、列表项内复杂嵌套、表格区块混合**都要靠转义或降级表达；表格/代码块等非大纲结构在大纲模型中是"二等公民"。新版 Logseq 另有 SQLite DB 图（文件/DB 双轨），文件属性能力有限、DB 版属性带类型校验，说明纯文件属性表达确有天花板。

---

## 6. 横向对照：块类型 × 纯 Markdown 表达能力

| 块/能力 | 纯 Markdown（CM+GFM） | Obsidian 方言内 | 先例做法 | 结论 |
|---|---|---|---|---|
| 段落 / 行内样式 | ✅ | ✅ | 全部支持 | 无损 |
| 标题（ATX） | ✅ | ✅ | 全部支持 | 无损（Setext 被 SiYuan 禁用，统一 ATX） |
| 列表 / 任务列表 / 嵌套列表 | ✅ | ✅ | 全部支持 | 无损 |
| 围栏代码块 + 语言 | ✅ | ✅ | 全部支持 | 无损（缩进式代码块避免使用） |
| GFM 表格 | ✅（无合并/列宽/caption） | ✅ | SiYuan 把 colspan/rowspan/colgroup/caption 存 IAL | 无损边界=纯网格；合并/样式=私有 sidecar（IAL） |
| 图片 | ✅ | ✅ + `![[x|宽]]` 尺寸 | Notion/AFFiNE 走 blob/URL | 无损；尺寸控制是方言 |
| 音频/视频/PDF | ❌（HTML 标签） | ✅ `![[a.mp3]]` 嵌入 | SiYuan 存 `<video>` 等 HTML 块 | 降级为 HTML/嵌入方言 |
| Callout / 提示块 | ❌（仅 blockquote） | `> [!note]` 方言 | Notion callout=块属性；SiYuan=GFM Alert 五型+自定义 | 跨工具降级为 blockquote |
| 高亮 / 上下标 / 下划线 / 单波浪 | ❌ | `==` 方言 | SiYuan 用 TextMark 体系 | 方言或私有 AST |
| 数学 | ⚠️（无标准，惯例 `$$`） | ✅ LaTeX | Notion equation=rich text 对象 | 惯例事实标准 |
| 块引用 / 块嵌入 | ❌ | `[[note#^id]]` 私有 | SiYuan `((id))`+导出三模式；Logseq `((uuid))` | 必然方言；导出降级=锚文本/链接/脚注 |
| 任意嵌套容器（列表项内放任意块、列布局） | ❌ | ❌ | SiYuan NodeList/SuperBlock、Notion column/tab、AFFiNE hub | 私有结构，导出线性化 |
| 合并单元格 / 列宽 / 表标题 | ❌ | ❌ | SiYuan IAL | 降级丢弃 |
| 块级颜色/样式/折叠/别名/书签 | ❌ | ❌ | Notion color 枚举；SiYuan IAL；Logseq `collapsed::` | 降级丢弃或 sidecar |
| 数据库/属性视图块 | ❌ | `.base`/插件 | SiYuan AttributeView（外部 JSON）；Notion child_database；AFFiNE database 块 | 降级为 GFM 表格快照 |
| 画布/白板 | ❌ | `.canvas`（独立 JSON 文件） | AFFiNE edgeless | 独立文件类型 |

## 7. 块 ID 内嵌写法对照（票据焦点问题）

| 先例 | 内嵌方式 | 语法 | 字符集/形态 | 引用写法 | Markdown 标准内合法性 |
|---|---|---|---|---|---|
| Obsidian | **链接锚点式** | 段尾 ` ^id`；结构块独立行；列表项挂 bullet 行 | `[a-zA-Z0-9-]`，自动生成 6 位样式 | `[[note#^id]]`、嵌入 `![[note#^id]]` | 非标准（官方自认，外部不工作） |
| SiYuan | **IAL 属性式**（源格式为 JSON AST） | kramdown `{: id="..." updated="..."}` | 22 位时间戳+随机 | `((id "锚文本"))`、嵌入 `{{select...}}` | 非标准（kramdown 方言） |
| Logseq | **行内属性行式** | `id:: <uuid>` 紧跟块行 | UUID | `((uuid))`、`{{embed ((uuid))}}` | 非标准（但落盘仍是普通 bullet 行） |
| Notion | 不落文件 | API JSON `id` | UUIDv4 | API 引用 | 不适用 |
| AFFiNE | 不落文本 | Yjs Y.Map `sys:id` | 块 ID | CRDT 引用 | 不适用 |
| HTML 注释 / data 属性 | **无主要先例** | — | — | — | （合法但被行业弃用：渲染不可见、易被工具剥除、diff 噪声大） |

**结论**：行业收敛在三种文件内嵌形态——①链接锚点式（Obsidian，兼容目标生态的最佳选择）；②行内属性行式（Logseq，大纲模型专用）；③IAL 式（SiYuan，配合私有 AST 真源）。HTML 注释与 data 属性没有先例；若 NexNote 需要 Markdown 表达不了的块级扩展数据，正确姿势是 sidecar（frontmatter 页面级 + 可重建索引），而非发明文件内嵌语法。

---

## 8. 来源清单

- Obsidian（官方帮助文档仓库 obsidianmd/obsidian-help）：[How Obsidian stores data](https://github.com/obsidianmd/obsidian-help/blob/master/en/Files%20and%20folders/How%20Obsidian%20stores%20data.md) · [Configuration folder](https://github.com/obsidianmd/obsidian-help/blob/master/en/Files%20and%20folders/Configuration%20folder.md) · [Accepted file formats](https://github.com/obsidianmd/obsidian-help/blob/master/en/Files%20and%20folders/Accepted%20file%20formats.md) · [Properties](https://github.com/obsidianmd/obsidian-help/blob/master/en/Editing%20and%20formatting/Properties.md) · [Internal links](https://github.com/obsidianmd/obsidian-help/blob/master/en/Linking%20notes%20and%20files/Internal%20links.md) · [Embed files](https://github.com/obsidianmd/obsidian-help/blob/master/en/Linking%20notes%20and%20files/Embed%20files.md) · [Obsidian Flavored Markdown](https://github.com/obsidianmd/obsidian-help/blob/master/en/Editing%20and%20formatting/Obsidian%20Flavored%20Markdown.md)
- Notion（官方 API 文档）：[Block object](https://developers.notion.com/reference/block) · [Working with page content](https://developers.notion.com/guides/data-apis/working-with-page-content)
- SiYuan（官方仓库）：[docs/SY-FORMAT.md](https://github.com/siyuan-note/siyuan/blob/master/docs/SY-FORMAT.md) · [docs/WORKSPACE.md](https://github.com/siyuan-note/siyuan/blob/master/docs/WORKSPACE.md) · [README FAQ](https://github.com/siyuan-note/siyuan/blob/master/README.md#faq) · [kernel/model/export.go](https://github.com/siyuan-note/siyuan/blob/master/kernel/model/export.go) · [kernel/conf/export.go](https://github.com/siyuan-note/siyuan/blob/master/kernel/conf/export.go)
- AFFiNE / BlockSuite（官方）：[Store guide](https://docs.affine.pro/blocksuite-wip/store/) · [Block schema](https://blocksuite.io/guide/block-schema) · [blocksuite/store](https://blocksuite.io/guide/store) · [toeverything/blocksuite](https://github.com/toeverything/blocksuite) · [Workspaces 概念](https://docs.affine.pro/core-concepts/elements-of-affine/workspaces) · [PR #2037 本地 SQLite](https://github.com/toeverything/AFFiNE/pull/2037) · [workspace-engine/local.ts](https://github.com/toeverything/AFFiNE/blob/master/packages/frontend/core/src/modules/workspace-engine/impls/local.ts)
- Logseq（官方文档图谱与源码）：[Properties](https://github.com/logseq/docs/blob/master/pages/Properties.md) · [Block Reference](https://github.com/logseq/docs/blob/master/pages/Block%20Reference.md) · [How to create a graph using existing Markdown files](https://github.com/logseq/docs/blob/master/pages/How%20to%20create%20a%20Logseq%20graph%20using%20existing%20Markdown%20files.md) · [Preferred file format](https://github.com/logseq/docs/blob/master/pages/setting___preferred%20file%20format.md) · [graph-parser/property.cljs](https://github.com/logseq/logseq/blob/master/deps/graph-parser/src/logseq/graph_parser/property.cljs)
