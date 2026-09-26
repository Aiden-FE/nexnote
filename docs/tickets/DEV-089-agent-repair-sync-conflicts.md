# DEV-089 Chat Dock Agent 真正介入 git 修复（接 doctor.prepare+execute）

- 状态：done
- 分类：enhancement
- 优先级：P1
- 工作量：M
- 范围：packages/main、packages/renderer
- Depends: DEV-073（同步 UX 统一 + Agent 修复入口）、DEV-076（DoctorDialog）
- 来源：triage 2026-09-26 — 「新版同步遇见冲突未见 Agent 介入选项」+「Agent 回复空话，没有调用既有 git_doctor_repair prepare/execute」

## 问题

DEV-073/076 引入的 DoctorDialog「让 Agent 帮助解决」按钮只是把 doctor 诊断文本灌进 Chat Dock 然后 `sendMessage`。但 Chat Dock Agent 可见的工具集只有 `search_notes / list_pages / edit_current_selection / append_to_document`，**没有 git 操作能力**，所以 Agent 只能回一段泛泛 prose 让用户手动操作。

并且 Agent 系统 prompt 是检索型助手（"基于提供的上下文回答"），既看不到 doctor 推荐的 `plan.action`，也无法调 `git:doctor:repairPrepare / :repairExecute`。

## 方案

1. **主进程**：新增 `git_doctor_repair` Agent 工具（access=write + requiresApproval=true），内部走 `doctor.prepare(action) → doctor.execute(ticket)` 的安全路径；Chat Dock 必须切到编辑态才能触发审批 gate。
2. **gateway**：`AGENT_SCENARIO_PROFILES.chat.tools` 加入 `git_doctor_repair`；系统 prompt 硬约束「遇到同步医生诊断 chip 必须立即调用工具，不允许先问是否执行」。
3. **bootstrap**：`packages/main/src/index.ts` 把 `gitDoctor` 注入到 `createBuiltinTools`，让 Agent 工具持有 doctor 适配器。
4. **审批 UI**（关键缺口）：`agent:runEvent` 的 `approvalRequired` 事件原本在 `chat-runtime.ts` 被静默丢弃，导致任何审批工具都会 5 分钟后 APPROVAL_EXPIRED。新增：
   - `useChatStore.pendingApproval` + `respondApproval` action
   - `PendingApprovalBanner` 组件（dock 顶层，倒计时显示 TTL，批准/拒绝按钮调 `agent:approval:respond`）
   - `finalizeStream` 自动清掉残留 pendingApproval
5. **sync-doctor chip**：ChatContextKind 新增 `'sync-doctor'`；`openAgentHelp` 改为注入结构化 chip + 强 prompt（`[INSTRUCTION] 必须立即调用 git_doctor_repair 工具，参数 {"action": "..."}`）。

## 验收

- [x] DoctorDialog 「让 Agent 帮助解决」点击后，Chat Dock 出现新会话，自动发送结构化 prompt。
- [x] 系统 prompt 与用户 prompt 都硬约束模型调工具（实测需要模型能识别到强指令）。
- [x] 模型调用 `git_doctor_repair({action: plan.action})` 时，Chat Dock 弹出审批 banner。
- [x] 用户点批准 → 主进程执行 prepare+execute → 真正 git 修复。
- [x] 用户点拒绝 → 主进程收到 `denied` → stream 以 `APPROVAL_DENIED` 终止。
- [x] 全量测试：1688 passed / 3 skipped
- [x] `pnpm typecheck / lint` 通过

## Out of scope

- full 模式自动批准：暂不做，保守路线需要用户每次审批（避免 Agent 误判 action）。
- 「让 Agent 修复」按钮（在 canRepair 分支）也跳 chat：保持现状，那条路径仍然走 DoctorDialog 一键修复按钮直接调 IPC，不绕 Chat Dock。
- doctor 的 prepare/execute 协议改造：保持现有 TOCTOU/TTL 安全语义不变。
