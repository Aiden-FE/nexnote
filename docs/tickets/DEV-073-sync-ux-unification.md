# DEV-073 同步 UX 统一与 Agent 修复入口

- 状态：已实现并发布 0.0.22（2026-09-21），遗留清零
- 0.0.21：状态栏单同步图标 + Loader2 spinner、`git:syncProgress` 阶段事件、`git:sync` = fetch → rebase/merge（`VaultSettings.git.syncStrategy`，默认 rebase）→ push（仅 ahead 时，永不 --force）、`autoSyncIntervalSec` 默认 300 秒（0=关，失败指数退避到 4×）、`MANUAL_GUIDANCE` 去掉 git 术语改为 Agent 引导。
- 0.0.22 补齐：一键修复 — sync 失败自动弹诊断；`plan.action` 可执行时单击完成 prepare+execute（一次交互，安全门禁 TOCTOU/TTL 语义不变）；不可执行时「让 Agent 帮助解决」打开 AI 对话并携带脱敏诊断上下文。
- 测试：doctor/registry 既有用例全绿（1537/1537）。
- 范围：packages/shared, packages/main, packages/renderer
- 来源：用户反馈 2026-09-21（同步体验割裂、缺加载态、缺自动同步、缺 Agent 修复）

## 背景
当前 `packages/renderer/src/features/git/index.tsx:138-203` 状态栏同时暴露拉取、推送、诊断、刷新 4 个图标 + 弹出确认对话框 + 后续 timeline 内的提交/远程管理。问题：
1. **入口冗余**：诊断、刷新、拉取、推送四个动作语义重叠，普通用户难以分辨。
2. **无加载态**：`busy` 仅禁用按钮，无 spinner/进度，用户误以为卡死。
3. **无定时同步**：依赖用户手动触发；后台 `git:statusChanged` 事件只更新状态显示。
4. **冲突/分叉兜底文案要求用户"进入仓库目录手动解决"**（`packages/main/src/git/git-sync-doctor.ts:33-42` `MANUAL_GUIDANCE`），与"不假设用户懂 git"的产品定位冲突。
5. **同步策略分散**：`GitService.pull` 默认 `git pull --no-rebase`（`git-service.ts:505`），没有可配置的"先 rebase 再 push"组合。

## 方案
1. **单一同步图标**：状态栏 GitStatusItem 仅保留 1 个图标（`RefreshCw` 或 `ArrowDownUp`），点击触发 `sync`：
   - 主流程：`fetch` → `rebase`（或 `merge`，由 `VaultSettings.git.syncStrategy: 'rebase' | 'merge'`，默认 `rebase`）→ `push`（仅当 ahead>0）。
   - 安全门禁：`push` 永不传 `--force`；目标分支匹配 `main|master|release/.*` 时强制仅 fast-forward（无 ahead 时禁止 push 覆盖）。
2. **加载态**：
   - 同步进行时图标变 spinner，并显示"正在与 origin/xxx 同步…"
   - 主进程新增 `git:syncProgress` 事件，UI 渲染阶段文案（`fetching` / `rebasing` / `merging` / `pushing` / `done`）。
3. **定时自动同步**：
   - `VaultSettings.git.autoSyncIntervalSec: number`（默认 300；0 表示关闭）
   - 主进程 vault service 在 vault 活跃时挂 `setInterval`，仅在窗口可见且 idle 时触发；网络不可达立即回退并标记下一尝试时间。
4. **Agent 修复入口**：
   - 当 sync 失败且 `GitSyncDoctor.diagnose()` 返回 `plan.action` 可执行（`commit` / `pull` / `push`），状态栏旁出现「让 Agent 修复」按钮（一键跳到现有 ticket execute 路径，`packages/main/src/git/git-sync-doctor.ts:400-455`）。
   - 当 plan 不可自动修复（`conflict` / `non-fast-forward` 已分叉 / `unknown`），按钮变为「让 Agent 帮助解决」，调用 AI 生成步骤化中文解释，并提供「在聊天中继续」入口打开 AI 会话（携带脱敏的 status snapshot）。
5. **弱化人工兜底文案**：`MANUAL_GUIDANCE` 不再出现"在仓库目录手动解决"等表述；改为 "AI 与自动修复均不会覆盖冲突文件，已为你打开帮助会话"。
6. **删除冗余按钮**：status bar 移除独立的 `拉取` / `推送` / `诊断` / `刷新`；手动 commit message / 远程管理留在 timeline panel（保留现有功能）。

## 行为保持
- 现有 IPC 通道（`git:pull` / `git:push` / `git:doctor:*`）保留，timeline panel 与高级用户仍可直调。
- `gitSyncDoctor` 的票据 TOCTOU/TTL 安全语义不变。
- `useSystemGit` 现有 toggle 不动。

## 验收
- [x] 状态栏仅 1 个同步图标；其余按钮迁移至 timeline 或设置
- [x] 同步进行中显示 spinner 与阶段文案
- [x] 默认 5 分钟自动同步；可关闭；网络失败自动退避
- [x] sync 成功后不再弹任何"确认"对话框
- [x] sync 失败时出现「让 Agent 修复 / 帮助」按钮，点击可在 1 次交互内执行修复（无需额外诊断步骤）
- [x] 冲突时不再出现"请在仓库目录手动解决"文案
- [x] 默认 `syncStrategy=rebase`，并可在 vault 设置切换为 `merge`
- [x] 单元/E2E 测试覆盖：sync 主流程、加载态事件、自动同步退避、doctor CTA
- [x] `pnpm typecheck` 0 errors；`pnpm lint` 0 errors
