# 块编辑器内核选型调研（TipTap/ProseMirror · Lexical · Slate · BlockNote · Milkdown/Remirror 简评）

- 票据：[.scratch/nexnote-mvp/issues/02-editor-kernel-research.md](../../.scratch/nexnote-mvp/issues/02-editor-kernel-research.md)
- 调研日期：2026-09-05 · 方法：一手来源优先（官方文档 / GitHub 仓库与源码 / npm registry / 官方 issue tracker），版本号与星数为当日实测快照。
- 输入：桌面壳票结论 = Electron + React + TypeScript（[docs/research/desktop-shell.md](./desktop-shell.md)，建议「编辑器内核独立成框架无关包，保留 ProseMirror/TipTap core 层」）；块 ID 内嵌行业先例见 [docs/research/competitor-arch.md](./competitor-arch.md)（下称 04 号票）。
- 硬约束回顾：**源文件 = MD + YAML frontmatter**；块结构用内嵌约定（04 号票已定 Obsidian 兼容 `^id` 锚点）+ sidecar 索引可重建；插件可扩展**自定义块类型**；目标兼容 Obsidian vault。

---

## TL;DR

- **建议排序：TipTap 3（主选）＞ BlockNote（原型加速器/备选）＞ Milkdown（markdown-first 备选）＞ Lexical ＞ Slate（+Plate 注记）＞ Remirror（不推荐）**。
- 决定性理由一句话版：**TipTap 3 是唯一同时满足「官方 MIT Markdown 序列化包 + 每扩展可注册自定义 Markdown 语法 hook + UniqueID/DragHandle 已完全开源 + PM 基座可换壳留缝」的候选**；而「MD 为源文件」这条硬约束直接淘汰了所有把 JSON 当权威格式的候选（BlockNote、Lexical、Slate 的默认路线）。
- 块 ID 保留策略：没有任何候选原生把块 ID 序列化进 Markdown（行业先例见 04 号票：Obsidian `^id` / SiYuan IAL / Logseq `id::` 全是自造语法）。可行路径 = **TipTap `UniqueID` 扩展（存 node attribute）+ `@tiptap/markdown` 的 `renderMarkdown`/`parseMarkdown` hook 输出/读回 `^id`**，与 Obsidian 锚点语法对齐。
- BlockNote 的块 UX（拖拽/slash/嵌套）开箱即用最完整，但 0.54 官方文档明确 Markdown 导入导出均为 lossy、权威格式是 JSON，且自定义块无公开的 per-block Markdown 序列化 hook → 与 MD-first 约束正面冲突；建议仅用于 11 号原型票快速验证交互，不作正式内核。
- 2026 年关键变化（较旧资料）：① Tiptap 3 已稳定（当前 3.31.x）且**开源了 DragHandle、UniqueID 等 Pro 扩展**；② Tiptap 新增官方 `@tiptap/markdown`（MIT，MarkedJS 基座）；③ Lexical 新增实验性 `@lexical/mdast`（micromark 基座、语法保真）；④ **ProseMirror 仓库已迁出 GitHub**（作者自托管 Gitea，GitHub 仓库归档为镜像，npm 正常发版）；⑤ BlockNote 转向「core MPL-2.0 + XL 功能双许可（GPL-3.0 / 商业 $195/mo）」。

---

## 1. 对比矩阵

| 维度 | TipTap 3（PM 基座） | BlockNote（TipTap/PM 基座） | Milkdown（PM+remark） | Lexical | Slate | Remirror（PM 基座） |
|---|---|---|---|---|---|---|
| 当前版本（2026-09-05） | 3.31.3（npm 当日发版） | 0.54.0（2026-08-13） | 7.22.1（2026-08-12） | 0.50.0（2026-09-02） | 0.126.2（2026-08-08） | 3.0.3（**2025-08-02，13 个月未发版**） |
| GitHub stars | 38.3k | 10.2k | 11.9k | 23.8k | 31.8k | 3.0k |
| 块模型 | PM schema：任意嵌套 node + attrs；块=块级 node，模型自由度高 | 原生 Notion 式两层「块+块内容」，子块限于列表/容器类 | PM schema（同 TipTap） | Element 树（JSON），自定义嵌套 | 不可变 JSON 树，任意嵌套 | PM schema（同 TipTap） |
| 嵌套块/块拖拽/块菜单 | 拖拽：DragHandle 扩展（已开源）；slash：Suggestion 工具+示例，需自组 | **全部开箱即用**（drag handle、slash menu、侧边菜单、键盘嵌套），core 免费 | plugin-block 提供块手柄（拖拽+drop 回调）；Crepe 附 slash/工具栏；块 UX 总体最薄 | 无核心块 UI：DraggableBlockPlugin、TypeaheadMenu 属示例/`@lexical/react` 组件，需拼装 | 无任何内置；Plate（Slate 系）补齐整套块 UI | 无内置块 UI |
| 自定义块扩展机制 | `Node.create`（schema+parseHTML+renderHTML+NodeView）；插件生态最大；React NodeView 官方 | `createReactBlockSpec` + PropSchema + 自定义 slash item，心智负担最低 | `$prose`/`$node` Atom 工厂 + remark 插件，语法层可同时扩展 | `DecoratorNode`/自定义 Node + 扩展系统；React 绑定官方 | 自定义 Element + 全自渲染（最底层、最自由、最费工） | PM 扩展的 React 封装（`useRemirror` 等） |
| **Markdown 序列化** | **官方 `@tiptap/markdown`（MIT）**：`getMarkdown()`/`contentType:'markdown'`，MarkedJS 基座，GFM 可选，**每扩展可注册 `parseMarkdown`/`renderMarkdown`/`markdownTokenizer`** | 官方明确 lossy：`blocksToMarkdownLossy`/`tryParseMarkdownToBlocks`；0.54 起为自研 Blocks→HTML→GFM 管道；**权威格式是 JSON（`editor.document`）**；自定义块无公开 md hook | **唯一以 MD 为中心的架构**：MD↔remark AST↔PM Schema↔PM Doc 双向管道，任意 remark 插件可挂 | `@lexical/markdown`（稳定，regex transformer，保真部分）；新 `@lexical/mdast`（实验性：micromark/mdast，CommonMark+GFM 规范、语法风格保真 NodeState、+26kB） | 无官方方案，社区 remark-slate 类，lossy DIY | 依赖 prosemirror-markdown 集成 |
| 块 ID 保留在 MD | **可落地**：UniqueID 扩展（attr）+ 自定义 `renderMarkdown` 输出 `^id` | 无：ID 只存 JSON，md 导出即丢 | **可落地**：自定义 node + remark 语法插件（双向） | 可行但依赖实验性 mdast 自定义语法 | 理论可行，全手写 | 同 prosemirror-markdown 路线 |
| 大文档性能 | PM 增量 view 更新；React NodeView 需 memo；社区实测数万词+decorations 会卡（需分页/虚拟化） | 实测 ~500+ 块/5 万字符输入延迟（#2595，已由 #2600 修复同类）；官方 Discussion 承认超大文档需限流 | PM 同源；无 React-per-block 负担 | 官方定位即性能（Meta 出品，评论区/帖子规模验证）；reconciler 增量 | 全量重渲染风险，需深度 memo；无官方虚拟化 | PM 同源 |
| 单人可维护性 | **高**：文档质量与生态最好；抽象层级合适，可下沉 PM；TS 优先 | 高（块层 API 简洁），但 0.x 破坏性迁移频繁；XL 依赖商业逻辑需规避 | 中：bus factor=1（作者自述靠赞助维护），UI 层要自己补的最多 | 中：0.x minor 常破坏性变更，追新成本真实 | 低：公开 beta 十年，API 层级低，全 DIY | 低：维护明显放缓 |
| License | 核心 MIT；**DragHandle/UniqueID 等已完全开源**；付费仅为云端 feature bundles | **core MPL-2.0**（闭源商用 OK，改其源文件须公开）；XL（AI/多列/PDF/DOCX 导出）GPL-3.0 或商业 $195/mo | MIT | MIT | MIT | MIT |
| 社区活跃度 | 极高（公司化，38k★，npm 月下载自称 9M） | 高（TypeCell 团队+DINUM 赞助，0.x 高频发版） | 高（月度发版，单一作者） | 极高（Meta 背书，高频发版） | 中（patch 级维护，核心演进缓慢） | 低 |
| 与 NexNote 约束匹配 | ★★★★★ | ★★☆（UX 满分、存储约束冲突） | ★★★★（存储满分、UX/维护扣分） | ★★★ | ★★ | ★ |

---

## 2. 深评四个主力

### 2.1 TipTap / ProseMirror —— 主选

**是什么**：ProseMirror 是 schema 驱动的 contenteditable 编辑器内核（node/mark/attrs、插件、增量 view 更新）；TipTap 是其无头框架层（扩展系统 + React/Vue 绑定 + 文档），v3 当前 3.31.x、MIT、公司化运营。证据：[tiptap.dev](https://tiptap.dev)、[prosemirror.net](https://prosemirror.net)、npm `@tiptap/core` 3.31.3（2026-09-04 发版）。

**块模型与块 UX**：块 = schema 里的块级 node，嵌套任意（列表、容器 node 自定义）；拖拽用官方 DragHandle 扩展；slash 菜单用官方 Suggestion 工具 + 官方示例组装。2026 年的关键变化：**Tiptap 把一批 Pro 扩展完全开源（MIT，「no account needed, no restrictions」），包括 DragHandle、UniqueID、FileHandler、Mathematics、Details 等**，付费业务转向云端 feature bundles（Content AI / Collaboration / Conversion / Documents）。来源：[We're open-sourcing more of Tiptap](https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap)、npm `@tiptap/extension-drag-handle`（MIT，3.31.3）。

**自定义块扩展**：`Node.create` 定义 schema + parseHTML/renderHTML + React NodeView；一个自定义块 = 一个可独立发布的 npm 包，与 NexNote「插件可扩展自定义块类型」约束天然同构。Tiptap 3 增加无 DOM 服务端操作与 JSX 渲染配置，便于预览/索引进程复用。来源：[What's new in Tiptap V3](https://tiptap.dev/docs/resources/whats-new)。

**Markdown 序列化（本票核心）**：官方包 `@tiptap/markdown`（MIT）：
- `editor.getMarkdown()` / `setContent(md, {contentType:'markdown'})` / `editor.markdown.parse|serialize`；
- 底层是 **MarkedJS**（非 CommonMark 严格实现，边缘保真需自测），GFM 表格/任务列表经 `markedOptions:{gfm:true}` 开启；
- 内嵌 HTML 走各扩展 `parseHTML` 规则；
- **每个扩展可注册 `parseMarkdown` / `renderMarkdown` / `markdownTokenizer`** —— 这正是实现 Obsidian `^id` 锚点、callout、wikilink 等私有方言的官方挂点。
来源：[Markdown Basic Usage](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage)、[MarkdownManager API](https://tiptap.dev/docs/editor/markdown/api/markdown-manager)。

**块 ID 策略（建议方案）**：`UniqueID` 扩展把 id 存为 node attribute（默认 UUIDv4，可自定义生成器与类型白名单，官方声明 split/merge/undo/paste 全程跟踪），配合自定义 `renderMarkdown` 把段落行尾写成 `^id`、`parseMarkdown` 读回 attr——即「内存里是 attr，落盘是 Obsidian 锚点」，与 04 号票结论无缝衔接。来源：[UniqueID 文档](https://tiptap.dev/docs/editor/extensions/functionality/uniqueid)、[开源公告](https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap)。

**风险与缓解**：
- 公司 open-core 转型：核心、DragHandle、UniqueID、Markdown 均已 MIT 且为独立 npm 包，锁定小版本即可免疫商业层变化；底层可随时降级为裸 ProseMirror（01 号票建议的换壳留缝）。
- MarkedJS 方言偏差：以「读入 Obsidian vault → getMarkdown → diff」的 round-trip 测试作为验收（04 号票已定内容层无损边界）。
- ProseMirror 本体已迁出 GitHub：2026-04 起 Marijn Haverbeke 把全部 PM 仓库迁到自托管 Gitea（code.haverbeke.berlin），GitHub 仓库归档为只读镜像，但 npm 持续发版（prosemirror-view 1.42.3 / prosemirror-markdown 1.13.7，2026-08）。这是「作者单点」的事实提醒，但 PM 已稳定十年、变更缓慢，风险可控。来源：[prosemirror-view README 迁移公告](https://github.com/ProseMirror/prosemirror-view)、npm registry。

### 2.2 BlockNote —— 原型加速器 / 备选

**是什么**：Notion 式块编辑器，构建于 TipTap/ProseMirror 之上（0.54 类型源码直接 import `@tiptap/core`），React-only。当前 0.54.0，10.2k★，TypeCell 团队维护，DINUM（法国数字事务局）赞助了 0.54 的 math/diagram 块。证据：[GitHub](https://github.com/TypeCellOS/BlockNote)、[v0.54.0 Release](https://github.com/TypeCellOS/BlockNote/releases/tag/v0.54.0)。

**优势**：块 UX 完整度断层第一——drag handle、slash menu、侧边菜单、嵌套拖拽、multi-column（XL）、collab（Yjs，免费）全部内置；自定义块 `createReactBlockSpec` 十分钟上手；服务端可 `@blocknote/server-util` 处理文档。来源：[Custom Blocks](https://www.blocknotejs.org/docs/features/custom-schemas/custom-blocks)、[Format Interoperability](https://www.blocknotejs.org/docs/foundations/supported-formats)。

**与本票硬约束的冲突（决定性）**：
1. 官方文档明示：Markdown 导入导出**均为 lossy**（`blocksToMarkdownLossy`），非列表子块会被解嵌套；**无损权威格式是 JSON（`editor.document`）**。0.54 起用自研「Blocks→HTML→GFM」管道替换 unified.js（源码 `htmlToMarkdown.d.ts` 自述 "Replaces the unified/rehype-remark pipeline"），自定义块无公开的 per-block Markdown 序列化 hook（0.54 类型里 markdown API 仅 `blocksToMarkdownLossy`/`tryParseMarkdownToBlocks`/`pasteMarkdown`）。块 ID 只活在 JSON/协作层，**导出 Markdown 即丢**。来源：[Markdown 导出文档](https://www.blocknotejs.org/docs/features/export/markdown)、[supported-formats](https://www.blocknotejs.org/docs/foundations/supported-formats)、`@blocknote/core@0.54.0` 类型定义（jsdelivr）。
2. **License 分层**：core MPL-2.0（闭源商用允许，修改其源文件须公开）；但 XL 包（AI、多列布局、PDF/DOCX/ODT/Email 导出）为 GPL-3.0 或商业订阅（Business $195/月）。对闭源产品，多列布局这类「块编辑器基本盘」功能落入付费区是实际约束。来源：[BlockNote Pricing](https://www.blocknotejs.org/pricing)。
3. **大文档**：实测 ~500+ 块/5 万字符即输入回声延迟（含中文 IME 场景，官方 demo 可复现），已由 #2600 修复（把全文档遍历改为按变更范围遍历）；另有 #320、用户讨论超大文档滥用限制。结论：可用但需分页策略兜底。来源：[issue #2595](https://github.com/TypeCellOS/BlockNote/issues/2595)、[PR #2600](https://github.com/TypeCellOS/BlockNote/pull/2600)、[issue #320](https://github.com/TypeCellOS/BlockNote/issues/320)。

**定位建议**：11 号原型票（block-first prototype）用 BlockNote 快速验证交互手感；正式产品若选它，等于接受「JSON 为权威、Markdown 为导出格式」的架构反转，与 NexNote 约束相反，**不建议做正式内核**。

### 2.3 Milkdown —— markdown-first 备选

**是什么**：插件驱动的 WYSIWYG **Markdown 编辑器框架**（官方定位即如此），7.22.1、MIT、11.9k★、月度发版。**架构是全候选中唯一以 MD 为中心的**：解析 = MD → remark AST → PM Schema → PM Doc，序列化严格逆向；因此「读入的语法」与「写出的语法」共享同一条 remark 管道，任意 remark/mdast 生态插件（frontmatter、directives、footnote、GFM…）都能同时挂上解析与序列化。自定义块 = 自定义 node spec + remark 语法插件双向注册，`^id`、callout 这类私有方言的实现路径与 TipTap 等价但更「正」。来源：[Architecture Overview](https://milkdown.dev/docs/guide/architecture-overview)（GitHub: Milkdown/website/docs/guide）、[Why Milkdown](https://milkdown.dev/docs/guide/why-milkdown)。

**扣分项**：① 块 UX 最薄——`plugin-block` 只给块手柄（BlockProvider，含 drop 处理），Crepe 编辑器附 slash/工具栏，但整体成熟度与可定制性低于 BlockNote/TipTap 生态；② bus factor：作者在官方 Why 页自述「consider to fund me in order to help with the maintenance」，单人维护风险真实；③ Obsidian 兼容的先例社区（remark 插件生态）虽有，但成品编辑器采用率低于 TipTap 系。

**结论**：若把「MD 保真」权重提到最高、且接受 UI 层自建，Milkdown 是 TipTap 的正面替代；本票将其列为第一备选，并在 TipTap 方案里吸收其思路（remark 语法设计参考它实现 `^id` 的 tokenizer）。

### 2.4 Lexical —— 暂缓，观察 mdast 稳定化

**是什么**：Meta 出品的编辑器内核，定位 "reliability, accessibility, and performance"，引擎化设计（类比 React：只给核心与 reconciler）。23.8k★、0.50.0（2026-09-02）、MIT、高频发版。来源：[Introduction](https://lexical.dev/docs/intro)、[Design](https://lexical.dev/docs/design)。

**优势**：性能定位是六者中唯一「出身即验证」的（Meta 产品大规模使用）；扩展系统（0.4x+ 的 extension 化重构）与 headless 序列化（JSON 权威）工整；React 绑定官方。

**对本票的扣分**：
1. **JSON-first**：官方持久化是 editorState JSON；Markdown 靠 `@lexical/markdown`（正则 transformer，文档自认语法保真「partial」）或新的 **`@lexical/mdast`**（micromark/mdast 基座：CommonMark+GFM 规范解析、NodeState 保留 bullet/fence/ATX 等字面风格、raw HTML 透传、经 micromark 扩展支持自定义语法、代价 +26kB gzip）。方向完全正确——但官方明确标注 **experimental，任意两个版本间可破坏性变更**。来源：[markdown-mdast 文档](https://lexical.dev/docs/serialization/markdown-mdast)。
2. 块层全 DIY：DraggableBlockPlugin、TypeaheadMenu（slash）都是示例级组件，Notion 式块 UX 的工作量与 Slate 相当。
3. 0.x 高频破坏性变更（版本号即可见），单人追新成本高。

**结论**：性能上限最高的候选，但「MD 为源 + 块 UX + 稳定性」三点在 2026-09 都未就绪。设重评触发条件：`@lexical/mdast` 脱 experimental + 官方块组件成熟后重评。

### 2.5 Slate —— 不建议直接采用（附 Plate 注记）

Slate（31.8k★，0.126.2，2026-08）是最早的「框架化自定义编辑器」，模型 = 不可变 JSON 树 + 完全自渲染。但：① 仓库自述 **"Currently in public beta"** 已持续约十年，核心演进缓慢（近年以 patch 维护为主）；② 无官方 Markdown 方案、无官方块 UI，一切自建；③ 生态的最活跃部分已转移到 **Plate**（udecode/plate，16.5k★，2026-09-04 仍在推送）——基于 Slate 的全家桶编辑器（块 UI、slash、拖拽齐全）。若喜欢 Slate 路线，应直接评估 Plate 而非裸 Slate；但 Plate 把命运绑定在 beta 了十年的 Slate 内核上，与本票「单人可维护、对外产品标准」的目标错位。来源：[GitHub ianstormtaylor/slate](https://github.com/ianstormtaylor/slate)、[GitHub udecode/plate](https://github.com/udecode/plate)。

### 2.6 Milkdown / Remirror 简评（补：Remirror）

**Milkdown**：见 §2.3。一句话：**存储约束的最优解、UI 与维护的次优解**；做第一备选并在方案中吸收其 remark 双向管道设计。

**Remirror**：ProseMirror 的 React 工具箱（3.0k★，MIT），抽象质量曾公认不错，但 npm 最新版 3.0.3 发布于 2025-08-02（13 个月无发版），仓库 2026-07 后低频维护，bus factor 与活跃度双红灯。TipTap 3 已覆盖其全部定位且更活跃，**不建议进入评估**。来源：npm registry、[GitHub](https://github.com/remirror/remirror)。

---

## 3. 块 ID 在 Markdown 中的保留：先例 × 内核能力对照

行业先例（04 号票已详证，此处只引结论）：**没有任何主流产品用标准 Markdown 表达块 ID**——Obsidian 用行尾 `^id` 锚点、SiYuan 用 kramdown IAL、Logseq 用 `id::` 属性行；Notion/AFFiNE 根本不落 Markdown。因此「块 ID 保留」考核的不是候选有没有现成功能，而是**自定义语法的序列化挂点是否一等公民**：

| 候选 | 挂点 | 落地 `^id` 的工作量 | 风险 |
|---|---|---|---|
| TipTap 3 | 官方 `@tiptap/markdown`：扩展级 `parseMarkdown`/`renderMarkdown`/`markdownTokenizer`；id 由 UniqueID 扩展管生命周期 | 小：一个自定义扩展 + 一段 tokenizer | MarkedJS 方言差异需 round-trip 测试 |
| Milkdown | node spec + remark 插件（解析/序列化同管道） | 小~中：一个 remark 语法插件 | 单人维护的上游 |
| Lexical | `@lexical/mdast` micromark 扩展 + Node | 中：API 实验性 | 随时破坏性变更 |
| BlockNote | **无公开 per-block md hook**（0.54 管道为 Blocks→HTML→GFM） | 大：fork 或 HTML 中转 hack | 与上游演进冲突 |
| Slate/Plate | 全手写 | 大 | 无上游支持 |

sidecar 索引方面六者均无障碍（索引在应用层，编辑器只需暴露遍历文档 API：PM `doc.descendants` / TipTap `editor.state.doc` / Lexical `editor.read` 均足够）。

---

## 4. 与 NexNote 硬约束逐条对账（TipTap 方案）

1. **MD + YAML frontmatter 存储**：`@tiptap/markdown` 的 `contentType:'markdown'` + 自定义 Frontmatter node（tokenizer 读 `---` 块、renderMarkdown 原样写回，属性值不重排——04 号票要求 YAML 不被重写，须自管而非交给 MarkedJS）。
2. **块结构内嵌约定（`^id`）+ sidecar 索引**：UniqueID（attr，生成器改为 Obsidian 字符集 `[a-zA-Z0-9-]` 短 id）+ `^id` 序列化 hook；sidecar 索引从落盘 MD 重建（编辑器无关）。
3. **插件可扩展自定义块类型**：自定义块 = TipTap 扩展包（Node + NodeView + Markdown hooks），与 06 号插件系统票的插件模型直接对齐；Milkdown 同理，BlockNote 需要绕过 md 缺口。
4. **Obsidian 兼容**：内容层按 04 号票的「CommonMark + GFM + LaTeX + 私有扩展」方言清单逐条实现 tokenizer；参考 Milkdown 的 remark 插件写法处理 `^id`/callout/wikilink 语法细节。
5. **Electron + React + TS（01 号票）**：TipTap 官方 React 绑定 + 全 TS；内核逻辑放框架无关的 core 层（01 号票已建议）。

## 5. 建议排序与决策

| 排序 | 候选 | 定位 | 触发重评的条件 |
|---|---|---|---|
| 1 | **TipTap 3 + @tiptap/markdown + UniqueID + DragHandle + Suggestion** | 正式内核 | MarkedJS round-trip 测试失败且不可修 → 切 Milkdown |
| 2 | **Milkdown** | 第一备选（MD 保真上限最高） | 块 UX 自建成本超预算 |
| 3 | **BlockNote** | 仅用于 11 号原型票验证块交互；不作正式内核 | 若产品决策反转接受「JSON 权威 + MD 导出」架构 |
| 4 | Lexical | 观察 | `@lexical/mdast` 转 stable 且出现官方块组件 |
| 5 | Slate/Plate | 不采用 | — |
| 6 | Remirror | 不采用 | — |

**给架构票（07/08 号）的直接输入**：内核选 TipTap 3，编辑器包分层 = 无框架 core（schema/markdown/索引钩子）+ React UI 层（NodeView/DragHandle/slash）；`^id` 与 frontmatter 序列化做成独立扩展，round-trip 测试进 CI。

## 6. 风险清单

- Tiptap 商业层进一步收缩开源范围 → 已开源包锁版本 + 保留降级裸 PM 的能力（PM 稳定十年，迁移面小）。
- ProseMirror 单作者 + 仓库离 GitHub → npm 锁定 + vendor 缓存；PM 变更缓慢，实际风险低。
- MarkedJS 与 CommonMark/GFM 的边缘差异（表格转义、列表松紧、frontmatter）→ 建「Obsidian 语法样本库」round-trip 回归测试。
- 大文档（PM 全 DOM 渲染）→ 沿用 Obsidian 式「单文件控制篇幅 + 虚拟滚动/分页」策略，NodeView memo 化；预研 react-prosemirror 的性能实践（[handlewithcare.dev 文章](https://handlewithcare.dev/blog/making_react_prosemirror_really_really_fast/)）。
- 中文 IME：PM 系（TipTap/BlockNote/Milkdown）在 Chromium 上 composition 处理成熟，与 01 号票「Electron 统一 Chromium」结论互相强化；验收测试必须含 fcitx/ibus/macOS 中文输入。

---

## 附：数据快照（2026-09-05，npm registry + GitHub API 实测）

| 包 | 最新版 | 发布日期 | License |
|---|---|---|---|
| @tiptap/core | 3.31.3 | 2026-09-04 | MIT |
| @tiptap/markdown | 3.31.3 | 2026-09-04 | MIT |
| @tiptap/extension-drag-handle | 3.31.3 | 2026-09-04 | MIT |
| @tiptap/extension-unique-id | 3.31.3 | 2026-09-04 | MIT（周下载 ~194k） |
| prosemirror-view | 1.42.3 | 2026-08-24 | MIT（仓库已迁 code.haverbeke.berlin） |
| prosemirror-markdown | 1.13.7 | 2026-08-31 | MIT（CommonMark，无内置表格，见 [issue #84](https://github.com/ProseMirror/prosemirror-markdown/issues/84)） |
| @blocknote/core | 0.54.0 | 2026-08-13 | MPL-2.0（XL 包 GPL-3.0/商业双许可） |
| milkdown (@milkdown/kit) | 7.22.1 | 2026-08-12 | MIT |
| lexical | 0.50.0 | 2026-09-02 | MIT |
| slate | 0.126.2 | 2026-08-08 | MIT（"Currently in public beta"） |
| remirror | 3.0.3 | 2025-08-02 | MIT |
