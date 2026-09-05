# 08 · 技术架构收敛：圈定整案组合

Type: grilling
Status: resolved
Blocked by: 01, 02, 03, 04

## Question

基于研究票 01–04 的发现物（docs/research/ 下 desktop-shell / editor-kernel / git-integration / competitor-arch 四份报告），与用户收敛技术架构：

1. 圈定 **2~3 个可行的整案技术栈组合**：桌面壳 + 前端框架 + 编辑器内核 + 块↔Markdown 映射约定 + Git 绑定路线 + 关系索引引擎。
2. 明确每个组合的取舍（低维护面过滤器、对外产品标准、Obsidian 互操作目标）与推荐序（默认推荐案排第一）。
3. 输出到整案原型票（11/12/13）：每案原型绑定一个组合。

注意：最终拍板发生在原型评审票（14）；本票产出候选组合与默认推荐，不是终局决策。

## Answer

技术架构收敛定稿（grilling 一轮 + 用户补充 TailwindCSS / shadcn/ui，2025-09-05 会话）：

### 默认技术栈组合（三案原型同绑，14 号评审时随认可案一并终局确认）

| 层 | 选型 | 依据 |
|---|---|---|
| 桌面壳 | Electron | 01 票：三端渲染一致；同赛道（Obsidian/Logseq/SiYuan/AFFiNE）全 Electron 先例 |
| 前端框架 | React + TypeScript | 01 票：块编辑器/图谱/dock 三域官方生态齐备 |
| UI 层 | TailwindCSS + shadcn/ui | 用户指定；与 React 生态匹配；shadcn 主题 CSS 变量需与 ProseMirror 样式桥接 |
| 编辑器内核 | TipTap 3 + @tiptap/markdown + UniqueID + DragHandle + Suggestion | 02 票：MD 双向官方挂点完整，可落 Obsidian `^id`；内核独立为框架无关包 |
| 存储/映射 | MD + YAML frontmatter，沿用 Obsidian 公开方言（`^id`、callout、wikilink+别名、frontmatter），不发明新内嵌语法 | 04 票 + 本票收敛 |
| 索引 | SQLite 单库：FTS5 全文 + Link Index 关系表 + sqlite-vec 向量；主进程驻留，可全量重建 | 05 票 + 本票收敛 |
| Git | simple-git + 系统 git 探测（≥2.23）+ dugite-native 捆绑回退 | 03 票 |

### 差异化主轴

11 / 12 / 13 三案**同绑默认栈**，差异只在产品形态与 UI 取向（块编辑优先 / 知识网络优先 / AI 原生驾驶舱）；原型对比聚焦体验，不做技术栈对比。

### 备选与切换条件（记录，不进原型）

- **Milkdown**：MD 保真上限最高的 markdown-first 路线。切换条件 = 开发首个里程碑的 **TipTap 3 markdown round-trip spike 验证失败**（Obsidian 方言保真）。该 spike 为强制验证项。
- **Tauri 2**：体积优势显著但 Linux IME / WKWebView 拖拽风险高、同赛道无先例；01 票否决为主选，仅保留为未来重评选项。

### 后果与备注

- Electron 体积/内存为接受代价（01 票基准 187MB 量级）。
- shadcn/ui 与 ProseMirror/TipTap 样式体系需 CSS 变量桥接（原型票呈现该细节）。
- 图谱渲染库未定（React Flow 为默认候选），认可原型后定。
- ADR：docs/adr/0001-default-tech-stack.md
