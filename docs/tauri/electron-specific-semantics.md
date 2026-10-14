# Electron 专属语义与 Tauri 替代设计（DEV-115）

## 1. `webContents.send` 事件推送

**Electron 行为**：主进程通过 `webContents.send(channel, payload)` 向渲染层推送事件；渲染层在 preload 中 `ipcRenderer.on(channel, listener)` 订阅。

**Tauri 替代**：Rust core 使用 `app.emit(channel, payload)`（全局）或 `window.emit(channel, payload)`（定向）推送；Renderer 端使用 `@tauri-apps/api/event` 的 `listen()` 订阅。

**差异与注意**：Tauri `emit` 是 JSON 序列化的，不支持 Electron 的 structured clone；复杂对象必须用 serde 序列化。事件可能在 Renderer 未挂载时丢失，关键启动状态需要可拉取快照（如 `vault:getState`）。

## 2. `ipcMain.handle` sender 绑定

**Electron 行为**：`ipcMain.handle(channel, async (event, payload) => ...)` 中 `event.sender` 提供调用来源的 `webContents.id`；某些 channel 用 senderId 做一次性 token 绑定（如 plugin session、clone preflight）。

**Tauri 替代**：Tauri command 的 `Window` / `WebviewWindow` 参数可获取调用窗口 label。如果需要 per-session 绑定，可在 Rust state 中使用 `window_label + random token`；Renderer 传入 token 验证归属。

**差异与注意**：Tauri 没有 `webContents.id` 概念；改用 window label 或 UUID token。

## 3. `WebContentsView` 二进制编辑器宿主

**Electron 行为**：`new WebContentsView({webPreferences: {preload, sandbox}})` 创建独立视图；`mainWindow.contentView.addChildView(view)` 挂载；`view.setBounds()` 控制位置；每个视图有独立 `webContents.id` 进程隔离。

**Tauri 替代**：使用 Tauri 的 multi-window 模式，每个二进制编辑器是一个 `WebviewWindow`；窗口透明、`decorations: false`、`parent` 设置为主窗口。用 `window.set_position()` / `window.set_size()` 对齐主窗口内容区。

**差异与注意**：Tauri multi-window 在 Linux（WebKitGTK）上的进程隔离行为需要实测（DEV-117/DEV-123）；窗口生命周期管理比 Electron `WebContentsView` 更重量级。

## 4. 隐藏 `BrowserWindow` 打印

**Electron 行为**：`new BrowserWindow({show: false})` 加载渲染 HTML，调用 `win.webContents.print()` 触发系统打印对话框。

**Tauri 替代**：使用 Tauri 的 hidden `WebviewWindow` 加载打印 HTML，通过 JS 调用 `window.print()`。或使用 Tauri 的 PDF 导出插件（如果可用）。最简方案：新开隐藏窗口加载 HTML，注入 `window.print()` 脚本。

**差异与注意**：Tauri 的 `window.print()` 行为依赖底层 webview 引擎；macOS WKWebView / Linux WebKitGTK / Windows WebView2 的打印对话框触发方式可能不同（DEV-117/DEV-123 必须实测）。

## 5. 原生应用菜单

**Electron 行为**：`Menu.buildFromTemplate(template)` + `Menu.setApplicationMenu(menu)`；点击项触发 `webContents.send('menu:action', ...)`。

**Tauri 替代**：Tauri 2 支持 `tauri::menu::Menu` / `MenuItem` API 在 Rust 侧构建原生菜单；点击事件通过 `on_menu_event` 回调，可向 Renderer emit 事件或直接执行 Rust 逻辑。

**差异与注意**：Tauri menu API 的跨平台一致性需要验证（特别是 Linux 上菜单栏的显示方式）。

## 6. `electron-updater` 自动更新

**Electron 行为**：`electron-updater` 内置 autoUpdater，支持 GitHub Releases / Squirrel；`autoUpdater.checkForUpdates()` / `downloadUpdate()` / `quitAndInstall()`。

**Tauri 替代**：Tauri 2 官方 updater plugin (`tauri-plugin-updater`)，强制签名校验，支持 GitHub Releases 作为 endpoint。需要在 Rust 侧配置 updater 的公钥和 endpoint。

**差异与注意**：Tauri updater 强制签名且私钥丢失不可恢复（断更存量用户）；updater 私钥管理是 DEV-124 的关键决策项。

## 7. `safeStorage` / Keychain 凭据

**Electron 行为**：`safeStorage.encryptString()` 使用操作系统密钥服务（macOS Keychain / Windows DPAPI / Linux libsecret）加密。

**Tauri 替代**：Rust 侧使用 `keyring` crate 直接操作系统密钥服务；不经过中间加密层，直接存取凭据。

**差异与注意**：`keyring` crate 的 Linux 后端需要 libsecret；Windows 用 Windows Credential Manager API；macOS 用 Security framework。行为等价但 API 不同。

## 8. `app.getPath('userData')` / app data 目录

**Electron 行为**：`app.getPath('userData')` 返回 OS 用户数据目录（macOS: `~/Library/Application Support/nexnote`）。

**Tauri 替代**：Tauri 的 `app.path().app_data_dir()` 提供等价路径。需要确认 Tauri 默认目录名与 Electron 是否一致（都基于 `identifier`）；如果不一致需要制定迁移路径。

**差异与注意**：Electron identifier 是 `dev.nexnote.desktop`，Tauri config 使用相同 identifier，但目录结构可能不同。

## 9. Dialog（文件/目录选择器）

**Electron 行为**：`dialog.showOpenDialog()` / `dialog.showSaveDialog()` 返回 Promise。

**Tauri 替代**：`tauri-plugin-dialog` 提供 `app.dialog().file().blocking_pick_folder()` 等同步/异步 API。

**差异与注意**：Tauri dialog plugin 的 API 与 Electron 不同；blocking 版本不能在 async 上下文中使用（会阻塞 tokio runtime），应使用 async 版本或 `spawn_blocking`。
