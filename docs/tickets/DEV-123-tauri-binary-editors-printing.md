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

## Out of scope

- 新增 DOCX 应用内编辑（ADR-0015 已移除主编辑形态）。
- 变更二进制文档保真边界。
