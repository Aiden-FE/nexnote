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

（尚无已关闭票据；研究票 01–06 解析中，Answer 落在各票内）

## Not yet specified

- 置信度算法细则：公式、因子权重、UI 呈现、与 AI 召回权重的挂钩方式——等 Git 底座与 AI 架构落定后再立票。
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
