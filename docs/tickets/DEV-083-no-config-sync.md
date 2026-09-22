# DEV-083 vault 配置与布局不再进 git + 中止 rebase 保留笔记

- 状态：已实现（待发布 v0.0.25）
- 范围：packages/shared, packages/main, packages/renderer
- 架构依据：ADR-0016（取代 ADR-0003 中的 `.nexnote/config.json`/`.nexnote/layout.json` allowlist 条款）
- 触发：用户反馈 2026-09-22（DEV-082 修复后用户仍报告「中止 rebase → 内容被还原 → 再次冲突」的死循环）

## 背景

DEV-082 修复了「rebase 暂停期间自动提交叠加」和「doctor 无 abort 入口」两个症状。但用户反馈（2026-09-22）显示：

> 用户才编辑了一下，仓库就同步出了问题，中止并修复后，没多久内容又被还原，然后再次冲突，陷入死循环

根因不在 DEV-082 解决的层面，而是 ADR-0003 设计层面：

1. `.nexnote/config.json` / `.nexnote/layout.json` 跨设备同步，与「UI 状态每台设备必须不同」的语义根本冲突。
2. doctor 的「中止 rebase 并继续」走 `git rebase --abort`，把本地未推送的笔记 commits 一起回退——这才是「内容被还原」的来源。

## 实施任务

### A. ADR-0016 落地（git-service.ts）
1. `VERSIONED_NEXNOTE_FILES` 改为空数组。
2. `writeDefaultGitignore` 模板去掉 `config.json`/`layout.json` 的 allowlist，改为完整 `.nexnote/` ignore。
3. `commit()` 移除 `guardedInHead` / `guardedCandidates` 中与 config/layout 相关的特殊处理（仅保留 `.DS_Store` 等 OS 临时文件 ignore）。
4. 新增 `migrateUntrackedVaultConfig(root)`：检测已跟踪的 `.nexnote/config.json`/`.nexnote/layout.json`，`git rm --cached` 后保留磁盘文件；幂等。
5. `ensureSyncGuard` 调用迁移函数。

### B. doctor 修补（git-sync-doctor.ts）
6. 新增 `GitRepairAction = 'preserve-local-and-abort' | 'force-abort-rebase-or-merge'`。
7. `execute()` 新分支：
   - 用 `git format-patch orig-head..HEAD -- . ':!.nexnote/config.json' ':!.nexnote/layout.json'` 导出 ahead commits 中非 config/layout 的 patch 到 `.nexnote/.rebase-recovery/<timestamp>/`；
   - 执行 `git rebase --abort`；
   - `git am --3way` 按序回放 patch；失败的 patch 记录但不中断（让用户后续手动 reconcile）。
8. `planFor` 在 rebaseInProgress 时默认返回 `preserve-local-and-abort`；`force-abort-rebase-or-merge` 仅在 user explicitly asks 时出现。
9. 新增错误码 `PATCH_REPLAY_FAILED`、`NO_AHEAD_TO_PRESERVE`。

### C. vault-manager
10. `saveVaultLayout` 不变（仍写本地），去掉任何 git 路径；`ensureSyncGuard` 调用新增的迁移。
11. 添加 `restoreLayoutIfMissing(root)`：vault 首次打开时若 `.nexnote/layout.json` 不存在，写默认值。

### D. 共享契约
12. `GitStatus` / `GitRepairAction` 同步扩展。
13. 新增 IPC：`git:doctor:repairPrepare` 接受新 action；renderer DoctorDialog 增加按钮分流。

### E. 渲染层
14. `DoctorDialog`：
    - 主按钮：`保留笔记并中止 rebase`（默认）
    - 次按钮：`放弃本地改动并中止`（force-abort，红色文字 + 二次确认）
15. 文案：`MANUAL_GUIDANCE` 改为「建议先保留笔记」。

### F. 测试（沿用 DEV-082 的真实 git + 手工伪造 rebase-merge/ 模式）
16. `git-service.test.ts`：
    - `commit() 不再把 .nexnote/config.json 纳入自动提交`（写脏 config.json → commitAuto → 索引里没有 config.json）
    - `migrateUntrackedVaultConfig 对历史 vault 一次性 git rm --cached`
17. `git-sync-doctor.test.ts`：
    - `execute(preserve-local-and-abort) 把 ahead=1 的 note commit 导出 patch 后 rebase --abort + git am 回放`
    - `execute(force-abort-rebase-or-merge) 在 ahead=0 时抛 NO_AHEAD_TO_PRESERVE`
18. `vault-manager.test.ts`：
    - `saveVaultLayout 写磁盘但不触发任何 git 操作`

### G. 文档
19. ADR-0016（已落地）。
20. 本 ticket 同步推进到 done 状态后归档。

## 验收

- [x] 新 vault 的 `.nexnote/config.json` 不再被 `git ls-files` 列出
- [x] 既有 vault 升级后，`git rm --cached` 迁移在 `ensureSyncGuard` 幂等执行
- [x] doctor preserve-local-and-abort 后 working tree 内容不丢（patch 导出 → abort → git am --3way 回放）
- [x] `pnpm typecheck` 0 errors（本分支代码；master 上预存在的不相关错误保持不变）
- [x] `pnpm lint` 0 errors（7 个预存在 warning 不变）
- [x] 全部 vitest PASS：main **632 passed | 2 skipped (634)**；renderer 663 passed（1 个 master 预存在 selection-bubble 失败不变）
- [x] `pnpm verify:release-config` 31/31 PASS
- [x] `pnpm build` PASS
- [ ] 发布 v0.0.25

## 测试与门禁证据

新增/改写测试（9 例）：
- `git-service.test.ts`：
  - `commitAuto 不再把 .nexnote/config.json 纳入自动提交`（新）
  - `ensureSyncGuard 对已跟踪的 .nexnote/config.json 一次性 git rm --cached`（新）
  - `preserveLocalAndAbortRebaseOrMerge 把 ahead note commit 导出 patch 并回放`（新）
  - `preserveLocalAndAbortRebaseOrMerge 在 ahead=0 时抛 NO_AHEAD_TO_PRESERVE`（新）
  - `initialize 创建仓库、写 .gitignore（ADR-0016 整 .nexnote/ ignore）`（改写）
  - `同步护栏识别 OS 元数据和 .nexnote 运行时产物（无 allowlist）`（改写）
  - `initialize 升级旧仓库时 untrack（包含 config/layout）`（改写）
- `git-sync-doctor.test.ts`：
  - `rebaseInProgress 时 plan 默认动作是 preserve-local-and-abort`（新）
  - `execute(preserve-local-and-abort) 把 GitService 错误码翻译成 doctor 错误`（新）
  - `execute(preserve-local-and-abort) 成功时 preserve 字段透传给 UI`（新）
  - `prepare(force-abort-rebase-or-merge) 与 preserve 均可签发票据并执行`（改写自 DEV-082）
- `vault-manager.test.ts`：`saveVaultLayout 写磁盘但不触发任何 git 操作`（新）
- `ipc-registrar.test.ts`：`vault:saveLayout 不再触发 scheduleAutoCommit`（改写）
- `chat-service.test.ts`：`sessions 目录保持 Git 忽略（ADR-0016）`（改写）

## 不做的事（边界）

- 跨设备快捷键/AI 偏好同步：留待下个 ADR（属于 SettingsService 重构）
- 自定义 git merge driver：因 config.json 已不在 git 内，无需
- vault 多设备协调（device id、文件锁）：下下个 ADR
