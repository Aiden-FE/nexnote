# DEV-090 Agent 真正完成 git 同步（解决而非回避）

- 状态：done
- 分类：enhancement
- 优先级：P1
- 范围：packages/shared、packages/main、packages/renderer、docs/tickets
- Depends: DEV-073（同步 UX 统一）、DEV-076（DoctorDialog）、DEV-082（rebase autolock）、DEV-083（保留笔记并中止）、DEV-088（解决后再同步）、DEV-089（Agent 介入同步修复）
- 来源：triage 2026-09-27 — 「'保留笔记并中止 rebase'是回避，不是解决；按钮应默认让 Agent 修复」

## 问题

DEV-083 引入的默认修复动作是「保留本地 ahead commits 并中止 rebase」，本质是把本地提交备份再 `git rebase --abort`——本地笔记没有被撤回，但 **rebase 没有走完、同步并没有完成**。

具体场景：

1. 用户的 `my-wiki` 在 2026-09-22 完成了一次 v0.0.27 升级，仓库里 `.gitignore` 的两侧都是 NexNote 自己生成的 ADR-0016 模板块，本地侧仅多一个空行。
2. `git fetch && git rebase origin/master` 在 `.gitignore` 处撞出 `<<<<<<<` 冲突。
3. doctor 把 issue 分类成 `REBASE_IN_PROGRESS`，默认动作是 `preserve-local-and-abort`（DEV-083）。
4. Agent 调 `git_doctor_repair({action:'preserve-local-and-abort'})` → 备份本地提交 → `git rebase --abort` → 恢复原分支，但远端的 commit 仍然没有合进来。
5. 用户看到的反馈是「保留 2 个本地提交」——同步并没有完成，需要用户手动再 `git fetch && git rebase`，Agent 只是绕开了问题。

## 期望行为

1. 暂停的 rebase **只冲突在应用自有文件上**（目前只有 `.gitignore`）时，Agent 真正完成同步：用规范内容重建该文件（合并两侧用户自写规则，逐字节安全），`git rebase --continue` 后再 `git push`。远端 commit 真正落到本地。
2. 冲突一旦涉及用户笔记、二进制文档等任何非应用自有文件，立即拒绝并保留现场（与 abort 一样不丢笔记），让用户走"保留笔记并中止"或人工路径。
3. DoctorDialog 在可自动收敛时显示「让 Agent 修复」按钮（在前的蓝色按钮），而不是默认的"保留笔记并中止 rebase"。
4. Chat Dock Agent 系统 prompt 强调：医生推荐 `resolve-conflict-and-continue` 时用它，让同步真正完成。

## 实施

### A. 新增 GitRepairAction：`resolve-conflict-and-continue`

- `packages/shared/src/types/git.ts`：union 追加 `'resolve-conflict-and-continue'`。
- `packages/main/src/git/git-sync-doctor.ts`：
  - `GIT_REPAIR_ACTIONS` 白名单加入新动作；
  - `COMMAND_PREVIEW` 写入「规范化应用自有文件（.gitignore）→ git rebase --continue → git push」；
  - `planFor(category, status, conflictFiles)` 在 rebaseInProgress 且冲突文件全部在 `SELF_RESOLVABLE_CONFLICT_FILES` 内时返回该动作；
  - `prepare` 的 `abortFamily` 把它也包含进允许集合；
  - `execute` 加该分支；TOCTOU 失败映射 `CONFLICT_NOT_SELF_RESOLVABLE` / `CONFLICT_CONTINUE_FAILED`。

### B. GitService 实现核心方法

`packages/main/src/git/git-service.ts`：

- 新增模块常量 `SELF_RESOLVABLE_CONFLICT_FILES = ['.gitignore']`，作为 `GitService.SELF_RESOLVABLE_CONFLICT_FILES` 的来源；
- 新增 `resolveConflictAndContinue()`：循环每个 rebase commit（最多 50 步）：
  1. 读 `rawStatusPorcelain(root)`，对冲突文件做白名单校验——任何非 `SELF_RESOLVABLE_CONFLICT_FILES` 的文件抛 `CONFLICT_NOT_SELF_RESOLVABLE`；
  2. `resolveSelfOwnedConflictFile(root, file)` 用 `:2:` / `:3:` 两阶段内容做应用模板剥离，用户规则取并集，过滤冲突标记与模板残留行；
  3. `git add` 文件，`git rebase --continue`（`allowUnsafeEditor` + 固定 no-op 编辑器，仅此一处放行）；
  4. rebase 完成后 `pushAfterResolve(root)`：ahead > 0 时按当前 branch 的上游远程推；
- 私有 helper `resolveSelfOwnedConflictFile` / `pushAfterResolve`；
- `private git(...)` 扩展 `{ unsafeEditor?: boolean }` 选项，仅 resolve-conflict 流程开启。

### C. DoctorDialog 默认按钮

`packages/renderer/src/features/git/index.tsx`：

- 新增 `isContinueRepair = action === 'resolve-conflict-and-continue'` 分支：首选按钮是「让 Agent 修复」（一键修复流程），其次是「保留笔记并中止」（降级）。
- `MANUAL_GUIDANCE.conflict` 文案改为明确告诉用户「默认推荐让 Agent 修复，应用自有文件会被规范化并继续完成 rebase」。

### D. Agent 工具与系统 prompt

- `packages/main/src/agent/builtin-tools.ts`：`git_doctor_repair` 工具描述中追加 `resolve-conflict-and-continue`，提示模型这是真正完成同步的入口。
- `packages/main/src/agent/gateway.ts`：chat 场景系统 prompt 追加硬约束——医生推荐 `resolve-conflict-and-continue` 时用它，不要绕用 abort 系列动作。

### E. 批准后的执行中反馈（实测补修）

真机验证发现：批准后到模型出字之间有数秒到数十秒（rebase 多 commit + push）的静默期，banner 一点击就消失、助手气泡几乎是空的，用户以为卡死。其实工具**已执行成功**（reflog 可见 rebase continue→finish，`origin/master == HEAD`；session 日志状态 complete）。

- `chat-store.ts`：新增 `runningTool` 状态 + `setRunningTool`；`respondApproval(approved)` 时置位待执行的工具名，IPC 失败时清除；`reset` 清零。
- `chat-runtime.ts`：`delta`（模型开始出字）与工具 `denied`/`failed` 时清除；`finalizeStream` 与 `cancelActiveStream` 兜底清零。
- `ChatDock.tsx`：新增 `RunningToolBanner`（`data-testid="chat-running-tool"`），文案「已批准，正在执行 git 修复…完成后会在这里给出结果。」

## 安全边界

- 冲突文件只能来自 `SELF_RESOLVABLE_CONFLICT_FILES`；`resolveConflictAndContinue` 显式拒绝任何其它冲突文件并抛 `CONFLICT_NOT_SELF_RESOLVABLE`，工作区不会被覆盖。
- 用户自写规则的处理：读取 `:2:` 与 `:3:` 两阶段，应用模板字节级剥离后把剩余行去重合并，模板本身只输出一次（用户的真实场景中两侧只有空行差异，因此收敛为单一规范模板）。
- `allowUnsafeEditor` 仅在 `git()` 的可选参数里放行，调用方传固定 `true` 的 `GIT_EDITOR`——不接受任何用户/模型输入。
- 编辑态审批（DEV-089 既有）：doctor 的 `prepare` / `execute` 都经 TOCTOU + TTL 校验，Agent 调工具仍走原审批 banner。

## 验收

- [x] `my-wiki` 当前 `UU .gitignore` 暂停 rebase 状态：`resolveConflictAndContinue` 把它收敛到单一规范 `.gitignore`，继续 rebase 不再卡住，远端 commit 落到本地。
- [x] 单元测试覆盖：service 层 `resolveConflictAndContinue` 真实 rebase 冲突完成；服务拒绝用户笔记冲突；resolver 在用户的真实两侧快照（my-wiki `:2:` / `:3:`，只有空行差异）下输出单一模板；resolver 保留两侧真实用户规则。
- [x] doctor 单测：`resolve-conflict-and-continue` 在 `.gitignore` 单冲突时成为默认动作；笔记冲突时退回 `preserve-local-and-abort`；`execute` 走 service 路径并映射错误码。
- [x] renderer 单测：DoctorDialog 在 continue action 时首选「让 Agent 修复」，点击触发一键修复 IPC；批准后显示执行中 banner 且完成事件后消失。
- [x] 全量：`git-service.test.ts` 65 passed（含新增 4 例）；`git-sync-doctor.test.ts` 45 passed；`chat-approval.test.tsx` 8 passed；renderer 全量 708 passed。
- [x] typecheck / lint / prettier 通过。
- [x] 既有 64 个失败用例为本仓库 master 上预先存在的沙箱问题（远程 file:// 端到端等），与本修复无关。

## Out of scope

- 让 Agent 处理笔记内容冲突：会引入"AI 改笔记"语义，超出本工单的"完成同步"范围，仍按 abort 路径交给用户。
- 自动 continue 之外的 `git rerere` / 自动 merge driver：产品定位是"应用自有文件"自治，不是跨设备内容合并。
- 改 ADR-0003 旧 allowlist 的处理：已通过 `LEGACY_GITIGNORE_ALLOWLIST_LINES` 加入剥离集合，无需新 ADR。