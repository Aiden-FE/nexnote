# DEV-026 · AI 配置入口收口设置页

Type: dev
Module: ai
Status: closed
Blocked by: 无（可立即开始）
Depends: DEV-009（AI 域装配）、DEV-012（对话 dock）
Effort: S
Priority: P1

## Scope

落实验收反馈「AI 供应商设置内没有地方可以配置」。根因：设置页「AI 供应商」分区（Profile 管理、密钥、分功能指定、测试连接）完整存在，但右栏 AI 面板未配置状态的「配置 AI 供应商」按钮与 ⌘K `ai.setup` 命令都直接弹独立向导 modal（AiSetupWizard），从不引导去设置页，用户感知配置「藏在右栏」。原则：**设置类入口统一收口在设置页**；向导保留为首启动一次性引导，与 5 步 Tour「可重播」模式一致。

### 交付内容

#### 1. 入口收口

- 右栏 AiDockPanel 未配置态的「配置 AI 供应商」按钮改跳设置页 AI 分区（`openSettings('ai')`），不再弹向导。
- ⌘K `ai.setup` 命令同步改跳设置页 AI 分区（`ai.settings` 保持现状）；两条命令可合并为一条，保留关键词可搜性。
- 已配置状态下所有 AI 功能入口不弹向导（现状已满足，验收确认）。

#### 2. 向导降级为首启一次性引导

- AiSetupWizard 仅在首启动链路触发一次（OnboardingWizard 完成后，若未配置任何 Profile 顺延弹出）；用户跳过后不再自动弹。
- 此后未配置状态下，一切 AI 入口统一跳设置页 AI 分区。
- 向导完成后的落点为设置页 AI 分区；设置页 AI 分区保留「重新运行引导」按钮（现状已有，验收确认）。

## 安全不变量（继承全局约束）

- renderer 不直访 Node `fs`，所有文件读写经既有 IPC 通道。
- secrets 不进日志与产物（API key 仅存系统凭据库，渲染层只见脱敏状态——现状不变量，本票不得破坏）。
- 未真实运行的 GUI / 三平台 / 真实网络验收必须标 `NOT_RUN`，不得用单测或构建成功冒充。

## 验收标准

功能：

1. 未配置状态下点击右栏「配置 AI 供应商」按钮，跳转设置页 AI 分区，不弹向导。
2. ⌘K 搜「引导 / setup / AI」可达设置页 AI 分区；不存在任何直接弹向导的主路径入口。
3. 首启动（OnboardingWizard 完成、无任何 Profile）向导弹一次；跳过后重启或再触发 AI 入口不再自动弹。
4. 设置页 AI 分区「重新运行引导」可重播向导；向导完成后停在设置页 AI 分区。
5. 已配置状态下 AI 功能（写作辅助、对话 dock）入口与行为不回归。
6. Profile 管理、密钥脱敏、分功能指定、测试连接行为不回归。

门禁（全部在候选 SHA 上执行并留证）：

7. `pnpm -r typecheck`
8. `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`（**单元测试全绿**）
9. `pnpm lint`
10. `pnpm build`
11. `node scripts/verify-release-config.mjs`
12. `bash scripts/check-changed-format.sh master`
13. `git diff --check master...HEAD`
14. **Electron smoke e2e 全绿**，且新增覆盖：未配置点右栏按钮跳设置页、⌘K 入口跳设置页。

流程：

15. 在 `.wt/DEV-026` / `dev/DEV-026` 隔离实现，`master` 不直接编码。
16. 固定候选 SHA 上通过全新 Standards 与 Spec 双轴审查（无 blocker / major）后才 `git merge --no-ff`。
17. 合并后在 `master` 复跑门禁与 Electron smoke，并更新 README 与 checkpoint 登记。

## 关联决策

- 术语定义：[CONTEXT.md](../../../CONTEXT.md) 供应商 Profile（Provider Profile）/ 首启动向导（Onboarding Wizard）/ 对话 dock（Chat Dock）
- 模式先例：新用户分步引导（Tour 可重播，已交付）
