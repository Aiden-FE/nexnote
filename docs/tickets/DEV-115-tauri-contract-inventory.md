# DEV-115 Tauri 迁移契约与命令所有权盘点

- 状态：todo
- 分类：architecture
- 优先级：P0
- 工作量：M
- 日期：2026-10-14
- 关联：DEV-ARCH-002、ADR-0028

## 背景

`packages/shared/src/ipc` 是 Renderer 与主进程的唯一类型化契约，包含请求、响应、事件与运行时白名单。Tauri 迁移不能按文件机械翻译，必须先确定每个 channel 的数据所有权、持久化位置、副作用、权限边界、事件来源和迁移优先级。

## 方案

1. 新增迁移矩阵文档（建议 `docs/tauri/ipc-migration-matrix.md`），逐项列出：
   - channel / event 名称；
   - 数据所有权（app state、vault、SQLite、远端 provider、插件或宿主）；
   - 是否持久化、是否触网、是否访问文件系统或外部进程；
   - Electron handler 与 Tauri 目标模块；
   - 迁移批次：foundation / vault / git / ai / plugin / binary-print / updater / retire；
   - 当前状态：pending、ported、explicitly-unsupported、electron-only。
2. 为矩阵建立机械校验脚本或测试：
   - shared contract 中每个 channel/event 必须有唯一矩阵条目；
   - 矩阵不得出现未定义 channel；
   - `ported` 必须关联 Rust command 或模块路径；
   - `explicitly-unsupported` 必须给出用户可见错误语义。
3. 明确 Tauri 错误 envelope 与事件 payload 映射规则，禁止 Rust 侧把 panic 或原始 IO 错误直接暴露给 Renderer。
4. 标出 Electron 专属语义（sender 绑定、`WebContentsView` senderId、原生菜单、updater 进度等）并设计替代所有权。

## 验收标准

- [ ] 矩阵覆盖 `IPC_CHANNELS` 与 `IPC_EVENT_CHANNELS`，无重复、无遗漏、无未知项。
- [ ] 覆盖校验纳入 `pnpm test` 或独立 CI 门禁。
- [ ] 每个 channel 有数据所有权与迁移批次。
- [ ] Electron 专属语义清单完整，并映射到 Tauri 状态、窗口 label 或 command。
- [ ] ADR-0028 / DEV-ARCH-002 的子票范围与矩阵批次一致；不一致处更新 epic。
- [ ] `pnpm lint`、`pnpm typecheck`、相关测试通过。

## Out of scope

- 不实现任何 Rust command。
- 不改变现有 Electron 行为。
- 不做跨平台 GUI 实测。
