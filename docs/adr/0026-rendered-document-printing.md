---
status: accepted
---

# 渲染后文档打印

NexNote 需要支持打印 active tab 中的块文档（`.md` + sidecar `format: native-block`）和 Markdown 文档（`.md`/`.markdown` + `format: markdown`），并始终打印渲染后的语义内容，而不是当前屏幕画面或 Markdown 源文本。块文档和 Markdown 文档共享同一打印架构：渲染层从编辑器或预览收集「语义 HTML + 当前应用样式」，交给主进程的专用隐藏打印窗口，再由系统打印对话框让用户选择打印机、份数、页面范围或导出 PDF。这种方式避免把工具栏、gutter、折叠控件或应用 UI 打印出来，也让块文档和 Markdown 文档的输出保持一致。

## Considered Options

- **直接打印当前窗口**：会把应用 UI 一起打出来，且无法在打印前统一清理折叠控件；否决。
- **从磁盘读取文档内容再打印**：会丢失尚未落盘的编辑内容，不符合「打印当前所见」；否决。
- **隐藏打印窗口注入渲染 HTML**：不打印应用 chrome，两种文档类型共用同一条输出路径；采纳。

## Consequences

- 未保存内容以当前编辑器内存内容为准，打印不强制触发保存。
- Markdown 文档打印时排除 YAML frontmatter，仅打印正文。
- 不在打印页上额外渲染页眉、页脚、tags 或 sidecar 元信息。
- 第一版不做 XLSX / XMind / DOCX 打印，后续扩展时沿用这条打印管线。
