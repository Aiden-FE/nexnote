# 10 · 插件与 Skill 系统架构对齐

Type: grilling
Status: resolved
Blocked by: 06, 08

## Question

基于研究票 06（docs/research/plugin-system.md）与技术架构收敛票 08 的组合，与用户对齐插件与 Skill 系统架构：

1. 插件运行时：沙箱模式选型、能力暴露分层（UI 层 / 编辑器块类型层 / 数据层 / 系统层）、与所选编辑器内核扩展点的耦合方式。
2. 插件 API 面：扩展块类型、视图、菜单、命令四类扩展点的 API 形态与稳定性承诺（对外产品标准）。
3. Skill 与插件的关系：检索 Skill 是否建模为「一类受约束的插件」（推荐方向）还是独立体系；启用 / 禁用、多 Skill 组合、召回策略注册机制。
4. 本地安装格式与安全基线（manifest、版本、签名）的最小方案。

产出：插件 & Skill 架构决策（ticket 内 Answer），可酌情落 ADR。

## Answer

插件与 Skill 系统架构定稿（grilling 一轮，均采纳推荐案；依据 06 号票研究 + 08/09 号票）：

### 1. Skill 与插件的关系
- 检索 Skill = **一类受约束的插件**：同一运行时（sandbox iframe / QuickJS logic worker）、同一安装/权限面（manifest + capability），但只能声明检索类能力（召回策略注册 + 只读库访问）；默认内置官方检索 Skill（09 票），第三方可扩展/替换；多 Skill 组合 = 召回结果合并重排。

### 2. 运行时与 API 分层（06 票结论为基）
- sandbox iframe UI + MessageChannel capability RPC + 宿主预注册 plugin_block；V1 增 QuickJS/WASM logic worker（deadline、内存预算、可终止）；Node 子进程仅 desktop-privileged（签名 + 用户明确批准）。
- API 五层：manifest/安装 → 声明层（块 schema、commands、menus、views）→ capability 层（grant/revoke/审计）→ UI/lifecycle 层 → 数据/编辑层（versioned DTO、transact(intent, expectedRevision)）；仅 manifest/DTO/贡献点为稳定公共 API，内核对象私有。

### 3. 版本与稳定性承诺
- 插件 API semver + manifest minAppVersion + 宿主维护版本兼容矩阵（Obsidian versions.json 模式）；破坏性变更走主版本 + 迁移指南。

### 4. 权限模型
- 安装时能力清单 diff 确认（升级新增能力需重新确认）；运行时首次调用敏感能力（网络/文件系统/外部命令）二次弹窗、可记住；设置页能力审计 + 逐项 revoke。

### 5. 内置插件策略（MVP 验收方式）
- 核心块类型（标题/列表/表格/代码/图片/引用/callout）进内核；随包内置示范插件 **Mermaid 图表 + KaTeX 数学公式**，走完整插件管线（manifest/沙箱/RPC/能力确认）加载——兼作插件系统 MVP 验收示范。

### 6. 安装格式
- 本地安装 = 文件夹/zip；manifest（id/版本/入口/贡献点/能力/integrity）+ npm ECDSA 式签名（name@version:integrity）；分发仅本地（云端市场 out of scope）。
