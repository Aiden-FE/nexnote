# 10 · 插件与 Skill 系统架构对齐

Type: grilling
Status: open
Blocked by: 06, 08

## Question

基于研究票 06（docs/research/plugin-system.md）与技术架构收敛票 08 的组合，与用户对齐插件与 Skill 系统架构：

1. 插件运行时：沙箱模式选型、能力暴露分层（UI 层 / 编辑器块类型层 / 数据层 / 系统层）、与所选编辑器内核扩展点的耦合方式。
2. 插件 API 面：扩展块类型、视图、菜单、命令四类扩展点的 API 形态与稳定性承诺（对外产品标准）。
3. Skill 与插件的关系：检索 Skill 是否建模为「一类受约束的插件」（推荐方向）还是独立体系；启用 / 禁用、多 Skill 组合、召回策略注册机制。
4. 本地安装格式与安全基线（manifest、版本、签名）的最小方案。

产出：插件 & Skill 架构决策（ticket 内 Answer），可酌情落 ADR。
