# DEV-117 Tauri 三 WebView 编辑器兼容矩阵

- 状态：partial
- 分类：architecture / risk-spike
- 优先级：P0
- 工作量：L
- 日期：2026-10-14
- 关联：DEV-ARCH-002、DEV-116、ADR-0001、ADR-0028

## 背景

Tauri 2 在 macOS 使用 WKWebView、Windows 使用 WebView2、Linux 使用 WebKitGTK。NexNote 的核心交互是 TipTap contenteditable、块拖拽、CodeMirror、多语言 IME、React Flow 图谱、文件拖放和大 DOM 滚动；这是全面迁移最高风险，优先级高于后端大规模翻译。

## 方案

1. 建立同一 Renderer 的固定编辑器验收 fixture：
   - 块文档新建、输入、选区、格式化、撤销/重做；
   - 中文/英文 IME composition 与候选窗定位；
   - 块 drag handle、页面树/Tab 拖拽、外部文件拖放；
   - CodeMirror 源码模式、快捷插入、composition；
   - React Flow 图谱拖拽/缩放；
   - ResizeObserver、Clipboard、打印预览输入。
2. 在每个平台记录：
   - WebView/OS 版本、输入法、缩放、硬件；
   - 复现步骤与录屏/截图；
   - 与 Electron Chromium 基准的差异；
   - blocker / workaround / accepted difference / not-run。
3. macOS 先完成本机实测；Windows/Linux 仅保留可执行计划与环境阻塞记录。
4. 若 WKWebView 或 WebKitGTK 出现无法修复的 blocker，必须回到 ADR-0028 重新评审迁移可行性，而不是继续迁移后端。

## 验收标准

- [ ] macOS WKWebView 完成全部 fixture，记录版本、输入法与结果。
- [ ] Windows WebView2 真实 GUI 实测：**NOT_RUN（当前无 Windows 环境）**。
- [ ] Linux WebKitGTK 真实 GUI 实测：**NOT_RUN（当前无 Linux 图形环境）**。
- [ ] 差异矩阵进入 `docs/tauri/webview-editor-matrix.md`，并有复现步骤。
- [ ] 发现 blocker 时更新 ADR-0028 与 DEV-ARCH-002，不隐藏风险。
- [ ] 在有环境前，本票状态最多 `partial`，不得 `done`。

## 2026-10-15 审查结论

CI 已在 macOS WKWebView（arm64/x64）、Windows WebView2、Linux WebKitGTK/xvfb 完成 release 包启动冒烟；启动矩阵记录于 `docs/tauri/webview-editor-matrix.md`。块编辑、IME、拖拽、CodeMirror、React Flow、Clipboard 与打印预览交互仍未实测，本票保持 `partial`。

## Out of scope

- 修复所有编辑器缺陷；本票先判定风险并拆修复票。
- SQLite/Git/AI 后端迁移。
