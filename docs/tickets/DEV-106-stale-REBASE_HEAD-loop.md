# DEV-106 孤立 REBASE_HEAD 被判为 rebase 进行中 → Doctor 无限 NO_OPERATION 循环

状态：fixed（2026-10-08）
分类：bug
优先级：P0（同步/提交被完全锁死）
范围：packages/main（Git 状态检测）、packages/renderer（DoctorDialog 错误展示）
关联：DEV-076、DEV-082、DEV-088、DEV-104
来源：用户反馈 2026-10-08（另一台设备 `my-wiki` 工作区干净、无 rebase，但启动后持续弹「存在未完成的 rebase/merge」；`preserve-local-and-abort` / `force-abort` 每次都报 `当前没有进行中的 rebase 或 merge`，形成死循环）

## 现象

- 用户终端证据：`git status` 干净、分支与 `origin/master` 一致、无 rebase/merge 进行中。
- 应用内：`status.rebaseInProgress=true` → Doctor 分类为 `REBASE_IN_PROGRESS` → 弹窗推荐 abort 系操作。
- 执行结果：`GitService.abortInProgressRebaseOrMerge()` / `preserveLocalAndAbortRebaseOrMerge()` 抛 `NO_OPERATION`（“当前没有进行中的 rebase 或 merge”）。
- 弹窗不显示错误文本，用户感知是“点击无效”；重新诊断又复现同一循环。

## 根因

1. **状态检测与操作集合不一致。**
   - `isRebaseOrMergeInProgress()` 的 marker 是 `[rebase-merge, rebase-apply, MERGE_HEAD, REBASE_HEAD]`。
   - `abortInProgressRebaseOrMerge()` / `preserveLocalAndAbortRebaseOrMerge()` / `resolveConflictAndContinue()` 只认 `[rebase-merge, rebase-apply, MERGE_HEAD]`。
   - 于是：**有 REBASE_HEAD、无另外三个标记** → 状态层报“进行中”，操作层报“没有操作”，自相矛盾。
2. **REBASE_HEAD 不是“进行中”标记。** 它只是 rebase 停留期间指向最近 checkout 提交的伪引用，可能在 rebase 机制结束后残留。真实 git 验证：孤立 `REBASE_HEAD` 下 `git status` 完全干净、porcelain 为空，git 本身不认为任何操作在进行中。`rebase --abort` 正常也会清理它。
3. **弹窗吞错。** `GitStatusItem` 的 `runRepair` catch 里 `setError(text)`，但 `<DoctorDialog>` 从未接收 `error` prop，也不渲染它 → 用户看不到 `NO_OPERATION`，只能反复点击。

## 修复

1. `isRebaseOrMergeInProgress()` 的 marker 改为 `[rebase-merge, rebase-apply, MERGE_HEAD]`，与 git 语义和 abort/resolve 操作集合一致；`REBASE_HEAD` 从此不再参与“进行中”判定。孤立的 `REBASE_HEAD` 文件保留在磁盘上也不会影响状态（它是无害残渣）。
2. `DoctorDialog` 新增 `error` prop 并渲染 `text-destructive` 错误行，修复“点击无效果”的感知问题。
3. `runRepair` 捕获 `NO_OPERATION` 后自动 `diagnose(text)` 重新取当前状态，不再让用户基于过期计划反复尝试同一个必然失败的动作。

## 验证

- 真实 git 夹具验证：孤立 `.git/REBASE_HEAD` + 干净工作区 → `git status --porcelain` 为空，`status.rebaseInProgress=false`，`operationInProgress=false`。
- 新增单测 `git-service.test.ts > 孤立的 REBASE_HEAD 不再被误判为 rebase 进行中（DEV-106）`。
- 新增组件测试 `git-status-item.test.tsx > NO_OPERATION 后重新诊断并在 DoctorDialog 展示错误（DEV-106）`，断言错误文本可见且自动重新诊断。

## 用户侧影响 / 修复后的行为

- 受影响设备升级后启动：不再弹「存在未完成的 rebase/merge」假诊断，Git 状态直接恢复为干净/正常同步。
- 旧版本上的临时自助方法（升级前可用）：在仓库目录执行 `ls .git/REBASE_HEAD`，若存在且 `.git/rebase-merge`、`.git/rebase-apply`、`.git/MERGE_HEAD` 都不存在，手动删除 `.git/REBASE_HEAD` 即可恢复。这个文件只是 rebase 残留伪引用，当前分支与工作区内容不受影响。
