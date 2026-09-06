# NexNote 开发票据暂停检查点

> 暂停于第 70 轮。恢复时先读取本文件、`.scratch/orchestration-ledger.json`、`.scratch/nexnote-build/README.md` 及对应 issue/worklog；随后 `get_goal` 并按用户指令 `update_goal resume`。
>
> 任何票据只有在 **clean fixed SHA + current master ancestry + 主控 typecheck/test/lint/build/diff-check + fresh Standards PASS + fresh Spec PASS + merge + post-merge verify** 后才算完成。

---

## 0. 最新状态（持续更新，优先于下方陈旧冻结段）

- **真实进度：11 / 19** —— DEV-001~DEV-011 已全部合入 master。
- master HEAD：`993fe82c6c4d07202a4d153c9539f91f8391ccf2`（merge DEV-011），clean；post-merge typecheck/eslint/402 tests(2 skipped)/build 全过。
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

### 下一张：DEV-012 AI 对话 dock 与会话即页面（依赖 DEV-009+011 均满足）
- 新建 worktree `.wt/DEV-012`（从 master）；票据 `issues/012-ai-chat-dock.md`。
- 要点：对话 dock 正式化（替换 AiChatDebug）、会话即页面/会话持久化、回答内联 RetrievalSources（复用 DEV-011）、回答插入块（复用 DEV-010 insertIntoActiveEditor）。


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
