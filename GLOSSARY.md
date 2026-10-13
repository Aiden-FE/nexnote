# NexNote

本仓库的领域语言基线。这里的术语用于沟通应用内文档模型与用户可见行为，而不是实现细节。

## Language

**Document**:
Vault 中的一份内容文件；当前包括块文档、Markdown 文档、XLSX、XMind 等格式。
_Avoid_: Page, note

**Block document**:
以块编辑器为权威视图的 `.md` 文档，sidecar `format` 为 `native-block`。
_Avoid_: Native block, block note

**Markdown document**:
以源码模式为权威视图的 `.md`/`.markdown` 文档，sidecar `format` 为 `markdown`。
_Avoid_: Plain Markdown, MD document

**Printing**:
把当前 active 文档的渲染语义内容交给系统打印流程的行为；不包含打印应用 UI。
_Avoid_: Screenshot, export
