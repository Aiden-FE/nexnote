# Tauri WebView 启动与编辑器矩阵（DEV-117）

> 审查日期：2026-10-15。当前证据来自 `Tauri Release (candidate)` run 38675478473（commit `93196d6`）与本仓测试；不得把启动冒烟等同为编辑器交互验收。

| 平台 / WebView | 已验证 | 编辑器 fixture | 结论 |
| --- | --- | --- | --- |
| macOS arm64 / WKWebView | ad hoc 重签名后 `codesign --verify --deep --strict` 通过；打包 App 启动并创建窗口 | NOT_RUN | pass 仅限 packaged boot |
| macOS x64 / WKWebView | 同上 CI job 通过 | NOT_RUN | pass 仅限 packaged boot |
| Windows x64 / WebView2 | release 二进制启动 20s 未退出且 `MainWindowHandle != 0` | NOT_RUN | pass 仅限 packaged boot |
| Linux x64 / WebKitGTK（xvfb + 软件渲染） | release 二进制启动，xdotool 按 name/class 找到窗口 | NOT_RUN | pass 仅限 headless boot |

## 尚未验证的编辑器 fixture

- 块文档新建、输入、选区、格式化、撤销/重做。
- 中文/英文 IME composition 与候选窗定位。
- 块 drag handle、页面树/Tab 拖拽、外部文件拖放。
- CodeMirror 源码模式、快捷插入、composition。
- React Flow 图谱拖拽/缩放。
- ResizeObserver、Clipboard、打印预览输入。

因此 DEV-117 不能标 `done`；三平台启动矩阵已经解除“无法启动”风险，但编辑器兼容性仍是 DEV-125 cutover 前置门槛。
