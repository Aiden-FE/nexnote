# NexNote MVP 首轮对齐 · Wayfinder 地图

Label: wayfinder:map

## Destination

完成 NexNote 首轮对齐并切好开发票据：产品架构与技术架构定稿；2~3 个**整案原型**（产品形态 + UI 交互 + 技术栈组合的可点击 HTML 原型）经用户评审确认，仅保留唯一认可案；认可原型与全部架构决策关联到切分好的 MVP 开发任务票据（全模块、一次性大交付）。开发执行在本地图之外进行。

## Notes

- 语言：与用户交流用简体中文，技术术语保留英文。
- Tracker：本地 markdown（本目录）。票据在 `.scratch/nexnote-mvp/issues/`；frontier = 该目录中 open、Blocked by 全部 resolved、未 claimed 的票据，编号小者先。
- 每个工作会话：先读本地图；默认双开 grilling + domain-modeling 技能；prototype 票加开 prototype + web-design-engineer；research 票用 research skill。
- 基线约束（绘图两轮对齐固化，作为全部票据的硬输入）：
  - MVP 范围 = 五大模块全量（全模块进 MVP），**一次性大交付**（无里程碑门）。
  - 人力 = 单人 + AI 结对 → 低维护面是选型硬过滤器（不作为原型评审维度）。
  - 发布意图 = 对外产品标准（安装包、自动更新、插件 API 稳定性），节奏先自用打磨。
  - 存储立场 = Markdown + YAML frontmatter，块结构以约定内嵌 + 结构化 sidecar/索引，目标 Obsidian vault 可互操作。
  - 原型评审权重 = 编辑器体验 > 知识组织 > AI 融合深度。
- 研究发现物统一落 `docs/research/<topic>.md`，票据 Answer 只放 gist + 链接。
- 研究票 01–06 由并行子代理解析：共享同一工作树，子代理禁止任何 git 写操作、禁止改 map.md；Decisions-so-far 索引行由收集会话（收到完成通知后的会话）补挂。
- 架构决策收口时（08/09/10/14 号票）按 ADR 三条件酌情落 `docs/adr/`，决策本体仍以各票为准。

## Decisions so far

- [01 · 桌面壳与前端框架选型研究](issues/01-desktop-shell-research.md): 建议 Electron + React + TypeScript（三端渲染一致性与块编辑器生态最稳）；备选 Tauri 2 / Vue 3；最大风险 = Tauri 的 Linux IME 与 WKWebView 拖拽。报告 docs/research/desktop-shell.md。
- [02 · 块编辑器内核选型研究](issues/02-editor-kernel-research.md): 建议 **TipTap 3 + @tiptap/markdown + UniqueID + DragHandle + Suggestion**（全部 MIT，MD 双向管道官方挂点完整，能落 Obsidian `^id` 铬点）；Milkdown 第一备选；BlockNote 仅用于 11 号原型票验证块 UX。报告 docs/research/editor-kernel.md。
- [03 · Git 集成与文档历史研究](issues/03-git-integration-research.md): 主路线 simple-git（spawn 系统 git）+ 探测/捆绑 dugite-native 回退；回滚 MVP = 文件级 + hunk 级；置信度走全量历史索引 + 增量。报告 docs/research/git-integration.md。
- [04 · 竞品块模型与存储格式研究](issues/04-competitor-arch-research.md): 无损边界 = CommonMark+GFM+LaTeX；块 ID 采用 Obsidian `^id` 锚点语法；嵌套容器/合并单元格必降级、块样式必丢弃；Link Index 做可从 vault 全量重建的派生缓存。报告 docs/research/competitor-arch.md。
- [05 · AI 集成与本地向量检索研究](issues/05-ai-vector-research.md): 自有 Provider Adapter + 主进程持钥 + sqlite-vec 派生索引 + 三阶段渐进召回（非 GraphRAG）；LanceDB / GraphRAG 为后续备选。报告 docs/research/ai-vector.md。
- [06 · 插件系统机制研究](issues/06-plugin-system-research.md): sandbox iframe UI + capability RPC + 宿主预注册 plugin_block；V1 增 QuickJS/WASM logic worker；Node 子进程仅限 desktop-privileged。报告 docs/research/plugin-system.md。
- [07 · 产品架构对齐](issues/07-product-architecture.md): 产品架构定稿——页面=md+子文件夹嵌套、文件名默认=标题可解耦；多 tab+分屏+右侧 AI 对话 dock+状态栏；回链侧栏面板、元数据表格↔YAML 双模式、双轨标签；置信度仅属性面板呈现+召回权重后端挂钩；AI 三入口（选区工具栏/斜杠/右键）+ diff 预览回写；图谱全局+局部均进 MVP；Git 状态栏+时间线+pull/push 快捷；Skill/插件设置页管理+召回透明+权限确认；首启动向导三选一。

## Not yet specified

- 置信度算法细则：公式、因子权重、与 AI 召回权重的具体挂钩方式（**UI 呈现已定：仅文档属性面板**）——等 Git 底座与 AI 架构落定后再立票。
- 冲突处理与导入策略细则：远程同步冲突提示 UX、本地文件夹批量导入、特定知识导入——等技术架构定。
- 图谱视图选型与交互细节——等技术架构与认可原型定。
- 块 ↔ Markdown 双向映射的具体约定（哪些块类型无损、哪些降级）——等编辑器内核选型与竞品研究落定。
- 打包 / 自动更新 / 捆绑 git 回退的实施细节——等桌面壳选型定。
- 插件本地安装格式与安全基线（manifest、签名）——等插件架构对齐后细化。
- Skill 渐进召回三阶段管道的工程细则——等 AI 架构与向量研究落定。

## Out of scope

- Web 版与移动端（需求声明"未来可扩展"，届时另立新图）。
- 多人实时协同编辑（块模型选型时仅作兼容性考量，功能本身不做）。
- 云端服务与插件市场（NexNote 不强制联网；插件仅本地安装分发）。
- 非 OpenAI 协议的模型服务适配（一期只做 OpenAI 协议适配器，架构预留扩展点）。
