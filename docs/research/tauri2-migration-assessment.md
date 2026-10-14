# Tauri 2 迁移条件评估

> 评估日期：2026-10-14 · 决策更新：**已按 ADR-0028 决定全面迁移；本文保留为风险与迁移路线记录。**

## 1. 结论与迁移定义

本评估把“迁移 Tauri 2”定义为：macOS / Windows / Linux 正式发行版全部从 electron-builder/electron-updater 切到 Tauri 2，Renderer 保持 React/TipTap，桌面能力由 Rust core 或受控 sidecar 提供，并满足现有安全、更新、QA 与发布证据标准。

在这个定义下，当前项目不是“可执行 `tauri migrate` 后收尾”的状态。前端与 IPC 契约有明显迁移资产，但主进程服务层、原生模块、编辑器 WebView 差异和发布链路都需要分阶段验证与重写。若目标只是验证可行性，本机已有 Rust 1.98.1，且项目具备创建 Tauri spike 的条件。

## 2. 迁移资产

| 资产 | 当前状态 | 迁移价值 |
| --- | --- | --- |
| Renderer | 200 个文件 / 35,133 行 TypeScript/TSX，React 19 + TipTap + CodeMirror + React Flow | 可继续作为 Web 前端，但不等于三系统 WebView 兼容 |
| Kernel | 43 个文件 / 8,353 行，TipTap core 框架无关 | ADR-0001 预留的换壳资产 |
| Shared contract | 43 个文件 / 8,385 行，类型化 IPC contract + runtime 白名单 | 可把 `window.nexnote` bridge 替换为 Tauri `invoke`/event adapter，Renderer 调用面集中 |
| Main 服务 | 89 个文件 / 20,539 行，77 个测试文件 | 大量业务逻辑已有测试，但当前不是壳中立层 |
| Git | 默认捆绑 dugite Git，业务逻辑基于 simple-git | Tauri `externalBin`/Shell sidecar 可承载外部 Git，能力面存在 |
| 构建 | pnpm workspace + Vite | 前端产物可复用；Rust shell 与发布链路需新增 |

## 3. 阻塞项

### 3.1 三平台系统 WebView 是编辑器最高风险

Tauri 2 在 Linux 使用 WebKitGTK、macOS 使用 WKWebView、Windows 使用 WebView2。ADR-0001 的调研已经记录 Linux IME / 滚动 / 拖放长尾、macOS WKWebView 拖拽和 composition 事件顺序问题。当前项目对这些能力的依赖是产品核心：

- TipTap contenteditable 与块拖拽；
- CodeMirror 快捷输入与 composition 事件；
- 中文/多语言 IME；
- React Flow 图谱拖拽；
- 页面树、Tab、编辑器、文件拖放；
- ResizeObserver、Clipboard、`MessageChannel` 等浏览器 API 的三引擎一致性。

因此，迁移前必须有真实 WKWebView / WebKitGTK / WebView2 的编辑器兼容矩阵；仅在 WebView2 中通过没有意义。

### 3.2 Node/Electron 主进程服务层需要重构

静态扫描显示 `packages/main/src` 中：

- 8 个文件直接 import/require Electron；
- 48 个文件使用 Node builtin、better-sqlite3、simple-git、chokidar、keyring、dugite 等 Node/原生生态；
- 入口直接使用 Electron `app`、`dialog`、`ipcMain`、`safeStorage`、`shell`；
- 窗口层使用 `BrowserWindow`、`Menu`、`nativeTheme`、`screen`；
- 二进制编辑器宿主使用 `WebContentsView`；
- 打印使用隐藏 `BrowserWindow`；
- 更新器与 Electron 打包/签名/App bundle 语义耦合。

这些依赖并非简单 API 替换。Tauri 迁移要先在业务服务外围建立壳中立 capability layer，否则 Rust shell 会直接复制 Electron 心智，测试和排错都会变差。

### 3.3 SQLite / Git / AI 是三条重迁移线

- **SQLite**：`better-sqlite3` 不能进入 Rust core。可迁 `rusqlite` + FTS5，也可把 Node 服务作为 sidecar。两者都要求移植现有 schema、事务、文件锁、备份、性能测试和 77 个 main 测试中的大部分语义。
- **Git**：dugite Git 可作为 Tauri `externalBin` sidecar，官方要求按 target triple 命名并经 Shell plugin 授权；但 simple-git 调用链、系统凭证、SSH agent、macOS Keychain、Windows Credential Manager 和大仓库行为需要重测。
- **AI**：当前基于 Vercel AI SDK / undici 的 TS 流式链路。若迁 Rust core，需要重写 SSE、工具调用、取消与代理；若保留 Node sidecar，需要自定义双向 RPC。两者都不是机械转换。

### 3.4 打印、二进制宿主与插件沙箱需要重新证明

- **二进制编辑器**：ADR-0015 明确依赖 `WebContentsView` 独立进程实现崩溃隔离、内存上限和主题/命令 IPC。Tauri 多窗口/多 WebView 能建立独立页面，但三平台进程隔离、内存回收、父窗口裁剪与生命周期语义必须实测。
- **打印**：ADR-0026 依赖隐藏 Electron 窗口和系统打印对话框。Tauri 需要重新设计隐藏 WebView 打印或 PDF 管线，并验证页面范围、打印机枚举、份数等用户可见能力。
- **插件系统**：当前模型依赖 sandbox iframe、`MessageChannel`、受控 custom origin/protocol、CSP 与 capability RPC。Tauri 的 asset protocol、capability 文件、WebView origin 与 CSP 需要完整安全评审，不能把插件资源放进宽权限 `fs` scope。

### 3.5 发布、更新与签名链路会重建

当前 release QA 依赖 electron-builder 的 DMG/ZIP/NSIS/AppImage/deb、blockmap、SHA256SUMS、mac app bundle 与 electron-updater。Tauri 2 虽有官方 updater 与 bundle，但更新签名密钥、静态 endpoint、Windows/Linux/macOS 签名策略、五个产物命名和现有 QA 清单都要重建。Tauri updater 私钥丢失会造成存量用户断更，密钥托管必须是迁移决策的一部分。

## 4. 可行迁移路线

1. **Phase 0：壳中立重构（仍在 Electron）**
   - 把 `packages/main` 拆为 `core services` 与 `Electron host adapters`；
   - 类型化 IPC contract 保持唯一 Renderer 边界；
   - 将 SQLite、Git、AI、file watcher、keyring、dialog、updater 定义为 host capability interface；
   - 新增 host adapter 测试，保持现有功能不回归。

2. **Phase 1：Tauri 编辑器 spike**
   - 同一 Renderer 在 WKWebView、WebKitGTK、WebView2 中跑块编辑、拖拽、IME、CodeMirror、图谱、打印、插件 iframe；
   - 量化包体、启动、内存、崩溃恢复；
   - 不接数据库和 Git，先证明编辑体验可接受。

3. **Phase 2：后端形态 spike**
   - A：Rust core + rusqlite + external Git + Rust SSE；
   - B：Node sidecar 保留 TS 服务 + Rust 壳；
   - 用同一 IPC contract 对比复杂度、包体、内存、启动、稳定性和维护面。

4. **Phase 3：并行发布通道**
   - Tauri 产物先作为 alpha 通道发布；
   - 复用 QA evidence 绑定、SHA、匿名下载和三平台启动检查；
   - 只有在稳定性与性能指标超过 Electron 时才考虑默认切换。

## 5. 建议

**不要把 Tauri 迁移当作近期交付事项。** 立即值得做的是 Phase 0 壳中立重构和 Phase 1 三 WebView 编辑器 spike；这两项无论是否迁移都有价值。只有当 spike 证明三平台编辑体验、打印、插件沙箱、后端和更新链路都可接受，并且包体/内存/启动有明确收益时，才升级为正式迁移项目。

## 6. 证据来源

- 当前代码：`packages/shared/src/ipc/contract.ts`、`packages/main/src/preload/index.ts`、`packages/main/src/index.ts`、`packages/main/src/binary/binary-editor-host.ts`、`packages/main/src/print/print-window.ts`、`packages/main/src/indexer/index-service.ts`、`packages/main/src/git/git-service.ts`、`package.json`。
- 项目既有决策：ADR-0001（Electron/Tauri 选型）、ADR-0015（`WebContentsView` 二进制宿主）、ADR-0026（隐藏打印窗口）、`docs/research/desktop-shell.md`、`docs/research/plugin-system.md`。
- Tauri 2 当前文档：sidecar/`externalBin` 与 Shell plugin、multi-window 配置、capabilities/window permissions、updater 与发布文档。见 [Tauri sidecar](https://v2.tauri.app/develop/sidecar/)、[Capabilities](https://v2.tauri.app/security/capabilities/)、[Updater](https://v2.tauri.app/plugin/updater/)。
