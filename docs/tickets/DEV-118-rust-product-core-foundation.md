# DEV-118 Rust product core 基础与状态生命周期

- 状态：todo
- 分类：architecture
- 优先级：P0
- 工作量：L
- 日期：2026-10-14
- 关联：DEV-ARCH-002、DEV-115、DEV-116、ADR-0028

## 背景

Electron main 目前负责应用配置、窗口状态、设置、语言、权限与生命周期装配。Tauri 侧不能从 Electron 逐文件翻译，需要先建立可测试的 Rust product core：状态所有权、原子持久化、错误 envelope、事件分发和无 vault / 有 vault 两阶段生命周期。

## 方案

1. Rust core 模块化承载 app state、recent vaults、global settings、runtime info、language authority、command router、typed error、event bus 与启动/退出生命周期。
2. 应用级状态写入 Tauri app data，不进入 vault；写入使用 temp + rename 原子替换，损坏时 fail closed 并保留原文件。
3. 全局设置默认值与 TS `defaultGlobalSettings` 保持语义一致；迁移不得静默重置用户设置。
4. 迁移期泛化 JSON router 只能作为过渡，最终 command/module 必须类型化；`Option<Value>` 不能成为长期对外契约。
5. 建立 Rust 单元测试与契约测试，覆盖默认值、merge patch、非法枚举、原子写、损坏恢复、并发锁、事件顺序与启动前事件缓存。

## 验收标准

- [ ] app info、settings、language、recent vaults 在 Tauri runtime 可用且持久化。
- [ ] 杀进程、损坏配置、只读目录等失败路径有稳定错误码。
- [ ] 关键启动状态不会因 Renderer 尚未订阅而丢失，或有可拉取的启动快照。
- [ ] Rust 测试覆盖状态、持久化、错误与事件。
- [ ] 与 shared contract 的类型差异登记到 DEV-115 矩阵。
- [ ] macOS dev 环境实测；Windows/Linux GUI 保持 **NOT_RUN**。

## Out of scope

- Vault 内文件系统与 SQLite（DEV-119）。
- Git、AI、插件、更新等域逻辑。
