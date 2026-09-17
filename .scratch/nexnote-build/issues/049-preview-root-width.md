# DEV-049 · 预览视图根容器仍为半宽

Type: bug
Module: editor
Status: closed
Blocked by: DEV-048 / v0.0.13
Effort: S
Priority: P0

## 用户反馈

v0.0.13 中 Markdown 预览视图依然只使用约半边空间。

## 根因

DEV-048 只解除了 LivePreview **内层内容列**的 46rem 限制，并把隐藏的源码 pane 移出 flex 流；但 LivePreview 根节点同时带 `.nexnote-editor-scope`，全局 CSS 仍有：

```css
.nexnote-editor-scope { max-width: var(--editor-content-width); }
```

因此整个 LivePreview flex item 本身被限制为 46rem，`flex-1` 无法占满父容器。先前 smoke 在窄窗口只比较内层内容列与已被截窄的 preview 根容器，未比较 preview 根与 markdown 布局，导致假绿。

## 修复

移除 `.nexnote-editor-scope` 的 `max-width`；宽度约束只由 LivePreview 内层内容列控制：分栏模式保持 `max-w-[var(--editor-content-width)]`，预览视图使用 `max-w-none`。新增 `markdown-view-layout` testid 和真实 Electron 几何断言：LivePreview 根宽与布局宽之差 ≤2px。

## 证据（2026-09-17）

同一条 Electron smoke 检查先红后绿：

- 修复前：253/254，`preview=644px layout=1057px`（失败）。
- 修复后：254/254，`preview=1057px layout=1057px`（通过）。

证据目录：`.scratch/nexnote-build/smoke/DEV-049-red/`、`.scratch/nexnote-build/smoke/DEV-049-green/`。
