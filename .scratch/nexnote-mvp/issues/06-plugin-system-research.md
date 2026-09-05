# 06 · 插件系统机制研究

Type: research
Status: resolved

## Question

为 NexNote 插件系统（第三方可扩展块类型、视图、菜单、命令；用户本地安装；对外产品标准需 API 稳定性）提供机制事实依据：

1. 沙箱 / 运行时选项对比：iframe + postMessage、Web Worker、QuickJS / WASM、Node 子进程（桌面壳下）——安全边界、能力暴露、性能、与「扩展块类型」（需要注册编辑器节点）的匹配度。
2. 参考对象：Obsidian 插件 API（桌面全能力模式的取舍与安全争议）、AFFiNE / BlockSuite 扩展机制、tldraw 插件 / util 体系、VS Code 扩展 API 分层。
3. 本地安装格式：manifest 字段、版本策略、入口约定、签名 / 安全基线的行业做法。
4. 插件 API 与编辑器内核（02 号票的候选）的耦合面：哪种内核的扩展点最适合被第三方安全调用。

产出运行时建议 + API 分层草案要点。

## Answer

- 四种运行时事实：iframe sandbox + postMessage 是浏览器强隔离（须精确 targetOrigin/源校验）；Web Worker 只解决线程与 CPU 任务，不拦截 fetch；QuickJS/WASM 是 VM 级隔离（Figma 生产验证，Realms shim 漏洞后改用）；Node 子进程权限面过大——Node 官方明确 Permission Model 是 seat belt，不防御恶意代码。
- 核心结论：第三方不能直接注册编辑器 Node/View（必然同 realm 执行）；应由内核预注册 `plugin_block` 容器，插件经 JSON Schema + capability RPC + sandbox iframe 扩展它。
- 参考事实：Figma manifest 分离 `main` sandbox 与 `ui` iframe，并有 networkAccess domain allowlist；Obsidian 全能力桌面模型 + `minAppVersion`/`versions.json` 回退 + isDesktopOnly 声明；VS Code extension host 分层 + activation events 懒加载 + Workspace Trust；BlockSuite 的 schema/service/view 三分概念最贴近块需求但官方声明有重大变更在途；tldraw 强调 props 校验与 shape migrations。
- 安装格式：不可变包 + manifest（id/SemVer/nexnoteApi/minAppVersion/entries/contributes/capabilities/integrity/publisher）+ 签名（npm ECDSA `name@version:integrity` 先例）+ provenance（npm build provenance）+ 安装时能力 diff 确认；npm 式签名不等于发布渠道信任，Figma 官方明确人工审核不作为安全边界、依赖 sandbox。
- 运行时建议（首发）：sandbox iframe UI + MessageChannel RPC（JSON DTO + schema 校验 + 限频/可取消）+ declarative commands/menus + 懒激活；V1 引入 QuickJS/WASM logic worker（deadline、消息/内存预算、可终止）；`desktop-privileged` Node 子进程仅对签名+用户明确批准的包开放，永不默认。
- API 五层草案：manifest/安装 → 声明层（块 schema、commands、menus、views）→ capability 层（grant/revoke/审计）→ UI/lifecycle 层（iframe bootstrap、快照、activate/suspend/dispose）→ 数据/编辑层（versioned DTO、`transact(intent, expectedRevision)`）；特权层独立。仅 manifest/DTO/贡献点是稳定 public API，内核对象保持私有。
- 与 02 号票耦合：推荐内核无关的 `PluginBlock` 协议 + 私有 adapter 吸收内核差异；BlockNote/ProseMirror 侧最顺（createReactBlockSpec 的 type/propSchema/content 与宿主需求对齐），但其 render 拿到 editor，只能给 trusted adapter。备选：受审计同进程 native adapter（合作伙伴模式）或 QuickJS-first（弱 UI、重逻辑场景）。
- 报告：[docs/research/plugin-system.md](../../../docs/research/plugin-system.md)
- 明确建议：首发采用「sandbox iframe UI + capability RPC + 宿主预注册 plugin_block」，V1 增 QuickJS/WASM logic worker；备选 A 为受审计同进程 adapter（仅官方/强审核），备选 B 为 QuickJS-first（自动化型插件为主时）；Node 子进程仅限 desktop-privileged，且不承诺其 Permission Model 可隔离恶意代码。
