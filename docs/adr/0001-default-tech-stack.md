---
status: accepted
---

# MVP 默认技术栈组合

NexNote MVP 的桌面壳/前端/UI/编辑器内核/存储映射/索引/Git 路线，在四份研究报告（docs/research/ 下 desktop-shell、editor-kernel、competitor-arch、git-integration）基础上收敛为单一默认组合：**Electron + React + TypeScript + TailwindCSS + shadcn/ui + TipTap 3（内核独立为框架无关包，含 @tiptap/markdown、UniqueID、DragHandle、Suggestion）+ Markdown/frontmatter 沿用 Obsidian 公开方言（块 ID 用 `^id` 锚点、不发明新内嵌语法）+ SQLite 单库（FTS5 全文 + Link Index 关系表 + sqlite-vec 向量）+ simple-git（系统 git 探测 ≥2.23，dugite-native 捆绑回退）**。

## Considered Options

- **Tauri 2 + Rust 后端**：体积约 14MB vs 187MB，但三端三种 webview 引擎（Linux WebKitGTK IME bug 链、macOS WKWebView 拖拽拦截）对块编辑器风险过高，且同赛道产品（Obsidian/Logseq/SiYuan/AFFiNE）均为 Electron；否决为主选，仅保留为未来重评选项。
- **Milkdown**：唯一 markdown-first 双向管道，保真上限最高，但块 UX 薄、单人维护面大；保留为 TipTap 3 markdown round-trip spike 失败时的切换备选。
- **自创存储方言**：与 Obsidian vault 互操作立场冲突，否决。

## Consequences

- Electron 体积/内存为接受代价。
- shadcn/ui 主题 CSS 变量需与 ProseMirror/TipTap 样式体系桥接。
- TipTap 3 markdown round-trip spike（Obsidian 方言保真验证）为开发首个里程碑的强制验证项；失败即切 Milkdown 备选。

> 注：本文的 Git 绑定策略（simple-git + 系统 git 优先 + dugite 捆绑回退）已修订为「默认捆绑 Git + 系统凭证集成 + 系统 Git 高级回退」，见 [ADR-0002](./0002-bundled-git-by-default.md)。
