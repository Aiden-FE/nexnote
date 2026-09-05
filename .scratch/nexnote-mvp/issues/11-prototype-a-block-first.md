# 11 · 整案原型 A（默认推荐案）：块编辑优先工作台

Type: prototype
Status: resolved
Blocked by: 07, 08

## Answer

v0 已完成；**2025-09-05 用户在 14 号票评审中无修改意见直接采纳**，本票随之收口。

- 认可案产物（canonical）：[`docs/research/prototypes/a-block-first.html`](../../docs/research/prototypes/a-block-first.html)
- 启动：`cd .scratch/nexnote-mvp/prototypes && python3 -m http.server 8734`，打开 `http://localhost:8734/prototype-a-block-first.html`
- 设计方向：Notion pre-AI 暖系、块编辑器为主角；编辑器体验 > 知识组织 > AI 融合。
- 已覆盖交互：块手柄/块菜单、斜杠菜单、选区 AI 工具栏与 diff、双链/回链/标签、frontmatter 表格↔YAML、Git 状态/时间线/置信度、AI 对话 dock/渐进式召回/参考来源/Skill 开关、局部图谱、⌘K 命令面板。
- 技术栈标注：Electron + React + TS + TailwindCSS/shadcn/ui + TipTap 3 + SQLite + simple-git（默认捆绑 Git）。取舍：以 Electron 体积换三端编辑一致性，以自建 TipTap 交互层换 Markdown/Obsidian 方言可控性。

## Question

制作整案原型 A：**Notion 式块编辑优先工作台**方向（默认推荐案的差异化定位）。

- 输入：07 号票的信息架构 + 08 号票推荐的默认技术栈组合。
- 产出：可点击 HTML 高保真原型（用 prototype + web-design-engineer 技能），覆盖：块编辑器主界面（块菜单 / 拖拽 / 嵌套 / 斜杠命令）、双链与回链面板、frontmatter 元数据编辑、Git 状态 / 历史回溯 / 置信度展示、AI 写作辅助入口与对话面板、Skill 召回示意。
- 侧重视角：评审权重第一位「编辑器体验」，其次知识组织、AI 融合。
- 原型内注明绑定的技术栈组合与该组合的取舍一句话。

产物链接挂在本票 Answer 内（未认可案在 14 号票评审后归档）。
