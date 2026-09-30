# MOB-004 设备端 Git 服务层与同步编排

Ticket: MOB-004 · Milestone: M1 · Branch: dev/MOB-004 · Depends: MOB-002, MOB-003
ADR: docs/adr/0018-mobile-device-side-git-sync.md
Status: open

## 目标

把 MOB-002 验证过的最小链路做成可用的设备端 Git 服务：与桌面端共用行为语义（提交消息前缀、防抖节奏、护栏意图），但不复用其实现。

## 行为

1. 服务接口镜像桌面 `GitService` 的公开方法：init / status / commit（manual 与 auto）/ log（时间线）/ remote 管理（add、list、set-url）/ fetch / push / pull。
2. 自动提交：写入路径触发，防抖 30 秒、最小间隔 2 秒（与桌面 `scheduleAutoCommit` 对齐）；消息格式 `nexnote:auto: <摘要>`、手动提交 `nexnote:manual: <摘要>`。
3. 同步编排：`fetch → rebase → push`（仅 when ahead > 0）；定时器与指数退避对齐桌面 `configureAutoSync`（默认 300 秒、上限 4×interval）。
4. ahead / behind 自建（libgit2 无现成字段），用于时间线与状态展示。
5. 冲突策略：检测到 conflict 或 rebase-in-progress 即进入「禁写」状态——停用编辑保存与自动提交，界面明确提示回桌面端处理；不实现自动合并与冲突解决 UI。
6. 护栏意图对齐：提交前剔除 `.nexnote/` 运行时产物与 OS 元数据（`.DS_Store` 等），不把设备端私有状态推入历史。
7. 凭证生命周期：token 从 iOS Keychain 读取，仅注入到调用期；错误分类（网络、认证、host key、远端拒绝）映射为可读文案。

## 边界

- 明确不做：doctor 修复动作、`format-patch` 备份、restore、worktree、LFS、submodule。
- 不新增任何与桌面端通信的接口（ADR-0018 硬约束）。

## 验收

- 单元测试（Dart 侧）覆盖：消息前缀、防抖与最小间隔、ahead/behind 计算、护栏剔除、冲突态判定与禁写。
- 真机集成：两个客户端（手机 + 桌面）交替写入同一远程，最终双向收敛且历史线性（rebase），附 push/pull 日志。
- 构造 rebase 冲突：手机端进入禁写并给出回桌面提示；解除后（桌面解决并推送）手机端可恢复写入。
- 凭证失败路径可复现（错误 token / 错误 host key），且不泄漏 token 内容。
