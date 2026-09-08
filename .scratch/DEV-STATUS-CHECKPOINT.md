# NexNote 开发票据暂停检查点

> 暂停于第 70 轮。恢复时先读取本文件、`.scratch/orchestration-ledger.json`、`.scratch/nexnote-build/README.md` 及对应 issue/worklog；随后 `get_goal` 并按用户指令 `update_goal resume`。
>
> 任何票据只有在 **clean fixed SHA + current master ancestry + 主控 typecheck/test/lint/build/diff-check + fresh Standards PASS + fresh Spec PASS + merge + post-merge verify** 后才算完成。

---

## 0. 最新状态（持续更新，优先于下方陈旧冻结段）

- **真实进度：18 / 19** —— DEV-001~DEV-015 + DEV-016 + DEV-017 + DEV-018 已合入 master。
- master HEAD：`68604c4`（DEV-016 merge + 集成 tsc 修复）；post-merge typecheck / main-tsc（仅 1 个基线错 Entry）/ 71 test files passed(1 skipped, 603 tests) / eslint / build / release-config / changed-format 全过。
- 子Agent 派发工具 `multi_agent_v1__spawn_agent` 在本环境返回 unsupported，按用户接管规则由主控直接在隔离 worktree 实现。
- better-sqlite3 ABI：vitest 用 Node ABI；electron smoke 用 `runtime=electron target=44.2.0 arch=arm64`，smoke 后务必切回 Node ABI。
- Electron smoke 当前环境基线 **60/69**：9 项失败为 DEV-003/004/006/007 既有环境基线（Git 状态栏 2、新笔记 frontmatter/面包屑 2、标签面板/过滤 2、重命名 wikilink 1、500 节点 FPS 1、时间线 1）；master 与候选失败集逐名一致，DEV-010 无新增回归。

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
