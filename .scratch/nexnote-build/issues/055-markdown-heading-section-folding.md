# DEV-055 · Markdown 标题章节折叠

Type: dev
Module: editor
Status: open
Blocked by: DEV-054（标题章节折叠语义与交互基线）
Depends: DEV-020（CodeMirror 原文编辑）、DEV-047（Markdown 标题目录）
Effort: L
Priority: P1

## Scope

依据 ADR-0013，在 Markdown 源码视图与分栏视图编辑侧提供 CodeMirror gutter 标题章节折叠，并与块编辑保持相同章节边界和临时状态语义。实时预览和预览视图继续展示完整页面。

### 交付内容

1. 为 ATX H1–H6 与 Setext H1/H2 在 gutter 提供可辨、可键盘操作的 disclosure 控件；无章节内容时不提供操作。
2. 折叠范围遵循标题之后到下一个同级或更高级标题之前的章节边界；blockquote 标题仍参与目录但首期不可折叠。
3. 源码视图与分栏编辑侧在同一 tab 生命周期内共享折叠状态；分栏实时预览与预览视图始终完整展示。
4. 支持嵌套状态、标题改名、空标题、同名标题及层级变化；无法可靠映射时安全展开。
5. 键盘导航跳过隐藏内容，查找/跳转可由后续集成展开必要祖先；折叠不改变完整文档选择与保存语义。
6. 关闭并重新打开页面后全部展开，不写正文、frontmatter、sidecar 或 vault 配置。

## 安全不变量

- 折叠前后 Markdown 文件字节必须完全一致，不能插入标记、锚点或规范化源码。
- CodeMirror 折叠不得改变 undo/redo 文档历史，不得遮蔽或篡改实时预览数据源。
- 解析或折叠失败不得阻断源码编辑与保存；错误范围不得吞掉相邻章节。

## 验收标准

- [ ] ATX 与 Setext 标题章节可从 gutter 通过鼠标和键盘折叠；blockquote 标题无折叠控件。
- [ ] 同级/高层级边界、嵌套、空/同名/改名标题和升降级行为与块编辑语义一致。
- [ ] 源码与分栏编辑侧状态连续，实时预览和预览视图不跟随折叠。
- [ ] 折叠、展开、跨视图及重开页面均不改变 Markdown 字节；重开默认全部展开。
- [ ] 键盘导航、完整选择、保存和 undo/redo 不把视觉隐藏当作内容删除。
- [ ] 既有三视图、滚动同步、标题目录、frontmatter 与原文保真测试不回归。
- [ ] 候选 SHA 上通过标准门禁；Electron smoke 未执行时记录 `NOT_RUN`。
- [ ] 在 `.wt/DEV-055` / `dev/DEV-055` 隔离实现，完成 Standards + Spec 双轴审查后方可合并。

## 关联决策

- [ADR-0013](../../../docs/adr/0013-heading-section-folding.md)
- [ADR-0004](../../../docs/adr/0004-source-mode-replaces-split-pane.md)（2026-09-17 修订）
- 术语：[CONTEXT.md](../../../CONTEXT.md) 标题章节 / 标题折叠 / Markdown 视图
