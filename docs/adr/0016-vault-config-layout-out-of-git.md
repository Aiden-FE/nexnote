# ADR-0016 vault 配置与布局从 git 版本化中移除

- 状态：accepted
- 日期：2026-09-22
- 取代：ADR-0003 中关于 `.nexnote/config.json` 与 `.nexnote/layout.json` 的 allowlist 条款
- 触发 ticket：DEV-083

## 背景

ADR-0003 把 `.nexnote/config.json` 与 `.nexnote/layout.json` 设为「可重建配置」的 allowlist，纳入 git 版本化，目的是跨设备同步用户偏好（快捷键、AI 偏好等）。但实践暴露两个根本缺陷（DEV-082/083 反馈）：

1. `config.json` 实际混装了两类生命周期截然不同的字段：
   - **全局语义**：`settings.git.syncStrategy`、`settings.editor.defaultPageTemplate`、`settings.shortcuts` 等——跨设备应一致
   - **设备/会话瞬时**：`layout.tabOrder`、`layout.activeSidebarPanelId`、`layout.dockVisible`、`layout.sidebarWidth`、`layout.treeCollapsedDirs` 等——每台设备、每个窗口**必须不同**

2. `vault:saveLayout` 触发链（renderer `layout-persistence.ts` → IPC → `saveVaultLayout` → 写 `config.json` → `scheduleAutoCommit('保存知识库布局')`）在**任何 UI 状态变化时**都触发，包括拖动侧栏宽度、打开/关闭页签、切换 sidebar tab。多设备同时打开 vault 时几乎每次 `autoSync`（默认 300 秒）都撞 `config.json` 内容冲突，rebase 卡死。

3. doctor「中止 rebase 并继续」走 `git rebase --abort`，按定义把 HEAD 退回 `orig-head`，**本地未推送的笔记 commits 一起被撤回**——这是 DEV-082 修复后用户仍报告「内容被还原」的真正来源：冲突的文件是 `config.json`，被回退的却是笔记。

这两个缺陷的根因都在 ADR-0003 的 allowlist 设计：把会话级瞬时状态强制纳入跨设备版本化，与「不假设用户懂 git」的产品定位根本冲突。

## Decision

1. `.nexnote/config.json` 与 `.nexnote/layout.json` **完全退出 git 版本化**。每个设备的 vault 打开时按默认值初始化，UI 状态仅在本设备保留。
2. `VaultConfig.settings` 中的全局语义字段（`git.*`、`editor.*`、`shortcuts`）保留**应用级设置**（`@nexnote/shared` 已在 `SettingsService` 中走主进程 IPC 与独立持久化文件），不再混入 vault 配置——这一点属于 DEV-082/083 的边界外，下一步单独 ADR。
3. 既有 vault 一次性迁移：检测到已跟踪的 `.nexnote/config.json`/`.nexnote/layout.json`，用 `git rm --cached` 从索引移除（保留磁盘文件），随后 `.gitignore` 默认模板把 `.nexnote/` 整目录 ignore。
4. doctor 修补 rebase 中止语义：新增动作 `preserve-local-and-abort`，执行前先把 working tree + index 中**非 config.json/layout.json** 的 ahead commits 用 `git format-patch` 导出到 vault 内 `.nexnote/.rebase-recovery/`（受 ignore 保护），`git rebase --abort` 后用 `git am` 按序回放这些 patch。原生 `abort-rebase-or-merge` 降级为「force abort（丢弃本地）」，仅在用户主动确认时调用。
5. `.nexnote/` 整目录 ignore 后，应用层完全控制 `.nexnote/config.json`/`layout.json` 的存在与默认值；UI 状态不再进入跨设备同步链路。

## 落地位置

- `packages/main/src/git/git-service.ts`：`VERSIONED_NEXNOTE_FILES` 改空数组；`writeDefaultGitignore` 模板去掉 `config.json`/`layout.json` 的 allowlist，改为完整 `.nexnote/` ignore；`commit()` 不再有任何特殊路径保留逻辑；新增 `migrateUntrackedVaultConfig(root)`：检测 + 一次性 `git rm --cached`。
- `packages/main/src/git/git-sync-doctor.ts`：新增 `preserve-local-and-abort` action；`planFor` 在 rebaseInProgress 时默认指向该 action；新增 `force-abort-rebase-or-merge` 作为危险降级；`execute` 拆分为「export ahead commits → rebase --abort → replay via git am」三步。
- `packages/main/src/vault/vault-manager.ts`：`saveVaultLayout` 行为不变（仍写本地文件），但删除任何 git 相关副作用；`ensureSyncGuard` 调用新增迁移函数。
- `packages/renderer/src/features/git/index.tsx`：DoctorDialog 文案区分两个 action；新增「保留笔记 + 中止」按钮的次要选项。
- 文档：docs/tickets/DEV-083-no-config-sync.md 与本 ADR 同步落地。

## Considered Options

- **保留 allowlist 但加自定义 merge driver（union ours/theirs）**：能让两边 layout 共存但永远只取其中一边，并不能解决「跨设备 layout 必须不同」的本质问题，且会让用户的 UI 永远卡在某台设备最后一次成功 sync 的状态。
- **保留 allowlist 但每次 saveLayout 跳过 git**：等价于本 ADR，但留 allowlist 在 `.gitignore` 里只会让用户/工具再次纳入——必须显式移除。
- **保留 allowlist 并把 layout 改为本地 store，仅 sync settings**：技术上是最小改动，但仍让 `config.json` 在 vault 同步链路里，且「layout 是不是本地」会让产品语义更复杂；不如彻底分流。
- **保留 allowlist 但加 rebase 时 cherry-pick notes-only 步骤**：可解「笔记被回退」但解决不了「config.json 必然冲突」的根问题。
- **完全退出版本化（采纳）**：从根上消除冲突源；UI 状态本来就是设备/会话专属，进 git 是不必要的耦合。

## Consequences

- 跨设备快捷键、AI 偏好等「设置」需要重新接入主进程 SettingsService 的全局持久化（`settings-service.ts` 已有结构）。本期不交付；用户偏好在本期内跨设备不一致，下次启动会重置为默认值；下次 ADR 处理。
- 已发布 v0.0.22/0.0.23/0.0.24 的 vault 升级到 0.0.25+ 时执行一次性迁移：保留磁盘上的 `config.json`/`layout.json` 不动（用户当前 UI 状态保留），从 git 索引移除这两个文件，旧 commit 中的历史值不再可访问。
- `vault:saveLayout` 不再触发 `scheduleAutoCommit`，自动同步流量显著下降——这是好事。
- doctor「保留笔记 + 中止」需新增 `git format-patch` + `git am` 子流程；测试覆盖 ahead=0、ahead>0 (notes-only)、ahead>0 (mixed with config changes) 三种情况。
