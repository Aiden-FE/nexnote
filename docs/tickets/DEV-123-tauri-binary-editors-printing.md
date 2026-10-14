# DEV-123 Tauri 二进制编辑器宿主与打印迁移

- 状态：in progress
- 分类：architecture
- 优先级：P1
- 工作量：XL
- 日期：2026-10-14
- 关联：DEV-ARCH-002、DEV-116、DEV-117、ADR-0015、ADR-0026

## 背景

Electron 版本使用 `WebContentsView` 为 xlsx / xmind 编辑器提供独立进程宿主，使用隐藏 `BrowserWindow` 打印渲染后的语义 HTML。Tauri 多 WebView 与打印能力不能按 API 名义平移，必须重新验证隔离、内存、生命周期与打印语义。

## 方案

1. **二进制编辑器宿主**：
   - 每文档独立 webview/window 的生命周期与并发上限；
   - 主窗口布局裁剪、焦点、主题、语言与 IPC 命令；
   - pending flush、关闭确认、crash 恢复；
   - xlsx / mindmap bundle 按需加载；
   - 内存与冷启动基线对比 Electron。
2. **打印**：
   - 收集当前编辑器内存中的语义 HTML 与样式；
   - 隐藏 webview 或平台打印管线；
   - 打印对话框、页面范围、份数、导出 PDF；
   - 不打印应用 UI，不强制先保存。
3. 建立平台差异矩阵；打印与拖拽/滚动/IME 一样不得只用 macOS 结果代表全平台。

## 验收标准

- [ ] xlsx / xmind 打开、编辑、debounce 保存、关闭 flush、崩溃恢复可用。
- [ ] 每文档并发、内存与生命周期策略达到 ADR-0015 边界。
- [ ] 打印块文档与 Markdown 输出渲染语义，不包含 UI chrome；未保存内容可打印。
- [ ] 页面范围、份数、PDF 导出在支持平台实测。
- [ ] macOS 实测；Windows/Linux 打印对话框、WebView 进程隔离与内存保持 **NOT_RUN（当前无实测条件）**。

## 实施进度

打印运行时（`print_service::print_document`）已从校验占位升级为真实实现：校验通过后在隐藏 `WebviewWindow` 加载渲染层壳页，`on_page_load(Finished)` 时注入文档 HTML 并调用 `webview.print()` 打开系统打印对话框，窗口在任何结果下都被销毁，30s 超时兜底防止 WebView 卡死。

与 Electron 的已知契约差异：Tauri 的 `webview.print()` 不回报用户是否提交或取消，因此 `accepted: true` 表示「系统对话框已派发」，不是打印回执；渲染层不得据此提示「打印成功」。页面范围、份数、导出 PDF 由系统对话框提供，应用侧不实现。

仍待完成：macOS 实测（隐藏窗口、系统对话框、内存）；Windows/Linux 打印 **NOT_RUN（无实测条件）**；xlsx/xmind 的 `WebContentsView` 等价宿主（多 WebView 隔离）尚未迁移。

### 二进制编辑器宿主（Tauri 2 等价方案）

Tauri 2 没有 `WebContentsView` 等价物，改用每文档一个 borderless 子窗口：`parent(main)` + `decorations(false)` + `skip_taskbar(true)`，macOS 上是真子窗口，Windows/Linux 上是 owned/transient 窗口（始终在父窗口之上、随父窗口最小化隐藏）。`binary:host:open|close|setActive|setBounds|flush|ready` 六个通道与 `binary:editorCommand` 事件已接线，注册表按 `kind:path` 管理宿主，只有「已激活且已上报占位矩形」的宿主可见——宿主绝不覆盖侧栏/标签条/状态栏。

就绪协议沿用 Electron 的 pull 模型：编辑器页 bootstrap 后调用 `binary:host:ready`，响应里带回排队的命令（首条为从全局设置读取的当前语言），避免初始 load 被推入尚未订阅的页面而永久丢失。

已知缺口（矩阵中已逐条标注）：`flush` 只投递命令、不等待页内 `__nexnoteHostFlush` 写盘往返；`setBounds` 不跟随主窗口 resize 重算；`ready` 以「第一个未 ready 宿主」识别 ack 来源，多宿主并发时需改为 sender id 识别；并发上限（渲染层 ≤3 LRU）未在 Rust 侧强制。macOS 实测（宿主定位、崩溃隔离、内存）与 Windows/Linux 的 WebView 进程隔离仍为 **NOT_RUN（无实测条件）**。

## Out of scope

- 新增 DOCX 应用内编辑（ADR-0015 已移除主编辑形态）。
- 变更二进制文档保真边界。
