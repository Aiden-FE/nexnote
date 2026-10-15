# DEV-116 Tauri 2 壳与 Renderer bridge

- 状态：done
- 分类：architecture
- 优先级：P0
- 工作量：M
- 日期：2026-10-14
- 关联：DEV-ARCH-002、DEV-115、ADR-0028

## 背景

现有 Renderer 依赖 Electron preload 暴露的最小 `window.nexnote` bridge。Tauri 迁移需要独立 Vite 构建、Tauri webview 配置、最小 capability、CSP 和迁移期 bridge，同时保持 shared contract 白名单不变。

## 方案

1. 新增 `src-tauri` 工程与 Tauri 2 配置：
   - 独立 `packages/renderer` Vite dev/build 入口；
   - 主窗口 label、最小尺寸、标题、`dragDropEnabled=false`；
   - capabilities 仅授予当前阶段必需的 core event / command 权限；
   - CSP 显式限制 script/style/img/font/connect 来源。
2. Renderer 增加 Tauri 检测 bridge：
   - 仅当 `window.nexnote` 不存在且 Tauri runtime 存在时安装；
   - `invoke` 复用 shared channel 白名单与 `Result<T>` envelope；
   - event listener 复用 shared event 白名单；
   - 未迁移 channel 返回稳定 `UNSUPPORTED_CHANNEL`，不得返回假数据。
3. Rust command router 先采用类型化错误与最小状态，不实现业务假成功。
4. 增加 Rust fmt/clippy/test 与 renderer typecheck/build 门禁。
5. 明确生成文件与 `src-tauri/target` 的 ignore 规则。

## 验收标准

- [x] `pnpm --filter @nexnote/renderer build` 生成 Tauri 可加载前端产物。
- [x] `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test` 通过。
- [x] macOS 可用 Tauri dev 启动 Renderer，并显示真实 onboarding 状态或明确迁移态。
- [x] 未知 channel、事件名和未迁移 command 均返回稳定错误，不泄漏 panic。
- [x] capability / CSP / 外部资源边界有测试或静态检查。
- [x] Windows/Linux release GUI 启动已由 DEV-117 CI 补证；深层交互仍归 DEV-117。

## 2026-10-15 验收证据

Renderer build、Rust fmt/clippy/test 与 `pnpm tauri:dev` macOS WKWebView 启动实测通过；System Events 确认真实 `NexNote` 主窗口。未知通道由 shared allowlist 与 dispatch 稳定错误覆盖；CSP/capability 位于 `tauri.conf.json` 与 `src-tauri/capabilities/default.json`。

## Out of scope

- 核心业务后端迁移（DEV-118+）。
- 三 WebView 编辑器兼容矩阵（DEV-117）。
- 安装包签名与 updater（DEV-124）。
