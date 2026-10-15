# DEV-120 Rust Git 运行时与同步体系迁移

- 状态：partial
- 分类：architecture
- 优先级：P1
- 工作量：XL
- 日期：2026-10-14
- 关联：DEV-ARCH-002、DEV-119、ADR-0002、ADR-0003

## 背景

当前 Git 能力基于 simple-git 调用捆绑 dugite Git，包含 status、自动提交、pull/rebase/push、冲突 doctor、历史置信度、远程克隆与系统凭证环境。Tauri 终态不能使用常驻 Node main，但可以分发外部 Git 二进制并在 Rust 中管理进程、超时、取消和凭证环境。

## 方案

1. 选定外部 Git 分发策略：Tauri `externalBin` / resources 按 target triple 分发；校验版本、架构、许可证与源码 offer；生产默认不依赖用户安装 Git。
2. Rust Git gateway 实现 status/init/add/commit/log/fetch/pull/push/rebase/merge/clone preflight、取消、冲突分类、doctor 恢复、超时、进程组回收、stdout/stderr 限制与脱敏。
3. 凭证与 SSH：复用系统配置、SSH agent、macOS Keychain / Windows Credential Manager / Linux libsecret 的等效边界；不把 token/private key 暴露给 Renderer 或插件。
4. 用本地 fixture repo 覆盖干净、冲突、损坏、大仓库路径；远程测试使用一次性本地 bare repo。

## 验收标准

- [ ] 无 Git 用户可完成 vault 初始化、提交、历史查看。
- [ ] 自动提交、手动提交、pull/rebase/push、冲突 doctor 行为与现有安全边界一致。
- [ ] 取消和超时不遗留子进程或锁；`.git/index.lock` 有恢复策略。
- [ ] 凭证不进入日志、Renderer、插件或 vault。
- [ ] GPLv2 Git 分发义务与二进制校验纳入发布门禁。
- [ ] macOS 实测；Windows Credential Manager、路径大小写、WebView2 GUI 与 Linux GUI/SSH/keyring 保持 **NOT_RUN（当前无实测条件）**。

## 2026-10-15 审查结论

status / commit / timeline / 本地 bare repo 同步 / rebase 冲突 doctor / clone preflight-token 集成已有 Rust 测试。未完成项仍是：Tauri 产物未捆绑 Git（`resolve_git_binary()` 返回系统 `git`）、无 Git GPLv2 分发与二进制校验门禁、常规 Git 进程缺统一超时/取消/进程组回收、Windows/Linux 凭据与路径行为未实测。本票不能标 `done`。

## Out of scope

- 常驻 Node sidecar。
- 移动端 Git（ADR-0019 独立边界）。
- AI 冲突解释与修复（DEV-121 协作，但不由 Git 层调用模型）。
