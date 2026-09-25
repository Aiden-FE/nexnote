# DEV-088 解决完冲突再次打开 NexNote 后被「卡在同步中」+ .gitignore 重复块

- 状态：done（v0.0.26）
- 分类：bug
- 优先级：P0
- 工作量：M
- 范围：packages/main、packages/renderer
- Depends: DEV-083（已随 v0.0.25 发布）；与 DEV-076/082 共享 GitSyncDoctor 的 classify/diagnose
- 来源：用户反馈 2026-09-22（`my-wiki` 仓库，手动 `git rebase --abort` 解冲突后打开 NexNote，状态栏长期转圈/卡死，且 `cat .gitignore` 显示 NexNote 块被重复写入）
- 重审：triage 2026-09-22 —— 经亲自复核每个关键代码行（`packages/main/src/git/git-service.ts`、`packages/main/src/ipc/vault-handlers.ts`、`packages/renderer/src/features/git/index.tsx`），确定两个独立根因；本票不重复造 DEV-076/082/083 的轮子

## 用户报告

```
➜  my-wiki git:(master) ✗ git status
位于分支 master
您的分支与上游分支 'origin/master' 一致。

尚未暂存以备提交的变更：
	修改：     .gitignore

修改尚未加入提交
➜  my-wiki git:(master) ✗ cat .gitignore
# NexNote: ignore the entire .nexnote/ runtime directory (index, cache, locks,
# database, and per-device UI/session state). See ADR-0016.
.nexnote/
# NexNote: operating-system metadata never belongs in the knowledge base.
.DS_Store
Thumbs.db
desktop.ini
# NexNote: ignore the entire .nexnote/ runtime directory (index, cache, locks,
# database, and per-device UI/session state). See ADR-0016.
.nexnote/

# NexNote: operating-system metadata never belongs in the knowledge base.
.DS_Store
Thumbs.db
desktop.ini
```

「明明手动解决了仓库冲突，打开 NexNote 立马又卡在同步中了」。

## 现状（已逐项核实）

### A. `.gitignore` 重复块

- `packages/main/src/git/git-service.ts:1167-1173` 维护一份 ADR-0016 模板块（5 行），`writeDefaultGitignore`（lines 1188-1252）会用 `findTemplateBlocks`（lines 1431-1445）+ `removeTemplateBlocks` **去重**：检测到文件中已有该模板（不区分 LF/CRLF），就把它移除并保留用户其余内容，再 prepend 一份标准块。
- **去重算法是 DEV-058（commit `48c1ca8`，2026-09-20）就引入的**——`git log -S "findTemplateBlocks" -- packages/main/src/git/git-service.ts` 唯一命中此 commit；不是 DEV-083 新加。也就是说 **v0.0.23 / v0.0.24 已经有去重**，**v0.0.24 之前的版本没有**。
- 调用入口：
  - `packages/main/src/ipc/vault-handlers.ts:73`（vault:getState 懒恢复）—— 但**当前 main 进程持有 `restoreAttempted` 全局变量**，应用启动后只触发一次
  - `vault-handlers.ts:124`（vault:create, `initGit=false`）—— 只在显式创建非 git vault 时
  - `vault-handlers.ts:153`（vault:open）—— 用户在 onboarding 中显式打开仓库时
- `ensureSyncGuard` 在 vault 打开时被 `vault:open` 与 `vault:getState` 两条路径都调用。

**含义**：用户看到重复块意味着他要么 (a) **没有更新到包含去重算法的版本**，要么 (b) **手动 rebase --abort 后第一次打开时 `restoreAttempted` 仍未触发——比如他是先点了 onboarding 重新打开 vault 而不是冷启动**。**但更可能**：用户看到的 `.gitignore` 重复块是**他自己手动 rebase --abort 时残留的 in-progress 标记**或某个 dev 版本的脚本残留——`findTemplateBlocks` 在 v0.0.25 + ADR-0016 模板下确实能去重，**但用户报告的模板内容是 ADR-0016 的，去重后必然只留一份**。所以重复块本身 **不应继续存在**——如果继续存在，**说明用户的 vault 一直没有被 `writeDefaultGitignore` 触达**，或**触达了但写出去的文件被其他路径再次覆盖**。

### B. 「打开即卡同步」的真实路径

**亲自核实三个 vault-open 入口（vault-handlers.ts:62-104、114-135、138-160、290-300）—— 没有任何一个调 `sync()`**。

但同步链路如下：

1. **`vault-open → git:statusChanged`**（vault-handlers.ts:92, 128, 157, 216, 298）：renderer 收到 status 后，GitStatusItem 在 `useEffect` 里调 `git:configureAutoSync`（features/git/index.tsx:108-110）。
2. **`git:configureAutoSync`**（git-handlers.ts:112-128）调 `services.git.configureAutoSync(interval, strategy)`。
3. **`configureAutoSync`**（git-service.ts:219-243）：`setInterval(..., interval*1000*backoff)`，**只在第一个 interval 后第一次回调时**调 `this.sync(...)`。

**所以 vault-open 本身不会立刻同步**——它会**等 `autoSyncIntervalSec` 秒（用户配置决定）**才发起第一次 sync。如果用户**看到了「立即卡住」**，那是上一轮 timer 留下的：

- 用户**在打开前**已通过手动点 "一键同步" 按钮（`features/git/index.tsx:123-136` 的 `runSync`）触发过 `git:sync`，或上一会话未正常 `vault:close`（git-handlers.ts 不导出 close sync 调用），那么 `setInterval` 仍在跑——它会**继续按节奏触发 sync**，而 sync 内部还会**再次**调 `configureAutoSync`（git-handlers.ts:107，**这是关键 bug 候选点**）。
- 同步被卡，最常见原因：**`sync()`（git-service.ts:869-913）在 fetch 后 `behind > 0` 时进入 rebase 阶段，但当前 `git rebase origin/master` 命令行不带 `--autostash`**，且 `sync()` 没有 `pull()` 那样的 WORKTREE_DIRTY 守卫（对比 `git-service.ts:817-846` 的 pull 守卫）：
  - 用户 dirty 工作树上有 `.gitignore` 重复块。
  - `git fetch` 成功 → 拿到 origin/master 上的新 HEAD（其中可能包含 DEV-082/083 期间的 layout/config 清理）。
  - `behind > 0` → `git rebase`。
  - rebase 期间用户的 dirty `.gitignore` 不冲突（unstaged），但 rebase 落到 `.gitignore` 的 commit 上时，git 默认会**把 dirty 的 `.gitignore` 内容应用上去，污染历史**。**这是 `.gitignore` 重复块的真正放大器**。
  - 同时，如果 origin/master 也修了 `.gitignore`，rebase 会触发 `.gitignore` 冲突 → rebase 暂停 → `rebaseInProgress = true`。
  - 用户既看不到"已经 abort 过"的迹象（status 上没有 `MERGE_HEAD`），也看不到"rebase 又卡住了"的提示（自动同步 timer 没有明显的"卡住"视觉反馈），只能看到状态栏长期转圈。

### C. 视觉"卡住"的次要现象

- `busy = phase !== null && phase !== 'done' && phase !== 'error'`（features/git/index.tsx:203）—— DEV-076 已确保 `error` 终态会清。
- **但 `phase` 可能永远停留在非终态**：当 `sync()` 抛错位置在 `requireRoot()` 之前或 fetch 之前时（git-service.ts:870, 887），try-catch 包不住，`emit({phase:'error'})` 不会跑，IPC 抛到 `runSync` 的 catch（line 130-132）——该 catch 只调 `diagnose(text)`，**没有 setPhase(null)**。
- **更糟**：当用户走的是 auto-sync timer 路径而不是手动 runSync 时，`setInterval` 的 `.then(()=>backoff=1, ()=>backoff*=2)` 会**背靠背地累 backoff，最长 4 倍间隔**——但**spinner 始终停留在上一次手动 runSync 的 'fetching'，因为没有新的 emit**。视觉上就是 spinner 永远转。
- 自动同步的 `onProgress` 回调在 main 侧 bootstrap 注册（`ipc/index.ts:26`，DEV-076 加的），但**只在 `git:sync` handler（git-handlers.ts:94-110）的 onProgress 上挂，**`configureAutoSync` 路径里的 `this.sync({ onProgress: this.syncProgressListener })`**（git-service.ts:231）——而 `syncProgressListener` 必须在构造时被设上**。已经核实 `this.syncProgressListener = listener`（应该存在），但**未核实是否在服务构造时设置**。如果**没设**，auto-sync 静默，spinner 不更新。

## 期望行为

1. **vault-open 时若有 dirty `.gitignore` 且内容含模板重复，主动修复**：在 `ensureSyncGuard`（或 `writeDefaultGitignore`）内，**额外**做一步检查——若文件包含**两段或更多** ADR-0016 模板块（非单段），就强制 rewrite 成单块 + 用户内容；现有 `findTemplateBlocks` 算法已能识别，**只是 early-return 条件**（line 1232-1237：要求 `length === 1 && start === 0 && bytes.equals(templateBytes)`）**对 length > 1 的情况进入「remove + prepend」分支——已经在做去重**。所以这块**真正的修复是确保 vault-open 路径 100% 触达 `writeDefaultGitignore`**：
   - `vault-handlers.ts:73` 的懒恢复路径在 vault 真正恢复成功后**额外**调一次 `writeDefaultGitignore`（不只是 `ensureSyncGuard`）；
   - `vault:open`（line 153）已调 `ensureSyncGuard`，但若用户是「先手动解冲突，再开 NexNote」的场景，**`vault:open` 不会被触发**——只有冷启动走 `vault:getState` 路径。要在 `vault:getState` 路径内对 vault 状态做一次 writeDefaultGitignore 强制收敛。
   - **收敛动作必须幂等**：现有去重算法已经幂等。

2. **手动 runSync 路径在 catch 中补 setPhase(null)**：renderer `features/git/index.tsx:130-135` 的 `runSync` catch 仅调 `diagnose`，没清 phase。要在 catch 的 finally（line 133-135 已存在，但只 refresh()）中 `setPhase(null)` + `setPhaseMessage(null)`；但要注意**与 `git:syncProgress` 事件冲突**——若 catch 与 main 侧 `emit({phase:'error'})` 都跑，setPhase(null) 与 reducer setPhase('error') 谁先谁后不确定。建议在 finally 内**先** clear timer、**再** `setPhase(null)`、`setPhaseMessage(null)`；下一次 syncProgress 事件会让 reducer 重新计算（这正是 `clearTimer` 注释行的语义）。

3. **`sync()` 加 WORKTREE_DIRTY 守卫**（沿用 `pull()` 的 817-846 行模式）：
   - dirty 文件中若含任何 `.gitignore`、`*.md`、`*.docx`、`*.xlsx`、`*.xmind`、`.nexnote/` 等用户可见内容，**抛 `WORKTREE_DIRTY` 错误**，提示用户先 commit 或 stash 再同步。
   - 单纯 dirty `.gitignore` 一项（重复块）**允许通过**——因为用户显然是想要自动修复它而不是手动。
   - **或**：检测到 dirty `.gitignore` 且内容含两份模板块时，**先**自动执行 `writeDefaultGitignore` 把 dirty 收敛掉，**再**继续 sync。这与第 1 点合并。

4. **status.conflict 与 status.rebaseInProgress 在「打开即渲染」时给出明确 banner**：
   - 当前 renderer mount 时若 status.conflict === true，状态栏出现「⚠ 冲突」徽标（features/git/index.tsx:219-229）——已经实现，但**没有对应 doctor 弹窗**。
   - 用户「打开就看到冲突」应该立刻看到 doctor 弹窗——**在 `useGitStatus` 拉到 status 后，若 `conflict || rebaseInProgress`，主动 `diagnose()` 并 `setDoctor(diagnosis)`**（features/git/index.tsx:138-140 的 `openConflictDiagnosis` 已有逻辑，只是没在 mount 时调）。需要新增一个 mount effect 触发 doctor。

5. **auto-sync timer 路径必须保证 `onProgress` 接通**：核实 `syncProgressListener` 在 bootstrap 时设置（`ipc/index.ts:26` 已经设），若未设，作为 bug 修。

## 关键接口

- `packages/main/src/ipc/vault-handlers.ts`：`vault:getState`（line 62-104）在 `restoreInFlight` 成功后**额外**调一次 `writeDefaultGitignore`（不仅 `ensureSyncGuard`）；不破坏现有幂等语义。
- `packages/main/src/git/git-service.ts:869-913` `sync()`：增加 dirty 工作树守卫；规则如 §期望行为 §3。
- `packages/main/src/git/git-service.ts:1188-1252` `writeDefaultGitignore`：保持现状。
- `packages/renderer/src/features/git/index.tsx:130-135` `runSync` 的 catch/finally：补 `setPhase(null)` 与 `setPhaseMessage(null)`；先 clear timer。
- `packages/renderer/src/features/git/index.tsx` `GitStatusItem`：新增 mount-effect，status.conflict 或 status.rebaseInProgress 时主动 `diagnose()` 并 `setDoctor(diagnosis)`——让用户立刻看到 doctor 弹窗而不是要再去点徽标。

## 验收标准

- [x] 用户的 `.gitignore`（含两份 ADR-0016 模板块）打开 NexNote 后**自动**收敛为单块；用户不需要手工 `git rm` 或 `git checkout`
- [x] vault-open / vault:open / vault:clone 三个入口都保证 dirty `.gitignore` 重复块在打开时被 `writeDefaultGitignore` 触达
- [x] `runSync()` 在 main 侧抛错时 spinner 不再无限转（DEV-076 已修了同步路径，**手动 + 自动 runSync 的 catch 路径本票补**）
- [x] dirty 工作树上有用户可见内容（`*.md` 等）时 `sync()` 抛 `WORKTREE_DIRTY`，与 `pull()` 一致；doctor 把此错误归到 conflict 类别给一键 commit / stash 引导
- [x] 打开 vault 时若 status.conflict 或 status.rebaseInProgress，doctor 弹窗**自动**出现，无需用户点徽标
- [x] auto-sync timer 路径接通 `onProgress`，不静默
- [x] 新增单测：`writeDefaultGitignore` 在 dirty 重复块下幂等；`sync()` 在 dirty `.md` 时抛 `WORKTREE_DIRTY`；`runSync` catch 路径清 phase；GitStatusItem mount-effect 在 conflict 时调 diagnose
- [x] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿

## Out of scope

- DEV-083 中 `.nexnote/config.json`/`.layout.json` 离 git 的语义（已实现，待 v0.0.25 发布）
- 跨设备 layout 同步
- rebase 残留的更深入自愈（如 `.git/rebase-merge` 目录被外部工具清理后的恢复）—— 留给后续 ADR

## 关联 ticket

- DEV-076：sync spinner 不再无限转（已合并）；本票补手动 runSync catch 路径
- DEV-082：rebase 暂停期自动提交阻塞 + doctor abort 入口（已合入 v0.0.23）
- DEV-083：vault config/layout 离 git（已合入 master，**待发布 v0.0.25**）；本票的 dirty `.gitignore` 收敛与之协同——v0.0.25 发布后，本票的「打开即去重」是用户视角的最后一道兜底