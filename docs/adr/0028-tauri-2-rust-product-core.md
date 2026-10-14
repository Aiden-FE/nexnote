---
status: accepted
---

# 全面迁移 Tauri 2：Rust 承载产品核心

NexNote 的桌面终态从 Electron 迁移到 Tauri 2：React Renderer 与 shared IPC contract 保留，Electron main/preload 不作为 Tauri 的常驻 sidecar；产品状态与文件、SQLite、Git、AI、插件、更新等能力逐命名空间迁移到 Rust product core。迁移期间 Electron 保留为对照通道；Tauri 未通过完整门槛前，不宣称替代、不删除 Electron 发行链路。

## Consequences

- 迁移按 `DEV-ARCH-002` epic 和子票推进。每个已迁移通道必须在 Rust 中实现真实产品逻辑，不能用 `UNSUPPORTED` 桩、空数据或临时 UI 冒充完成。
- 不引入常驻 Node/Electron sidecar。外部 Git 等独立二进制可以按 Tauri sidecar 分发，但它们是工具进程，不是 NexNote 产品逻辑宿主。
- Renderer 继续以 shared contract 为唯一调用面。Tauri 兼容桥只能作为迁移期边界，最终契约命名与错误语义要去 Electron 化。
- 三 WebView 编辑器矩阵（WKWebView / WebKitGTK / WebView2）、SQLite/Git/AI/插件/更新链路和发布 QA 是正式切换前置条件。
- 当前本地只有 macOS 图形环境；Windows 与 Linux 真实 GUI/安装/更新验证为 **NOT_RUN（环境不可用）**。这些项目未补证前，相关子票与 epic 均不得标 done。
- ADR-0001 中“Tauri 仅保留未来重评”的结论由本决策取代；其中的 WebView 风险记录仍是迁移验收清单。

## Considered Options

- **保留 Electron main 作为 Tauri Node sidecar**：短期迁移面最小，但保留 Node/Electron 安全与依赖面，产品逻辑仍无法沉淀到 Rust，且体积优势被抵消；否决。
- **继续 Electron + 仅做壳中立重构**：风险最低，但不满足全面迁移决策；只作为迁移过程中的对照实现。
- **一次性删除 Electron 通道**：在核心后端与发布链路未迁移前会失去可运行对照和回退通道；否决。
