# DEV-082 单人 vault auto-rebase 在 config.json 上的自死锁与 todo 搅乱

- 状态：done（v0.0.23）
- 范围：packages/shared, packages/main, packages/renderer
- 来源：用户反馈 2026-09-22（单人本机 my-wiki 自动 rebase 冲突）

## 背景

单人本机使用 NexNote，git 状态也会自己跟自己冲突：

1. 网络通，`git fetch` 直连 GitHub 成功。
2. 真阻塞：NexNote 在跑，自动同步策略 = rebase。在「rebase 到 origin/master」期间卡在
   `.nexnote/config.json` 的合并冲突上，无法完成。
3. 更糟：rebase 进行中 NexNote 又自动保存了两次（`nexnote:auto: 保存知识库布局`），
   把 todo 顺序搅乱，工作区也留下了新的未暂存改动。

## 根因（已逐项验证）

1. `.nexnote/config.json` 在 `VERSIONED_NEXNOTE_FILES` 白名单（`git-service.ts:33`），
   任何 `commit()` 都把它带走。远程 `origin/master` 的 config.json 缺
   `settings.git.autoSyncIntervalSec / syncStrategy`，本地有；双方各自演化后每次
   `git rebase origin/master` 必然停在 config.json 的内容冲突上。
2. rebase 卡在 `.git/rebase-merge/` 期间，`commitAuto()` 的 30s 防抖计时器未被取消
   （`cancelAutoCommit()` 只在 `pull()`/`sync()`/vault 切换时触发）。每 30s 再叠一个
   layout 自动提交，把 todo 序列和未暂存改动全部搅乱。
3. `GitSyncDoctor` 只接受 `commit | pull | push` 三个 action，没有 abort rebase 入口；
   用户只能手动 `git rebase --abort`/`git rebase --skip`，违反「不假设用户懂 git」定位。

## 实施任务

### A. 主进程检测与阻断（git-service.ts）
1. 新增 `isRebaseOrMergeInProgress(root)` — 检查 `rebase-merge/` `rebase-apply/`
   `MERGE_HEAD` `REBASE_HEAD` 任一存在，纯只读。
2. `commitAuto()`/`commitManual()` 早期护栏：检测到 rebase/merge 进行中直接返回
   `notified(...)`，不进入 `commit()`，并推送 status 给 renderer。
3. `scheduleAutoCommit()` 入队时复用同一探测；到点触发后再确认一次。
4. 新增 `abortInProgressRebaseOrMerge()`：`git rebase --abort`（或 `git merge --abort`），
   只允许在 doctor 票据 + TOCTOU 校验通过后调用。

### B. doctor 入口（git-sync-doctor.ts + types/git.ts）
5. `GitRepairAction` 白名单追加 `'abort-rebase-or-merge'`，命令预览
   `git rebase --abort (或 git merge --abort)`，不写工作区、幂等。
6. `classifySyncIssue()`：rebase/merge in progress 且无 index 冲突时返回
   `category: 'conflict'`、`code: 'REBASE_IN_PROGRESS'`，复用现有 conflict 引导。
7. `execute()` 增加 abort 分支，走 TOCTOU 校验；rebase 期间禁止 prepare pull/push。

### C. 共享契约（ipc/channels/git.ts）
8. `GitStatus` 加 `rebaseInProgress: boolean`（默认 false，向后兼容）。
9. `statusFor()` 调用 `isRebaseOrMergeInProgress(root)`，复用 notified 推送链路。

### D. 渲染层（features/git/index.tsx）
10. 在现有 conflict 徽标旁增加 amber 色 `<span data-testid="status-git-rebase">`，
    hover 文案「存在未完成的 rebase/merge」。
11. DoctorDialog 在 rebaseInProgress 时显示「中止 rebase 并继续」按钮（action 可用时）。

### E. 减小 blast radius
12. `commitAuto()` 对只触动 config/layout 且相对 HEAD 无字节变化的提交做空内容跳过
    （HEAD blob sha 比对），削减「多个布局提交只改 config.json」复发模式。

### F. 测试
13. `git-service.test.ts` 新增 3 例：rebase 中 commitAuto 拒绝、scheduleAutoCommit 入队
    no-op + status 通知、abort 清理 rebase-merge 回到干净 HEAD。
14. `git-sync-doctor.test.ts` 新增 2 例：diagnose 分类 REBASE_IN_PROGRESS、
    prepare+execute abort 不触碰工作区。
15. 渲染层加 `status-git-rebase` badge 渲染用例。

## 验收
- [x] rebase 进行中不再产生新的 auto commit
- [x] doctor 可识别 rebase-in-progress 并提供一键中止
- [x] 状态栏显示 rebase 徽标
- [x] `pnpm typecheck` 0 errors；`pnpm lint` 0 errors
- [x] 新增 5 例全绿；既有 git 测试全绿；`pnpm build` PASS

## 不做的事
- 不把 config.json 移出 VERSIONED_NEXNOTE_FILES（ADR 0003 契约，需新 ADR）
- 不引入 git rerere / branch.master.rebase 配置
- 不改 pull() 默认 --no-rebase
- 不做 force-push 或 reset

## 测试与门禁证据

- `pnpm typecheck`：新增/改动文件 0 errors；master 上预先存在的 6 个不相关错误
  （`system-proxy.ts`、`openai.ts`、`native-binding.test.ts`、`git-service.test.ts(409)`、
  `git-sync-doctor.test.ts(276)`、`git-service.ts(709)` 的 `git.rebase` 调用）保持不变。
  本分支顺带修复了 master 上两处 `STATUS_FAILED` 未声明在错误码 union 的预存在编译错误。
- `pnpm --filter @nexnote/main exec vitest run`：**623 passed | 2 skipped (625)**，
  含 DEV-082 新增 4 例（git-service）和 5 例（git-sync-doctor），全部 PASS。
- `pnpm lint`：0 errors，仅 7 个 master 上原有的 import() type warnings。
- `pnpm build`：PASS，renderer + main 全包构建成功。

### 新增测试
- `packages/main/tests/git-service.test.ts`：
  - `commitAuto 在 rebase 暂停时拒绝创建提交，不修改 HEAD`
  - `scheduleAutoCommit 在 rebase 暂停时调度窗口不落地为提交`
  - `abortInProgressRebaseOrMerge 清理 rebase-merge/ 并回到干净 HEAD`
  - `abortInProgressRebaseOrMerge 在没有进行中操作时抛 NO_OPERATION`
- `packages/main/tests/git-sync-doctor.test.ts`：
  - `classifySyncIssue 在 rebaseInProgress 时返回 REBASE_IN_PROGRESS，conflict 字段不抢占`
  - `诊断 rebaseInProgress 时 plan.action 命中 abort-rebase-or-merge`
  - `诊断无 rebaseInProgress 时 plan.action 为 null（保持旧 conflict 引导）`
  - `prepare(abort-rebase-or-merge) 在 conflict 状态下以前会被拒绝，现在允许`
  - `execute 期间 rebase 已自然结束 → NO_OPERATION，doctor 不再触发 abort`
- `tests/git-service.test.ts` 的 rebase fixture 直接手工伪造 `.git/rebase-merge/`：
  - `setupPausedRebase()` 写入 `head-name` / `onto` / `orig-head` / `msgnum`，跳过
    不稳定的「真实冲突 rebase」路径。
  - 这避免了在无 TTY 的 CI 环境下 3-way merge 自动成功导致的 flake，并精确
    控制 fixture 的状态机语义。
