# NexNote 开发票据暂停检查点

> 暂停于第 70 轮。恢复时先读取本文件、`.scratch/orchestration-ledger.json`、`.scratch/nexnote-build/README.md` 及对应 issue/worklog；随后 `get_goal` 并按用户指令 `update_goal resume`。
>
> 任何票据只有在 **clean fixed SHA + current master ancestry + 主控 typecheck/test/lint/build/diff-check + fresh Standards PASS + fresh Spec PASS + merge + post-merge verify** 后才算完成。

---

## 0. 最新状态（持续更新，优先于下方陈旧冻结段）

- **当前状态（2026-09-22）**：验收反馈本轮（DEV-075～DEV-081）已建票，DEV-076（同步冲突 UX & 转圈收尾，P0）已完成实现并合入 master。候选 `b3dab03`，merge `a7d3c45`，ticket 状态标注 `fcb350c`。当前 master `fcb350c`。
- **DEV-076 验收门禁**：`CI=true pnpm -r typecheck` PASS；Vitest **167 files passed / 1 skipped、1548 passed / 2 skipped**；lint 0 errors；build PASS；release-config **31/31**；changed-format 与 diff-check PASS。同步阶段状态机抽到 `packages/renderer/src/features/git/state-machine.ts` 纯函数模块；main 侧 `configureAutoSync` 闭包把 `syncProgressListener` 注入 `sync().onProgress`（修掉自动同步静默）；ipc 索引层注册 `services.git.onSyncProgress` 广播到主窗口。
- **GUI smoke 未覆盖**：UI 行为（spinner 收尾 / hover 文案 / 冲突徽标点击）已用纯函数单测确保；Electron packaged smoke 含同步冲突路径需另起 NOT_RUN 任务与 CI 验证。
- **当前状态（2026-09-20）**：DEV-050～DEV-057 八张票据已全部实现、独立 Standards + Spec 双轴审查通过并合入 master；**v0.0.15 已正式发布**。代码候选与远端 `refs/tags/v0.0.15` 均为 `843b005`；tag 后 master 仅含 QA evidence、checkpoint 与发布事实记录。
- **八票结项（固定候选 → 双轴审查）**：DEV-050 `5383c20`、DEV-054 `d59c337`、DEV-051 `2d6e505`、DEV-052 `52d75cb`、DEV-055 `dc3fa03`、DEV-053 `d4e9c55`、DEV-056 `d6f08ce`、DEV-057 `48f9604`（merge `f08ad0d`）。全部 Standards PASS + Spec PASS；候选均已 `merge-base --is-ancestor` 确认在 master 历史内。
- **v0.0.15 候选门禁**：`CI=true pnpm typecheck` PASS；完整 Vitest **156 files passed / 1 skipped、1403 passed / 2 skipped**；lint 0 errors / 4 个既有 warnings；build PASS；release-config **31/31**；changed-format 与 diff-check PASS。本机真实 macOS arm64 Ad hoc 产物绑定 `candidateSha=843b005`、`appVersion=0.0.15`、Electron 44.2.0、ABI 149，packaged smoke **261/261 PASS**、40 张截图；Node ABI 已恢复 147。
- **QA evidence**：`docs/release/qa/v0.0.15.json` 位于 immutable source commit `d4c0499`，JSON 内 `commit` 正确绑定 tag candidate `843b005`；repo Variables 绑定该 raw URL 与 SHA-256 `eccfb9a707071bad299cbfacf7de0530363a7cbf3c81fee75263b3904be00013`。`release-evidence.mjs create + validate` 本地模拟及 CI preflight 均 PASS。
- **审批门禁**：`release-qa` Environment 已配置 required reviewer `Aiden-FE`（仓库唯一管理员/协作者，`prevent_self_review=false` 以避免单用户仓库死锁）。run `35455544941` 在四平台 build、macOS packaged smoke、preflight 全绿后进入 pending deployment，再由该 reviewer 通过 authenticated GitHub API 提交 `approved`；审批记录绑定 environment `release-qa` 与候选 `843b005`。
- **正式发布**：workflow run `35455544941` 的 prepare、4×build、smoke、preflight、publish **8/8 jobs success**。GitHub Release `v0.0.15` 为 stable、non-draft、non-prerelease，published `2026-09-19T16:52:16Z`：https://github.com/Aiden-FE/nexnote/releases/tag/v0.0.15。公开资产共 17 个；下载后 `SHA256SUMS` 覆盖的 **16/16 全部 OK**，清单自身 SHA-256 为 `f2c1f3ead8ef77a2254bd65dcf0509cb1f9bad3618ef6568987f03826f017d73`。CI packaged smoke `261/261 PASS`，证据已取回至 `.scratch/nexnote-build/smoke/RELEASE-0.0.15-ci/`。
- **外部/跨平台不可验证项（NOT_RUN）**：Windows/Linux packaged smoke（当前 release workflow 只在 macOS runner 跑 packaged smoke）、Windows/Ubuntu 物理安装、真实 N-1 网络升级、平台签名凭据路径；本机与 CI macOS arm64 Ad hoc packaged smoke 不替代这些证据，且未被错误报告为 PASS。

- **续接状态（2026-09-16）**：DEV-027～DEV-044 已全部实现并合入；packaged smoke 与发布门禁已完成。最终正式发布基线为 **v0.0.11**，tag commit `39b39cb`，master 当前 `b12c009`。
- **当前可执行门禁**：`CI=true pnpm -r typecheck`、`env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`、lint、build、release-config 31/31、diff-check 全部通过；最新全量结果为 145 test files passed / 1 skipped，1152 tests passed / 2 skipped。
- **DEV-042 packaged smoke**：使用真实 macOS arm64 Electron 44.2.0 产物运行；首次发现 better-sqlite3 ABI 147/149 不匹配，按仓库 staging 配方修复。修正 smoke 的 DOM helper、AI 菜单动作合同、Markdown 字段场景 active tab、AI Dock profile/ready 前置后，最终 `.scratch/nexnote-build/smoke/RELEASE-0.0.2-final2/results.json` 为 **215/215 PASS**，退出码 0。
- **GitHub Release v0.0.11**：已正式发布（非 draft、stable、published `2026-09-16T05:18:56Z`）。workflow run `35057234834` 全部 success（prepare/四平台 build/smoke/preflight/publish）；Release URL：https://github.com/Aiden-FE/nexnote/releases/tag/v0.0.11。`SHA256SUMS` asset digest 为 `9d5b3e9fe936ff6146c8a39399bc25c96e5f8c02029849c5d2594623008ab764`，下载后 `sha256sum --check` 全部 15/15 OK。
- **真实进度：26 / 26** —— DEV-001~DEV-026 全部验收并合入 master（DEV-021~026 为验收反馈追加票，2026-09-14 完成）。
- master 发布基线：`1e1ab79`（发布后 GitHub Release asset 回读校验 merge）；发布策略/Updater 集成后 master 代码基线已通过后续验证。
- post-merge typecheck / 125 test files passed（1 skipped，1012 tests / 2 skipped）/ eslint / build / release-config **31/31** / changed-format / diff-check 全过。
- 无 Apple Developer/Windows Authenticode/Ubuntu GPG 私钥的本机 macOS arm64 产物真实构建并验证为 Ad hoc（`NexNote-0.1.0-mac-arm64.dmg/.zip`，codesign `Signature=adhoc`）；打包 Electron smoke **154/154 PASS**，退出码 0。证据：`.scratch/nexnote-build/smoke/RELEASE-FINAL-3/results.json`。
- 验收反馈六票摘要（详细见各 issues/*.md 与对话共识）：
  - DEV-021（`c12d2ad`）：用户可见文案零 vault →「知识库」（含主进程错误/诊断消息与 git init 消息「nexnote:init: 知识库初始化」）；删除 FilesPage/`'files'` TabKind/欢迎页按钮/`tab.files` 命令；旧布局残留 files tab 经 readVaultConfig 过滤（单测权威）。
  - DEV-022（`5c2643a`）：TabStrip HTML5 拖拽排序（DataTransfer 注入后 smoke 可真实走 React 处理链）+ `tabOrder` 布局持久化（仅限已有 tab 栈恢复；跨重启 tab 会话恢复为既有架构外延）+ Ctrl+Tab / Ctrl+Shift+Tab 循环（mac 物理控制键等价）。
  - DEV-023（`63b6b49`）：Markdown 源码划词 bubble 补格式化五项（`**`/`*`/`~~`/`` ` ``/`[x](url)`，单事务可 undo、无选区骨架）+ 双链按钮两模式统一；ADR-0004 修订已落盘。
  - DEV-024（`4ad2d57`）：CodeMirror `[[` 补全（Link Index 候选、模糊、红链创建、别名）+ 反链面板计数角标（0 隐藏、随 tab 更新）。
  - DEV-025（`a99babc`）：字段目录选择器（7 标准字段带类型/说明/已添加禁用/tooltip）+ Markdown 文档属性编辑改为顶部状态栏按需 Popover；YAML 头持续从 CodeMirror 抽离、未编辑往返字节不变，Popover 关闭前 flush 合法 YAML 编辑；ADR-0004 已追加修订。
  - DEV-026（`5d49165`）：右栏「配置 AI」与 ⌘K `ai.setup` 收口 `openSettings('ai')`；`ai:setupPrompt:dismiss` 持久化位控制首启自动弹一次；设置页保留重播。
  - 发布/自动更新对标（`1e1ab79`）：macOS Ad hoc 双架构、artifact contract、无凭据 Windows/Linux 发布路径、Mac Releases fallback、严格 SemVer/禁止降级/失败重试/安装状态恢复、发布后 Release asset 回读。
- better-sqlite3 ABI：master 最终打包 smoke 后已恢复 Node ABI（`pnpm pretest`）。
- 外部/跨平台不可验证项沿用 `release-checklist.md` 第 6 节既有 **NOT_RUN** 清单：真实 GitHub Actions 运行/发布、Intel runner 产物、Windows/Ubuntu 物理安装、真实 N-1 网络升级、平台签名凭据路径；本机已完成 macOS arm64 Ad hoc 产物与 packaged smoke，但不能替代这些证据。公开 publish 仍要求 `release-qa` Environment、immutable QA evidence 和 required reviewer 审批。

### DEV-010 · AI 写作辅助（已合并 `ab0b882`，候选 `2c563e4`）
- kernel：新增框架无关扩展 SelectionBubble（选区浮动工具栏，⌘⌥+R/E/C/P/F/A 快捷键）、ContextMenu（右键 AI 子菜单，二级菜单）、`computeEditorActionContext`；SlashMenu 支持 `extraSlashItems`（`/ai` 六动作）；新增回写原语 `replaceRangeWithMarkdown` / `insertMarkdownBlocks`（单事务，可 undo）。
- renderer：`features/ai/writing/*`（六动作 prompt、token 预算截断、LCS diff、流式封装、会话 store、编排控制器、React diff 浮层 WritingAssistantLayer）；EditorView 接入三入口 + 活动编辑器注册；AiChatDebug 回答新增「插入为块」。
- 验收覆盖（happy-dom 真实 TipTap kernel + mock IPC streaming）：浮动工具栏六动作可触发、流式 diff、Accept 写入可 undo、Reject 原文不变、斜杠与右键可触发、超长「上下文过长，已截断」提示、accept/reject/cancel。
- NOT_RUN：真实 provider 写作流式（smoke vault 未配置 writing profile）、Electron 内人工点击三入口与 diff 接受的端到端操作（由真实 kernel + mock 流单测/集成测试等价覆盖）。
- 测试：kernel `writing-surfaces.test.ts` 11 项；renderer `writing-actions/context/diff/controller/layer` 共 21 项。

### DEV-011 · 渐进式召回管道与向量索引（已合并 `993fe82`，候选 `b59d1bf`）
- schema v5：`block_vectors`/`vector_meta`（块粒度向量 JSON；blocks FK CASCADE 清旧向量；模型指纹分代）。
- main `retrieval/retrieval-service.ts`：三阶段 FTS 粗筛 → 双链 1 跳 → 向量重排（候选集精确余弦）+ DEV-008 置信度乘性因子（默认权重 0.3）；token 预算打包；分阶段命中数/耗时来源标注；embedding 失败自动降级两阶段；全量构建 + 防抖增量（模型变更全量重建）。`BuiltinRetrievalSkill.search(query,options)` 供 DEV-014。
- 通道 `ai:retrieve`、事件 `ai:retrievalStatus`；renderer RetrievalSources（参考来源+阶段统计+降级徽标+点击开 tab）、RetrievalTester 挂 AI dock。
- 验收覆盖（main 7 项 + renderer 2 项）：全量/增量/模型指纹、三阶段均有命中、置信度重排、降级、1200 块召回 <500ms、来源渲染/跳转。
- NOT_RUN：真实 embedding provider 与 Electron 人工检索（bag-of-words fake embedder + 真实 FTS/双链/置信度链路等价覆盖）。sqlite-vec ANN 未引入（候选集精确余弦 <500ms），VectorStore 接口预留替换。

### DEV-012 · AI 对话 dock 与会话即页面（已合并 `9829e4d`，候选 `51ce48a`）
- 会话即页面：每会话 = vault 内 `<chatFolder>/<name>.md`（frontmatter `type: chat` + HTML 注释消息块 role/meta=base64url JSON）。默认目录 `AI Chats/`（VaultConfig.chatFolder，可经 chat:folder:set 配置；放普通目录以便双链引用与语义索引）。每条消息后 chat:save 自动保存；chat:list/get 历史列表与续聊；重启后从磁盘恢复。
- 主进程：`chat/chat-format.ts`（parse/serialize 纯函数，frontmatter 标量 + base64url meta，CRLF/损坏 meta 容错）、`chat/chat-service.ts`（list/get/new/save/saveAsDocument/folder get-set；save 路径限定会话目录越权防护 OUTSIDE_CHAT_FOLDER；存为文档 = AI 回答转正文 + 用户消息转引用 `>`/HTML 注释，写 vault 根唯一文件名，原会话保留）。chat:* IPC 7 条 + validation；VaultConfig 增加 chatFolder，vault-manager 加 sanitizeChatFolder。
- renderer：`features/ai/chat/*`（ChatDock/ContextChips/chat-store/chat-runtime/context/chat-context-bridge/ask-ai）。流式回答（复用 ai:chat:stream:*，feature=chat）、多行 textarea ⌘Enter、新会话/历史菜单/设置工具栏、空态。上下文 chips：当前文档自动、可加当前选区/反链文档/特定页面；token 估算 + head-tail 截断。发送前 refreshAutoDocumentChip 注入最新正文 + ai:retrieve 的 contextText；回答下方折叠 RetrievalSources（复用 DEV-011），来源持久化到 assistant meta。插入为块复用 DEV-010 insertIntoActiveEditor。
- 入口/双链：EditorView selection bubble + 右键新增「询问 AI」（ask-ai.requestAskAi → queueAsk + 打开 dock + 选区 chip）；onWikilinkActivate 先 openChatWikilinkOrNull（按 frontmatter title 匹配 chat:list）命中则打开 dock 加载会话，否则原打开页面逻辑。AiDockPanel 配置后渲染 ChatDock（替换 AiChatDebug/RetrievalTester；二者文件保留，设置页仍用 AiChatDebug）。
- 验收覆盖：main 14（format 往返/frontmatter 引号冒号/meta 附着/非 chat null/损坏 meta/CRLF；service 新建落盘/续聊来源/倒序忽略非 chat/越权拒绝/存为文档引用与注释/切目录/非法目录）+ renderer 7（上下文优先级截断/token、流式→来源→自动保存/标题取问题、双链标题打开、询问 AI 载荷）。
- NOT_RUN：真实 provider 对话流式与 embedding 召回（mock bridge + fake retrieve 等价覆盖）、Electron 内人工点击三入口/历史切换/存为文档打开 tab/双链打开 dock 的端到端、右键「询问 AI」实际浮层点击（由 kernel 浮层测试 + requestAskAi 单测等价覆盖）。

### DEV-013 · 插件系统基础：沙箱运行时与能力 RPC（已合并 `5e9124e`，候选 `74d1dd5`）
- 旧过时 WIP `9f283f3` 已备份为 tag `wip/dev-013`（只读参考），基于 master 重写；第三方依赖 adm-zip/semver 全部替换为零依赖本地实现。
- shared：`types/plugin.ts`（manifest/权限六档/贡献点/版本化 RPC envelope，`PLUGIN_API_VERSION='1.0.0'` 值导出）、`ipc/channels/plugins.ts`（plugins:* 20 通道，新增 `plugins:pickSource`）、`events.ts`（`plugins:changed`）。
- main：`plugins/version-compat.ts`（零依赖 semver）、`manifest-validator.ts`、`authorization.ts`（一次性 challenge 授权门禁 + one-shot grant）、`zip-extract.ts`（inflateRaw，防 zip-slip/炸弹，wrapper-dir 归一化，method 0/8）、`artifact-intake.ts`（不可变 staging 快照 + sha256 复算防 TOCTOU；zip 分支复用解压只读产物、不回写——修复移植期 EACCES）、`plugin-service.ts`（生命周期加载/激活/停用/卸载/崩溃隔离、RPC dispatch command.register/transact/capability.call/permission.request、审计日志）、`ipc/plugin-handlers.ts`；bootstrap/services/validation/index 接线。
- renderer：`features/plugins/*`（PluginSandboxFrame iframe `sandbox=allow-scripts` 无 allow-same-origin、MessageChannel RPC、2s heartbeat watchdog、崩溃上报移除帧、未授权权限弹窗重试；PluginHost 挂沙箱帧+注册 command/pluginContribution 注册表+权限弹窗+贡献插槽；PluginsSettingsPage 文件夹/zip 安装预览确认、详情、启停、逐项 revoke、审计）；`public/plugin-runtime/`（index.html 严格 CSP `default-src 'none'` + bootstrap.js：window.nexnotePlugin API、生命周期事件、心跳、crash 上报、blob 入口）；`bootstrap.ts` import + `WorkspaceView` 挂 `<PluginHost />`。iframe src 用相对路径 `plugin-runtime/index.html`（打包后 file:// 可用）。
- 验收覆盖：main `plugin-service.test.ts` 10 例（manifest/semver 校验、票据确认、会话绑定与停用撤销、敏感能力门禁+授权后 NOT_IMPLEMENTED、one-shot grant 消费、staging 篡改拒绝、升级撤销会话、crash fixture 隔离不影响他插件、崩溃移除贡献、zip 解压+状态恢复；零依赖 zipFolder 测试助手写 method-8 deflate）；renderer sandbox/permission-flow/contributions 7 例（CSP/sandbox 字符串断言、生命周期顺序、版本化 RPC/超时/崩溃、权限弹窗重试、watchdog、贡献分发）。
- NOT_RUN：真实第三方插件安装与 ECDSA 签名（签名框架预留，MVP 未启用）、QuickJS/WASM logic worker（V1 用 iframe UI 沙箱 + main-thread logic，stretch）、真实 network/filesystem/external-command 能力执行（capability.call 授权后返 NOT_IMPLEMENTED）、Electron 内人工安装/权限弹窗点击 E2E（由 service 10 测 + flow/sandbox 7 测等价覆盖）。

### DEV-014 · 插件扩展点（块/视图/命令/菜单）+ 检索 Skill（已合并 `a01f20e`，候选 `43a8c80`）
- 扩展点：kernel `pluginBlock` 原子 TipTap 节点（attrs pluginId/blockType/data，` ```nexnote-plugin:<id>:<type>` 围栏 Markdown 往返，insert/setData 命令）。renderer `features/plugins/extension-points.ts` 纯派生：命令合并去重入 ⌘K、菜单注入编辑器右键「插件」子菜单（注册表 scopedId → runCommand）、视图注册侧栏页签（visible 沙箱 iframe）、块类型派生 ⌘K 插入（`getActiveEditor().insertPluginBlock`）。manifest 贡献点增 placement/anchor/when/blockType，validator 保留。
- Skill 系统：`types/skill.ts` + `skills:*` 6 通道 + `skills:changed`；RetrievalSource.skillId 溯源、RetrievalOptions.skillIds。main `SkillService`（内置三阶段 + 快速关键词 FTS；活跃插件 manifest.skills 自动发现；启停/排序/参数持久化 nexnote-skills.json；多 Skill 各自召回 → `mergeSkillResults` min-max 归一化/同 path+blockId 去重/并列退绝对分重排 + packContextText）。`ai:retrieve` 改经 SkillService（默认仅内置，行为同 DEV-011/012；无 retrieval 优雅降级；插件 skill 由宿主安全参数化执行）。renderer 设置页「检索 Skill」(order 62) + ChatDock Skill 组合选择器（空=全部启用）。
- `@nexnote/plugin-api` 类型包 + starter 模板（manifest/main/README）+ versions.json 兼容矩阵（新 workspace 包，pnpm-lock 已登记 importer）。
- 验收覆盖：+15 测试（kernel plugin-block 3、renderer plugin-extensions 4、main skill-service 7、plugin-service 技能发现 1）；demo fixture 补检索 Skill。NOT_RUN：插件沙箱内自定义块/视图实时渲染与 QuickJS worker、插件自定义检索 iframe RPC（走宿主参数化执行）、Electron 人工装 Skill/右键/视图 E2E。

### 下一张：DEV-015 内置示范插件 Mermaid + KaTeX（依赖 DEV-014；M）
- 票据 `issues/015-builtin-plugins-mermaid-katex.md`；基于最新 master 新建 worktree `.wt/DEV-015`。
- 复用 DEV-013 插件运行时 + DEV-014 pluginBlock 节点/扩展点：Mermaid 走 pluginBlock（图代码 → 渲染），KaTeX 走内联/块数学；作为内置（bundled）插件或宿主内置扩展。
- DEV-016/017/018 有旧 WIP（`.wt/DEV-016 @ aad90d6`、`.wt/DEV-017 @ 506e5f8`、`.wt/DEV-018 @ b86a6f2`），重做前先比对最新 master；DEV-019 整体 E2E 依赖全部。


## 1. 全局基线

- 顶层目标：完成 19 张票据及 DEV-019 集成验收。
- Goal：`goal-f6df97e0-0f45-4b60-86b9-d7edf6e49889`，revision `6`，phase `paused`。
- master：`60fa91e1c1b07f7a1bea54b11af6a80c83c38e02`，clean。
- 已完成/合并：DEV-001 `a35a307`、DEV-002 `684f783`、DEV-003 `60fa91e`。
- 真实进度：**3 / 19**。
- 主目录：`/Users/aiden/dev/aiden/nexnote`；worktrees：`.wt/<TICKET>`。
- 不伪造外部验收：DEV-007 HTTPS/SSH 凭据、DEV-017 Windows native、DEV-018 physical signing/install/N-1 update。

## 2. 冻结时精确 worktree 状态

| Ticket | HEAD | 状态 |
|---|---|---|
| DEV-004 | `890918055af40a8aefc60369c27adf44b6388211` | dirty：`packages/main/src/indexer/index-service.ts`、`packages/main/tests/index-service.test.ts`；WIP 为 block-level `blockId`/snippet。 |
| DEV-005 | `cc6b7932859ffab1d0cf79da4fd5b8cf44d134e6` | clean；等待 DEV-004。 |
| DEV-007 | `cd6323c8e1f5716811a5dda7ccc37f10b891d3bc` | clean；仍未通过 Spec。 |
| DEV-009 | `1778ac8e2d8006712d9dc0256e514e2c8941b80f` | clean；仍有安全/迁移/stream blockers。 |
| DEV-013 | `9f283f3b037952c0ff483546004d83d48436b200` | clean；Electron bootstrap smoke 失败。 |
| DEV-016 | `aad90d65067c63277e37738f332f0a48381fa744` | clean；仍有 settings/shortcut/token blockers。 |
| DEV-017 | `506e5f830ade9518bff40b4d064de0be35429831` | clean；Windows/rename/editor blockers。 |
| DEV-018 | `b86a6f288febd148f3e86e8c36ca2fa9fcd10ecf` | dirty：`packages/main/src/updater.ts`、`packages/main/tests/updater.test.ts`、`scripts/verify-release-config.mjs`；WIP 将 autoDownload 设为 true。 |

另有 detached review worktrees：`/private/tmp/nexnote-dev004-gate` (`ed6d956`) 与 `/private/tmp/nexnote-dev009-review` (`25eeb7e`)；不要误作候选或合并。

## 3. 票据进展与待办

### DEV-004 — Link Index / FTS / 标签

Agent：`607b1604-6ba6-40a4-97b0-f5f84c50ff94`。已做 watcher batching、vault generation guards、LIKE escaping、ranking improvements、normal-link rename 基础、search/jump generation/debounce 等。

恢复后必须综合处理：
1. rebuild 的 scan/read/parse/transaction 全部放入 error boundary；scheduled rebuild catch 并发布 `phase:error`；避免 Electron main thread 大 vault freeze。
2. 建立共享、code-aware Markdown link parser：忽略 inline/fenced/multi-backtick code；支持 optional title、`<angle>` destination、balanced parentheses。
3. normal Markdown destination 相对 source dirname 归一化、拒绝 traversal；rename rewrite 使用同一 parser，不能 basename 误改其他目录，不能改 code examples。
4. CRLF blocks 与 shared wikilink block offsets 一致；fence 内空行不误分块。
5. 全局 `title>tag>alias>content`，multi-term term-wise tier；不在排序前任意 cap；FTS 成功不跑 unbounded leading-wildcard LIKE；tag subtree LIKE escape。
6. 不索引 `.png`/`.pdf` 等 explicit non-note assets；ambiguous basename 不可 arbitrary last-win。
7. 完成当前 WIP：block-level `SearchHit.blockId`、block-local highlighted snippet、renderer consumer；评估避免 N+1 SQLite。
8. 保留 stale full-search/backlink/jump request guards；补稳定 full-suite/performance tests。

更正：此前约 160ms benchmark 来自 dirty worktree，**撤回该具体时间作为 committed SHA 证据**；但 successful FTS 后 unbounded LIKE scan 仍是有效 scalability blocker。

### DEV-005 — Frontmatter

clean `cc6b793`，依赖 DEV-004。历史 blockers：debounce stale source；unsupported YAML merge/anchor/flow/nested mapping；inline comments/source lock；confidence mock；DEV-004 index/tag live integration；真实 inbound/outbound counts。

### DEV-007 — Git 基座

Agent：`49124115-e5bf-4a5d-a1b2-421c6e5bed04`。已有 pull payload、conflict auto-commit guard、remote redaction、exact repo root、strict layout/timeline bounds、restore symlink guard 等。

仍需：
1. save scheduler 传播 `onSave` error；App/timeline 不得在保存失败后提交 stale disk。
2. single-page timeline 绑定 active page；file timeline `isHead` 比较真实 repo HEAD。
3. remote/status/pull/push 使用 branch upstream，不是 `remotes[0]`。
4. `addRemote` 在 mutation 前 `ls-remote` preflight；失败不保留坏 remote。
5. conflict UX：red state + reveal repo；Cmd-S optional message flow。
6. fresh review `cd6323c`，确认 restore/clone redaction/manual conflicts/recordWrite status semantics。
7. 新增 exact `d39d20e` Standards blockers：clone error 在 IPC 前必须 remote-text sanitize（失败 URL query token 不能泄露）；existing direct-child clone target 需 `lstat` 拒绝 symlink，并以安全 reserve/temp+atomic move 避免 clone 到 parent 外；manual commit 也必须复用 unresolved-index/conflict-marker guard；root close/switch 应以 generation/cancellation 阻止已 in-flight auto commit；auto commits 需 per-root serialized queue，timer callback errors 需 report，不可 silent swallow。
8. external AC：public HTTPS + private SSH authenticated push/pull 未运行。Harness 应用 default GitService/bundled Dugite 并校验 protocol/visibility；无凭据不得宣称通过。

### DEV-009 — AI Provider

Agent：`8e1b4704-01c8-4152-b304-efac354b97a1`。已有 native OS keyring、opaque renderer token、export refs、stream cleanup 基础、local hash-384、embedding-only default protection、asarUnpack config。

仍需：
1. credential token one-shot 或绑定 normalized origin+operation，消除 replay/redirect key exfiltration。
2. authenticated fetch 禁止 cross-origin redirect（models/chat/SSE/embeddings）。
3. reject empty/NaN/Infinity embeddings。
4. cross-target dist 安装 target-specific keyring optional binding；真实 packaged smoke 在正常 runner 执行。
5. legacy `enc:v1:` migration：vault unavailable 不丢密文；不可把 blob 当 account；JSON/vault mutation 需补偿一致性；接受合法 Linux safeStorage backend。
6. stream register-before-terminal、late start/unmount orphan cancel、timeout vs user cancel、send failure reader cleanup。

### DEV-013 — 插件运行时

Agent：`37e67803-ebe2-4b6f-8b31-3050d23f3bac`。已有 auth/staging hash、ZIP cap、部分 host surfaces、command changed、crash isolation。

仍需：
1. packaged bootstrap URL 当前从 file page 解析为错误 `file:///plugin-runtime/index.html`；真实 Electron host-ready smoke 失败。实现受控 custom protocol/per-session token/strict CSP，并捕获 console/page errors。
2. lifecycle/error ownership：beginSession failure 不能用空 credentials 上报；MessagePort async handler 捕获 IPC rejection并回 RPC error。
3. 合并 production watchdog 与 tested watchdog；iframe 同 renderer thread 无法隔离 infinite loop，需真正独立 context（utility process/worker）及 hang E2E。
4. host command/menu/view/blockType 必须执行 plugin code/editor transaction，不可 echo/no-op；capability RPC 不能全是 `NOT_IMPLEMENTED`。
5. approved bytes/hash 跨 restart 保持 immutability；teardown 等待 bounded lifecycle ack 后关闭。
6. permission preview 与 enforced `permissions` 对齐；approvedSource 1MiB cap；session renewal/main-side user confirmation。
7. nested wrapper ZIP 应基于 discovered manifest root 解析 entry。

审查未确认 CSP bypass/sandbox escape/cross-plugin escalation；问题是 availability/correctness/lifecycle/permission disclosure。

### DEV-016 — Settings / Onboarding

Agent：`6cbf46ff-6b00-4840-9aad-2576000d4dcc`。当前 clean `aad90d6`；已有部分 persisted validation/cancellation/vault Git flush。

仍需：
1. settings store 不得把 omitted nested fields 变成 present `undefined` 发往 strict IPC；global/vault persisted JSON 要 complete deep validation。
2. editor/create-page 普通启动及 vault switch 要加载正确 vault settings。
3. startup `welcome` 打开 prior-vault Welcome tab，非 first-run onboarding。
4. CommandPalette 去掉固定 Cmd/Ctrl-K；glyph/annotation、exact modifiers、editable targets、disable default、import/direct IPC collision 全处理。
5. open-folder Git init 必须 affirmative opt-in，默认不能 mutate。
6. codeTheme、font CSS、template、autosave teardown、updater `{autoDownload,checkOnLaunch,channel}`、Git/AI/plugin/Skill domain settings 均真实消费。
7. operation controller sender scoped/ownership cleanup；Git-init abort 映射；clone token sender/webContents + TTL + bounded/revoke。
8. clone 到 exclusively-owned temp 后 atomic move；失败只删除 owned temp；VaultManager.create 防 symlink substitution。
9. live settings 变化不能用 stale `load.markdown` 重建 kernel 丢失编辑。

### DEV-017 — Editor / Native Secure Create

Agent：`d909e80e-9be1-4c12-a510-342c82a6b6b7`。已有 POSIX descriptor-relative create、dynamic buffers、FD cleanup、fstat、EEXIST reopen、nested canonical link。

仍需：
1. Darwin atomic no-replace rename：定义 `_DARWIN_C_SOURCE`，include `<sys/stdio.h>`，使用 `renameatx_np(...,RENAME_EXCL)`；ENOTSUP/EXDEV fail closed；race tests。
2. Linux `renameat2(RENAME_NOREPLACE)`；root dev/inode identity；component 仅拒绝 exact `.`/`..`（允许 `v1..v2`）；path-aware existing completion。
3. clean test/dev deterministic build native addon；不提交 host `.node`。
4. editor AC：forward canonicalize seam；slash group headers；六项 functional AI actions；gray red links；hover-only handles；fold click expand。
5. Windows hard blocker：实现并在 Windows CI/runtime 对抗验证 NtCreateFile handle-relative secure create。已研究方案：dynamic ntdll `NtCreateFile`、`OBJ_DONT_REPARSE` + `FILE_OPEN_REPARSE_POINT` + `FileAttributeTagInfo`、retained handles/no FILE_SHARE_DELETE、leaf FILE_CREATE；no-replace rename 用 `SetFileInformationByHandle(FileRenameInfo,ReplaceIfExists=FALSE,RootDirectory)`。无 Windows toolchain 时不可宣称完成。

### DEV-018 — Release / Updater

Agent：`a4607a4e-21dc-4fca-b619-299140b1cc48`。已有 tag trigger、immutable QA evidence fetch/hash、icons、lease/prepublish guards、mac artifact strategy。

冻结 WIP：autoDownload=true + updater tests/config verifier，尚未提交。

仍需：
1. preflight 在执行 imports `js-yaml` 的 merge script 前 setup Node/corepack/pnpm install。
2. stale lease 必须用 anchored numeric regex `^publication lease ([0-9]+)/([0-9]+)/([0-9]+)$` 解析。
3. API query 显式 `GITHUB_TOKEN` env，publish job `actions: read`。
4. 显式 platform manifest mapping/collision failure。mac 与 Windows 都可能有 `latest.yml`；禁止 `mv -n` 静默 first-wins；只发布正确 root Windows feed、merged mac feed 和 channel metadata，无 duplicate basenames。
5. renderer update channel 从 main AppStore authoritative state 读取，移除 localStorage 双权威。
6. packaged dugite 加 GPLv2 license/source offer；修复 changed-file formatting gate。
7. operational gate：real mac notarization/Gatekeeper、Windows/Linux physical install/signature、N-1 network update 均未验证，不能用 config 代替。

## 4. 未启动与依赖

DEV-006 ← DEV-004；DEV-008 ← DEV-004+007；DEV-010 ← DEV-002+009；DEV-011 ← DEV-004+009；DEV-012 ← DEV-009+011；DEV-014 ← DEV-013；DEV-015 ← DEV-014；DEV-019 ← 全部 major P0/P1。

## 5. 恢复步骤

1. 用户要求继续后，`get_goal` 并 `update_goal resume`。
2. 对每个 worktree 核对 HEAD/status，保留 DEV-004 与 DEV-018 冻结 WIP。
3. 优先 DEV-004、DEV-007 解锁依赖；再 DEV-009/013/016/017/018。
4. 每个 clean SHA 主控运行：`CI=true pnpm -r typecheck`、`CI=true pnpm test`、`CI=true pnpm exec eslint .`、`CI=true pnpm build`、`git diff --check master...HEAD`。
5. 新建 fresh Standards + Spec reviewers，仅审固定 SHA；双 PASS 后 merge 与 post-merge verify。
6. chokidar timing 偶有 flake，需 isolated + full rerun并判断；不得简单忽略。

---

## 恢复记录（2026-09-06 主控接管）

- 子Agent 派发工具 `multi_agent_v1__spawn_agent` 在本环境返回 `unsupported call`；按范式「B. 主Agent 直接接管」条款，主控在每张票据的隔离 worktree 内亲自按 implement 方法论执行 + 主控闸门 + 双轴审查后合并。
- Goal 重新建立（thread 01a0757a-b692-7d10-bd9b-6b79b3b652ec）。
- 开工顺序：关键路径 DEV-004 → DEV-007 / DEV-009 / DEV-013 → 其余；DEV-005 待 DEV-004 合并后 rebase 联调。

### DEV-009 — 已完成合并（2026-09-06 19:10）

- Merge commit `bcc962b`；子Agent工具持续 unsupported，按主控接管规则完成。
- 全量 gates：typecheck PASS / 340 tests PASS / eslint PASS / build PASS / diff-check PASS。
- Standards/Spec 双轴 PASS；剩余外部项标注 NOT_RUN：真实 provider、macOS Keychain 端到端、三平台 dist（fetch failed）。
- 已解锁 DEV-010、DEV-011、DEV-012。

### 下一步队列（2026-09-06 19:10）

1. DEV-010（依赖 002+009 ✅）→ 派生新 worktree。
2. DEV-011（依赖 004+009 ✅）→ 派生新 worktree。
3. DEV-012 依赖 009+011，待 DEV-011。
4. DEV-013 merge 最新 master 后审 WIP。
5. DEV-016 merge 最新 master 后处理 settings/onboarding blockers。
6. DEV-017 Windows native 硬阻塞先落地 POSIX 与 editor AC，Windows 对抗验证标 NOT_RUN。
7. DEV-018 merge 最新 master，保留 frozen WIP，处理 release blockers。

### DEV-006 — 已完成合并（2026-09-06 22:48）

- Merge commit `31ee441`；候选 `167b9bb`；主控接管执行（子Agent 派发工具仍 unsupported）。
- 实现：shared `GraphSnapshot` / `index:graph`，主进程一次索引快照，全局 graph tab + 侧栏局部图，React Flow 12；支持标签/文件夹/孤立过滤、邻接高亮、1/2 跳与 stale 自动刷新。
- 主控闸门 @ `167b9bb`：typecheck PASS / 349 tests PASS / eslint PASS / build PASS / diff-check PASS；fresh Standards + Spec 双轴 PASS。
- production Electron smoke：500 页 / 2000 链接，71.0 FPS / 63 wheels；过滤、点击跳页、局部 1→2 跳全部 PASS。整体 58/65；剩余 7 项为 DEV-003/004/007 既有 smoke 基线问题。
- 双轴审查修复：过滤后孤立判定、vault reset graph race、未索引页局部中心占位。
- post-merge master `31ee441`：typecheck / 349 tests / eslint / build / diff-check 全 PASS。

### DEV-008 — 已完成合并（2026-09-07 00:54）

- Merge commit `509979`；候选 `2f933b1`；主控接管执行（子Agent 派发工具仍 unsupported）。
- 实现：schema v4 + `confidence` 缓存表 / `pages.confidence_boost`；一次批量 `git log --numstat` 聚合历史；主进程 `ConfidenceService` 串行队列计算 stability、review_count、author_count、age、link_authority、manual_boost 六因子；`getConfidence(pageId)` 与 `index:confidence` IPC；属性面板显示总分、因子条与 tooltip；默认不写 frontmatter，vault 配置可显式开启同步。
- 增量策略：纯内容变化按路径增量；页面集合或已解析链接边变化自动升级全量 PageRank；提交回调触发相关页重算；vault 切换时丢弃异步旧结果。
- 主控闸门 @ `2f933b1`：typecheck PASS / 361 tests PASS（2 skipped）/ eslint PASS / build PASS / diff-check PASS。一次全量测试遇到既有 chokidar watch flake，隔离 `watch-service` 8/8 PASS 后全量重跑 361/361 PASS。
- fresh fixed-SHA Standards + Spec 双轴复核 PASS；修复真实 Electron smoke 暴露的 `index:*` payload validator 漏配、启动 Git root 时序、PageRank 邻接表性能与 vault 切换竞态。
- production Electron smoke：62/69；DEV-008 专项 4/4 PASS（`index:pageSummary`、`index:confidence`、属性面板 38/100 + 六因子、tooltip）。剩余 7 项为 DEV-003/004/007 既有 smoke 基线（Git 状态、新笔记/面包屑、标签过滤、时间线 dock）。
- 千页性能：全链路 `ConfidenceService.refresh()` 1000 页测试 <10s；纯因子计算 1000 页 bounded test 同步 PASS。
- NOT_RUN：设置页复选框的人工点击未单独录屏/smoke；默认不写 frontmatter 与显式开启后写入由单元测试覆盖。无外部 provider/Windows/签名安装项。
- post-merge master `509979`：typecheck / 361 tests / eslint / build / diff-check 全 PASS。

### DEV-015 — 已完成合并（2026-09-07 12:40）

- Merge commit `e07d65a`；候选 `e89baf4`；主控接管执行（子Agent 派发工具仍 unsupported）。
- 实现：内置 Mermaid/KaTeX 插件走完整管线——main `seedBuiltins`（走 `validateManifest`）预置，仅声明 `read`，可禁用不可卸载，不挂沙箱帧，启停跨重启持久化；`PluginManifest/PluginView.builtin` + `BUILTIN_PLUGIN_IDS`（shared）。
- kernel：新增 `MermaidBlock`（```mermaid 围栏，Obsidian 兼容）、`MathBlock`（$$…$$）、`MathInline`（$…$，非货币/非跨块误配，含输入规则）原生节点承载 Markdown 双向往返（内核始终在线）；`extraExtensions` 供 renderer 同名 extend 覆盖 `addNodeView`，`extraSlashItems` 支持函数式实时求值。
- renderer：懒加载 mermaid/katex 富预览 NodeView（双击编辑/失焦或 ⌘Enter 应用/Esc 取消）；斜杠菜单插入；禁用回退源码视图且菜单消失；PluginHost 内置不挂沙箱帧、块命令排除内置走原生节点；设置页「内置」标记、隐藏卸载/revoke。
- 主控闸门 @e89baf4：typecheck PASS（shared/kernel/renderer/plugin-api；main 仅 2 个 master 既有 tsc 报错无关）/ 484 tests PASS（2 skipped；kernel +12、main +3、renderer +12）/ eslint PASS / build PASS（mermaid/katex 懒加载分包）/ diff-check PASS；fresh Standards+Spec 双轴 PASS。
- production Electron smoke **69/78**：DEV-015 专项 **9/9 PASS**（真实 Mermaid SVG flowchart 渲染、KaTeX 块级+行内 `.katex` 渲染、写盘为 ```mermaid 围栏 + $$ 块 + $ 行内 Obsidian 原生语法、设置页列出两内置/内置标记/隐藏卸载/禁用-重启启用 state=active）。其余 9 失败为 DEV-003/004/006/007 既有基线（Git 状态 2、新笔记 frontmatter/面包屑 2、标签面板/过滤 2、重命名 wikilink 1、500 节点 FPS 时序 1、时间线 1），DEV-015 无新增回归。
- NOT_RUN：无外部 provider/签名安装项；行内公式 smoke 中落入 H1 为脚本插入顺序伪影（用户经斜杠菜单在光标处插入）。
- post-merge master `e07d65a`：typecheck / 484 tests / eslint / build 全绿。
- 进度：**15 / 19**。剩余 DEV-016（设置/向导 WIP aad90d6）、DEV-017（编辑器交互 WIP 506e5f8）、DEV-018（打包发布 WIP b86a6f2）、DEV-019（E2E，最后）。

### DEV-017 — 已完成合并（2026-09-07）

- Merge commit `39b239d`；候选 `dev/DEV-017-fresh@f0b2b8a`（40 files，+3199/−42；含原 agent `a8343dd` + 主控接管修复）；旧 `.wt/DEV-017`（`506e5f8`）废弃勿用。
- 实现：媒体导入（renderer 分块 base64 → `fs:importBinaryFile` 原子写 + 碰撞去重，卸载 abort 挂起文件选择）、标题折叠（Decoration + 选区迁移 + 按钮键盘/去重）、块操作（删除/移动/转换/插入/按 blockId 删除，单事务可 undo + fail-closed）、块菜单（复制/剪切/删除/复制 ID/转换/上下移/折叠/插入 + AI 子菜单 + 插件项）、上下文/斜杠菜单键盘导航 + 焦点归还、选区浮栏 blur 保持、链接 ⌘K、wikilink/hashtag 建议合并索引别名、插件命令 ⌘K/斜杠入口（plugin-store setRuntime）。
- 主控闸门 @f0b2b8a（worktree）：typecheck PASS / 529 tests PASS（2 skipped）/ eslint PASS / build PASS / diff-check PASS；main 包 tsc 仅 master 基线 2 错。
- fresh fixed-SHA 双轴审查 @f0b2b8a：Standards PASS（5 minor：缩进不一致、测试 never 断言、mouseleave 栈同步冗余、destroy 未入 finally 等，无 blocker/major）+ Spec PASS（2 minor：链接按钮点击路径未测、媒体导入失败仅 console.error）。
- post-merge master `39b239d`：typecheck / 529 tests（2 skipped，64 files）/ eslint / build 全绿（main-tsc = 2 基线错）。
- NOT_RUN：无外部不可验证项（无真实 provider/签名/安装项）；媒体导入与红链创建由真实 kernel + mock IPC 单测覆盖。
- 进度：**16 / 19**。剩余 DEV-016（fresh worktree 实现中）、DEV-018（候选 `8680d39` 重审中）、DEV-019（E2E，最后）。

### DEV-019 — 已完成合并（2026-09-08）🏁 终局

- Merge commit `d95fb9e`；候选 `dev/DEV-019@9c77dba`（基线 master `00c858c`；6 commits：e5aa010 4 提交交付 + 480cd66 主控 fixture tsc 修复 + 9c77dba 主控文档失实修复）。
- 实现：`packages/main/tests/e2e-integration.test.ts`（4 用例，120 页 fixture vault 全链路：索引→CJK/拉丁搜索→双链→图谱→三阶段召回→置信度 PageRank→Skill→Chat→标签→空库降级→生命周期）+ `tests/fixtures/vault-fixture.ts`（116 行生成器）；`tests/perf-timebox.test.ts`（3 用例：千页/8k 块/3k 链接时间盒断言 index<30s、CJK<150ms、拉丁<100ms、graph<1.5s、PageRank<3s、召回<500ms、增量<5s + 500→1000 线性度搜索<4x/rank<5x；实测 index ~210ms、CJK ~8ms、graph ~90ms、PageRank ~280ms、召回 ~27ms）；`tests/bug-bash.test.ts`（6 个模块交界回归断言：hash 去重全量保护、空召回不抛错、空图不 NaN、单页合法分、大小写不敏感 wikilink、增量内容更新）；docs/ 四份（user-guide 10 章 / shortcut-cheatsheet / plugin-development 11 章 / faq 6 类）；RELEASE-NOTES.md + release-checklist.md（7 节，NOT_RUN 15 项附人工步骤）。
- 主控闸门 @9c77dba（worktree）：typecheck PASS / 74 test files passed（1 skipped，616 测试通过）/ eslint PASS / build PASS / release-config 28/28 PASS / changed-format PASS / diff-check PASS；main-tsc 仅基线 1 错（Entry）。**注意**：门禁必须 `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR`（GIT_EDITOR=true 会让 simple-git 全套测试失败 27 例，非代码回归）。
- fresh fixed-SHA 双轴审查：Spec @480cd66 **PASS**（2 minor：bug-bash 大小写用例断言强度偏弱 `>0` 未断言 =3、checklist 数字过时——后者已在 9c77dba 顺带修正）；Standards @480cd66 **FAIL**（4 major 文档失实：AI 会话「转为文档」虚构、三平台日志路径虚构、搜索面板 ↑↓/Mod+Enter 虚构、命令面板「最近访问/设置项」分组虚构；2 minor：设置分区 8→9 且「更新」错归「关于」、RELEASE-NOTES 实测值写成承诺）→ 主控逐项对照代码修复 `9c77dba`（4 文件 +16/−16；核实 SearchPanelInner 仅 Escape/Enter、CommandPalette 扁平列表 9 类标签、settingsSectionRegistry 9 分区、update-section 控件、无 electron-log 依赖）→ fresh Standards 复审 @9c77dba **PASS**（0 issues）。Spec delta 纯文档措辞修正，按协议 PASS 带入。
- post-merge master `d95fb9e`：typecheck / 74 test files(1 skipped, 616 tests) / eslint / build / release-config / changed-format 全绿（main-tsc = 1 基线错 Entry）。
- NOT_RUN（本地无法验证，已写入 release-checklist 第 6 节）：三平台签名/公证/物理安装、真实 Obsidian vault 导入走查、kill -9 崩溃恢复、打包后冷启动 <3s 实测、Electron GUI 视觉走查、大文档流畅度、自动更新端到端、P0/P1 人工复核等 15 项。
- 进度：**19 / 19 — 顶层 Goal 达成**。master 终局基线 `d95fb9e`。


### DEV-019 GUI 验收 follow-up — 已完成合并（2026-09-08）

- 用户人工 GUI 验收报告 6 项：首次四竖栏/AI Dock 默认打开/空 Pane 抢空间/页面树不同步/插件贡献裸露文案/复制 Markdown 多空行；按“不留遗留问题”扩展为 smoke 全量收敛。
- 候选 `dev/DEV-019-gui@849fa83`；merge commit `2af0166`（`merge --no-ff`）。
- 实现：首次布局默认 `dockVisible=false` + `splitEnabled=false`（旧 vault 持久化 layout 仍覆盖默认，不强制迁移）；删除 `PluginContributionSlots` 裸露调试 surface（registry effects 保留）；createPage/rename/move/mkdir/delete/H1 改名成功后立即幂等 `applyEvent`；rename/move/delete 前 `requestAppSave(window)` 排空防抖保存，防止旧路径复活；原生 Copy 使用结构化 Markdown serializer，段落/列表间距正常，剥离 frontmatter 与块锚点，代码围栏及围栏内连续空行保真。
- smoke 修复：`vault:create` 补 `initGit:true`；断言对齐当前 `EditorView`/`FrontmatterPanel`/`tag-node` DOM；rename/move/delete 改走真实 UI helper；最终 Electron smoke **83/83 PASS**（证据：`nexnote-build/smoke/DEV-019-gui/results.json`）。
- 主控门禁 @`849fa83`：typecheck PASS / 78 test files PASS（1 skipped，633 tests PASS / 2 skipped）/ eslint PASS / build PASS / release-config 28/28 PASS / changed-format PASS / diff-check PASS。一次全量运行出现 1 条瞬时失败，verbose 复跑与 post-merge 复跑均 633/633 PASS，未稳定复现。
- 双轴审查 @`849fa83`：fresh Standards **PASS**（4 minor，无 blocker/major）；fresh Spec **PASS**（1 minor，无 blocker/major）。首轮共同 minor（`stripBlockAnchors` 全局压缩会改变围栏内连续空行）已修复并补回归测试，按新 SHA 完整重审。
- post-merge master `2af0166`：typecheck / 633 tests（2 skipped）/ eslint / build / release-config / diff-check 全绿；Electron smoke 首跑 80/83（ABI rebuild 切换时序），立即重跑 **83/83 PASS**；随后恢复 Node ABI 并再次 633/633 PASS。
- 仍为 NOT_RUN 的仅是原 release checklist 中跨平台签名/公证/物理安装、真实网络自动更新、真实 Obsidian vault 导入等外部环境项目；本次 6 项 GUI 反馈与 smoke 存量失败均已收敛。


### DEV-018 — 已完成合并（2026-09-08）

- Merge commit `abf52c0`；候选 `dev/DEV-018@ef905ed`（44 files，+3572/−109；含原 agent 多轮修复 + 主控格式修复 + sync to master merge）；旧 `.wt/DEV-018`（`b86a6f2`）是历史 WIP 勿用。
- 实现：electron-builder 三平台配置（macOS dmg+zip arm64/x64、Windows nsis+portable x64、Linux AppImage+deb x64，asarUnpack dugite/better-sqlite3，entitlements + hardened runtime，GPLv2 source offer），electron-updater 三通道（stable/beta/alpha，AppStore 单一权威，readBakedChannel 烘焙通道，autoDownload 配置），renderer 设置页更新 UI（检查/下载/重启安装/通道切换/busy/错误提示），release CI（prepare → build 矩阵 → macos smoke → preflight → publish with release-qa environment + durable lease + QA evidence hash 校验 + tag 幂等），PR checks（lint/typecheck/test/build/verify-release-config/Linux unpacked build/changed-file formatting），Nightly（仅 macos 构建不上传 Release），verify-release-config.mjs（28 项结构/权限/密钥/lease 校验），release-evidence（不可变 QA JSON URL + sha256 + validateAttestation），merge-mac-update-manifests（mac 双架构 latest-mac.yml 合并），updater 15 测 + release-policy 4 测 + app-store 6 测 全通过，参数边界回归脚本 check-changed-format.sh + 5 组测试（--config=、--plugin=、空格、换行、空 diff）。
- 主控闸门 @ef905ed（worktree，已 sync master 114beea）：typecheck PASS / 66 test files passed（1 skipped，501 测通过）/ eslint PASS / build PASS / verify-release-config 28/28 PASS / changed-format 回归 PASS / diff-check PASS；main 包 tsc 仅 master 基线 2 错（Entry、GitStatus.conflict）。
- fresh fixed-SHA 双轴审查 @ef905ed：Standards PASS（3 minor：参数边界回归脚本未接入 CI、release 校验强度不对称、ipc-registrar 基线失败备注，无 blocker/major）+ Spec PASS（真实 Actions/签名/公证/三平台安装/N-1 网络更新 NOT_RUN 并附人工步骤，本地可验证项全部满足）。
- 修复迭代：f1289a3 → Standards FAIL (major: pr-check.yml prettier 数组注入) → 7446ab0 修复为 NUL 分隔 + `./` 前缀 + `--` 终止 + 回归测；同步 master 后 595db14 → Spec FAIL (major: 自身两文件未过新 Prettier gate) → ef905ed 格式化修复后通过。
- post-merge master `abf52c0`：typecheck / 66 test files(1 skipped) / eslint / build / release-config / changed-format 回归 全绿（main-tsc = 2 基线错）。
- NOT_RUN：真实 GitHub Actions 流水线端到端、macOS Developer ID 签名+公证+Gatekeeper、Windows Authenticode+SmartScreen、Linux GPG/deb 物理安装、三平台物理 smoke、N-1 真实网络自动更新；均按规格允许标注，并逐项给出人工验证步骤。
- 进度：**17 / 19**。剩余 DEV-016（修复 blocker/major 中）、DEV-019（E2E，最后）。

### DEV-016 — 已完成合并（2026-09-08）

- Merge commit `b7c6583`；候选 `dev/DEV-016-fresh@e9e4f04`（41 files，+4087/−276；含修复 agent 多轮迭代 + 主控 merge sync + UpdateChannel 去重 + Prettier 格式化）；旧 `.wt/DEV-016`（`aad90d6`）是历史 WIP 勿用。
- 实现：SettingsService（8 分类设置，全局/vault 两级持久化，normalizeStoredGlobal 写入时 prune 未知子字段，onChange 事件），settings-handlers IPC（setGlobal/setVault/setShortcuts/importShortcuts/search/saveExportFile），update-settings-sync（SettingsService.updates 单一权威 → diff-apply updater 运行态 + AppStore 镜像，app:setUpdate* 全部路由 SettingsService），vault-clone-controller（sender-scoped + TTL + one-shot + bounded 8/sender + resolveCloneTarget canonical 共享函数），vault-operations-controller（AbortController 生命周期注册，web-contents-created destroyed 接线 disposeSender），SettingsPage 8 分类 UI（GeneralSection 字体族/字号/主题/语言、GitSection、ShortcutsSection 可编辑+禁用+导入导出、UpdateSettingsSection、搜索输入框+结果跳转），首启动向导三路径（新建/打开含 Obsidian 检测+Git init opt-in/克隆授权预检+真实 status 返回），renderer shortcut-runtime（normalize/冲突检测/全局注册）。
- 主控闸门 @e9e4f04（worktree，已 sync master 106e1f7）：typecheck PASS / 71 test files passed（1 skipped，603 测通过）/ eslint PASS / build PASS / release-config 28/28 PASS / changed-format PASS / diff-check PASS；main 包 tsc 仅 master 基线 1 错（Entry；GitStatus.conflict 已由本票顺带修复）。
- fresh fixed-SHA 双轴审查 @e9e4f04：Standards PASS（1 minor：update-section.tsx 过时注释，无 blocker/major）+ Spec PASS（真实 Electron 对话框/网络克隆/重启保持/快捷键运行时生效 NOT_RUN 并附人工步骤，本地可验证项全部满足）。
- 修复迭代：aad90d6 WIP → 重建 fresh worktree 实现 → 842e445（strict-null 测试修复）→ 8980aed → Standards FAIL（blocker: clone token targetDir 不一致；major: Windows lsRemote /tmp、假 status、取消死代码、useSystemGit 双源、autoCommit 不回灌）+ Spec FAIL（blocker: clone token；major: 设置搜索无 UI、快捷键只读）→ 修复 agent 一轮修复全部 blocker/major → 8155972 → 合并 master 后 typecheck FAIL（UpdateChannel 重复导出）+ changed-format FAIL（19 文件未格式化）→ 主控修复（类型统一 + Prettier）→ 6ea04b0 → Standards FAIL（major: 更新设置双权威、sender 销毁未回收、GitSection 双写）→ 修复 agent 二轮修复 → 0129e35 → changed-format FAIL（3 文件未格式化）→ 主控格式化 → e9e4f04 双轴 PASS。
- post-merge master `b7c6583` + 集成修复 `68604c4`：typecheck / 71 test files(1 skipped, 603 tests) / eslint / build / release-config / changed-format 全绿（main-tsc = 1 基线错 Entry）。
- NOT_RUN：真实 Electron 对话框（新建/打开/克隆路径选择、Git 初始化确认）、真实网络克隆（ls-remote 授权预检 + 完整 clone）、重启后设置保持、快捷键运行时生效（真实 Electron 环境）、设置搜索 UI 人工验证；均按规格允许标注，并逐项给出人工验证步骤。
- 进度：**18 / 19**。剩余 DEV-019（E2E 验收与打磨，最后）。

### DEV-020 — 源码模式与单栈编辑器 — 已完成合并（2026-09-09）

- 票据 `issues/020-source-mode.md`（ADR-0004 + CONTEXT.md 术语已先行合入 `b16ea63`）；worktree `.wt/DEV-020` / 分支 `dev/DEV-020`。
- 主交付（首提交 `6ce348d`，47 files +2258/−649）：删除通用双 Pane（`splitEnabled`/`splitRatio`/divider/⌘K「切换左右分屏」及全部引用点），tab-store 单栈化 + `editorMode?: 'block' | 'source'` per-tab 临时态；新增 `editor/source/*`（SourceModeView / CodeMirror host / LivePreview 只读内核复用 / preview-scheduler 200ms 防抖+过期丢弃 / page-source-io 版本检查与冲突分类 / parse-guard / scroll-sync 单向滚动 / source-mode-toggle 三入口单一路径）；EditorView 头部按钮 + `Mod+E`（DEFAULT_SHORTCUTS `editor.toggleSourceMode`）+ 命令面板三入口，切换前 flush + 整页解析守卫，失败停留当前模式；字节保真 raw 写盘、H1↔文件名联动、预览 Wikilink 同 tab 导航保持源码模式、外部冲突 banner（保留本地/读取磁盘）。
- 首轮真实打包 smoke 92/102 → 根因定位与修复（次提交 `839baf5`，7 files）：
  1. **打开即写盘（字节被归一化）**：kernel `UniqueID` onCreate 给缺 ID 块补 ID 的初始化事务被 onUpdate 当作用户编辑调度防抖保存。修复：`block-id.ts` 增加初始化窗口门控（priority 10001/9999 双扩展夹住 UniqueID 1e4 的 onCreate，WeakMap 标记），`editor.ts` onUpdate 在窗口内早退。新增 kernel 回归测试（打开非常规 Markdown saved=[] / revision=0，真实编辑仍保存）。
  2. **预览 Mermaid 不渲染**：tokenizer `FENCE_RE` 只认 ``` 围栏。修复：同时接受 ```/~~~（开闭标记必须相同，混用拒绝；序列化仍归一 ```）。新增 builtin-blocks 回归测试 2 例。
  3. **入口 1 头部按钮 + 关闭重开一致**：smoke 陈旧 DOM 竞态（点击命中正在卸载的旧 tab 编辑器）。修复：按 `[data-path]` 限定等待与断言。
  4. **图谱 500/2000 精确相等 / timeline 首条 initial**：场景顺序敏感。修复：改为 ≥ seed 与「列表中存在 initial」。
  5. **smoke 假绿**：`app.quit()` 不携带 `process.exitCode`。修复：`app.exit(allPassed ? 0 : 1)`，空报告判失败；`SmokeController.finish` 行为由回归语义锁定（退出码经真实运行验证：失败 1 / 全绿 0）。
- 主控闸门 @`839baf5`：typecheck PASS / `CI=true pnpm test` 82 files 657 PASS（2 skipped）/ eslint PASS（1 个 master 既有 warning）/ build PASS / verify-release-config 28/28 / changed-format PASS / `git diff --check` PASS。
- fresh 双轴审查 @`839baf5`：Standards **PASS**（1 minor：UniqueID onCreate 同步时序属隐式耦合，建议后续改 transaction meta；4 nit）；Spec **PASS**（1–23 PASS，24 合并后流程）。
- post-merge master `0f14a49`：typecheck / 657 tests / eslint / build / release-config / changed-format 全绿；真实打包（unsigned dev，`NEXNOTE_NOTARIZE_MODE=disabled` + `CSC_IDENTITY_AUTO_DISCOVERY=false` + `--dir --publish never`）Electron smoke **102/102 PASS 退出码 0**（`smoke/DEV-020/results.json` + 19 张截图）；完成后已恢复 Node ABI。
- NOT_RUN：本票本地可验证项全部执行；外部/跨平台项沿用 release-checklist 第 6 节既有清单（三平台签名公证/物理安装、真实网络自动更新、真实 Obsidian vault 导入等），无新增。
- 进度：**20 / 20**。

## 本轮新增票据（2026-09-19）

基于 `grill-with-docs` 对翻译与知识库同步护栏的定案，新增三张票据：

- **DEV-058**: 知识库同步护栏 — 扩展 `.gitignore` 模板、所有 vault 入口幂等修复、staging 前二次拒绝、已跟踪违规文件 `git rm --cached`。
- **DEV-059**: 输入翻译工作台 — 独立面板、命令面板与划词工具栏 AI 下拉入口、200k 字符上限、目标语言选择器。
- **DEV-060**: 无思考 AI 请求加固 — 翻译请求在协议参数层显式关闭 thinking/reasoning，覆盖外部覆盖，并对输出做 `<think>`/`<analysis>` 残留清洗。

约束：每票独立 worktree + dev 分支；合入前必须通过 typecheck / test / lint / build / changed-format / diff-check 门禁。

## 翻译与知识库同步护栏轮次（2026-09-20，已合并）

- **DEV-058 知识库同步护栏**：候选 `a0e7094`（代码，经多轮双轴审查最终 PASS），集成提交 `48c1ca8`，master 合并 `7f83430`。覆盖：`.gitignore` 模板含 `.DS_Store`/`Thumbs.db`/`desktop.ini` 与 `.nexnote` allowlist；create/open/clone/startup restore 全部在 session 上线前执行幂等护栏；staging 前仅按叶子文件过滤、禁止目录递归、isolated index 隔离用户预暂存并 fail-closed；存量违规文件 `git rm --cached` 保留磁盘与历史；BOM/非 UTF-8 字节与用户规则 last-match 语义保留；Windows 跨盘/混合分隔符与祖先 symlink 防护；普通 `user.db` 不泛化屏蔽；跳过/迁移仅记数量日志。
- **DEV-059 输入翻译工作台**：代码候选 `17d6109`（HEAD `6a1633a`），净移植后 master 合并 `ab80b3d`。新增独立临时工作台（命令面板 + 块/Markdown 划词 AI 下拉，预览视图无入口）；三入口显式提交、切换语言不自动请求；全局默认 + 当次临时目标语言；独立翻译 Profile（回退 writing/默认）；共享 200k 上限与剩余额度提示；runId 缓冲/取消/迟到事件隔离；只读不落盘。
- **DEV-060 无思考 AI 请求加固**：候选 `0a68725`，master 合并 `4073b42`。翻译 `reasoning_effort=none`（流/非流、OpenAI/Azure），屏蔽 reasoningDelta，流式/未闭合 `<think>`/`<analysis>` 跨 chunk 清洗且普通文本保真；provider 拒绝参数显式失败不静默重试；非翻译场景零影响。
- **门禁**：post-merge master 六门禁 PASS — typecheck、full test `156 files / 1463 tests passed (2 skipped)`、lint `0 errors / 4 pre-existing warnings`、build、changed-format、`git diff --check`。
- **NOT_RUN**：Electron packaged smoke（macOS 打包产物）、真实 provider 翻译端到端、Windows/Ubuntu 物理安装；未虚报。

- **v0.0.17 正式发布（2026-09-20）**：因 v0.0.16 自动 Release run 在 Windows 上暴露 4 个跨平台测试问题，immutable `v0.0.16` 保留为失败候选、不移动 tag；v0.0.17 在候选 `b713c2a` 上修复 Windows 文件名/symlink/slash 测试兼容与 toolbar ARIA tooltip 稳定性。候选本地六门禁 PASS（156 files / 1463 tests passed，2 skipped），macOS arm64 packaged smoke **261/261 PASS**；QA evidence 提交 `d86e623`。tag-push Release workflow `35483630301` 的 prepare、4×build、smoke、preflight 全部 success，经 `release-qa` Environment 审批后 publish success。GitHub Release v0.0.17 为 stable、non-draft、non-prerelease，published `2026-09-20T02:52:23Z`：https://github.com/Aiden-FE/nexnote/releases/tag/v0.0.17；公开资产 17 个，`SHA256SUMS` 与 Release asset digest 已回读一致。v0.0.15 同样经过 release-qa gate；当时使用 workflow_dispatch 并由有权限身份通过 API 审批，本次 tag push 初始等待人工网页审批是预期行为，不是流程偏差。

## 编辑器 UI 修正轮次（2026-09-20，已合并）

- **DEV-061 统一左侧 gutter**：候选 `61f5d09`，master 合并 `bb8ae20`。折叠 chevron 从 heading 内 widget 迁移到 host 级 gutter overlay（`packages/kernel/src/editor/unified-gutter.ts`），chevron 常显、拖拽手柄 hover 显示于其左列；左内边距 3.75rem 双列，移除 heading `padding-left:1.55em`；拖拽手柄去掉 `translateX(-1.9rem)`，改 Floating UI `offset` middleware + `::before` 热区桥接。
- **DEV-062 slash/suggestion 视口约束**：候选 `4c305dd`，master 合并 `702958b`。共享 `menu-viewport.ts`（max-height + 内部滚动 + 底部翻转 + active scrollIntoView），PM slash、CM slash、suggestion 三处接入。
- **DEV-063 划词工具栏 Lucide SVG 图标**：候选 `dacd53f`，master 合并 `1a8c2c0`。kernel `defaultBubbleIconRenderer`（createElementNS、无 innerHTML）+ 渲染层单一 `selectionBubbleIconRenderer` 注入 PM/CM；strike 对齐主工具栏，AI chevron SVG 垂直居中；wikilink fallback `[[]]`。
- **DEV-064 VS Code 风格折叠交互**：候选 `c58a27e`，master 合并 `371909c`。折叠态不再降透明度；块编辑行尾可点击 `…` + hover ghost preview；源码模式 placeholder 升级为可点击；快捷键 `Mod+Shift+[`/`]` 折叠/展开当前章节（`Mod+K Mod+L` chord 因 ShortcutRuntime 不支持序列而延后，ADR-0013 已记录）；命令面板新增折叠/展开/切换当前章节与折叠到 H1/H2/H3，不做 Fold All。
- **双轴审查（c360f75..4a72bef）**：Standards 发现 S5（源码 slash 菜单 place() 覆盖视口翻转结果）等 7 项、Spec 判 DEV-064 PARTIAL（chord 假绑定）；修复提交 `d76e1a0`（S5 视口覆盖、V1 fold opacity 残留、S2 重名导出合并、S6 死代码移除、S7 clip 语义、chord 声明移除）。审查 Agent 独立执行，主 Agent 逐项验证。
- **门禁**：post-merge master 六门禁 PASS — typecheck、full test `158 files / 1480 tests passed (2 skipped)`、lint `0 errors / 4 pre-existing warnings`、build、changed-format、`git diff --check`、release-config 31/31。
- **v0.0.18 发布候选**：bump `9ac5f1a`；macOS arm64 Ad hoc 打包（Electron 44.2.0、ABI 149 staging + `-c.npmRebuild=false`），packaged smoke **261/261 PASS**（`NEXNOTE_SMOKE_TIMEOUT_MS=360000`，候选 SHA 绑定）；QA evidence 提交 `d149aa4`。
- **NOT_RUN**：Windows/Linux packaged smoke、物理安装验证、N-1 网络升级、发布后 24h 监控；未虚报。

## v0.0.18 失败候选与 v0.0.19 发布（2026-09-20）

- **v0.0.18（immutable tag 保留为失败候选，同 v0.0.16 先例）**：本地六门禁与 macOS arm64 packaged smoke 261/261 全 PASS（evidence `d149aa4`，后修正为 40-hex commit 的 `ffa17f7`），但 Release workflow `35503808844` 的 preflight 两次失败——首次失败时 `RELEASE_QA_EVIDENCE_URL` variable 尚为旧值（workflow 启动后我更新了 variable，但 run 内 prepare 输出仍绑定旧 URL）；rerun 后 evidence JSON 的 `commit` 字段只写了 7 位 short SHA 与 40 位 hex 校验不符。两次根因均不涉及构建/测试质量。tag v0.0.18 不移动，不发布 GitHub Release。
- **v0.0.19（正式发布）**：由另一分支在同一 master 基础上完成 DEV-066/067（设置页 Switch 视觉、工具栏 tooltip 裁切）后以 `e159c3c` bump、`415e4fb` evidence、`fdad503` 收尾，Release workflow `35506878662` 全绿，GitHub Release v0.0.19 为 stable/non-draft，17 资产含 SHA256SUMS。**v0.0.19 完整包含本轮 DEV-061~065 全部修复**（已在 v0.0.19 tag 树中逐文件验证：unified-gutter.ts、menu-viewport.ts、selection-bubble-icons.ts、fold-actions.ts 均存在且关键代码到位；globals.css 无 `.nexnote-folded` opacity 残留；drag-handle 使用 Floating UI offset 而非 translateX hack）。
- 本轮目标（拆票 DEV-061~065、实现全部目标、release 新版）由 v0.0.19 满足；v0.0.18 按惯例保留为失败候选记录在案。
