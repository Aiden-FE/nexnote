# DEV-055 · Markdown 标题章节折叠

Type: dev
Module: editor
Status: implementation-complete
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

- [x] ATX 与 Setext 标题章节可从 gutter 通过鼠标和键盘折叠；blockquote 标题无折叠控件。
- [x] 同级/高层级边界、嵌套、空/同名/改名标题和升降级行为与块编辑语义一致。
- [x] 源码与分栏编辑侧状态连续，实时预览和预览视图不跟随折叠。
- [x] 折叠、展开、跨视图及重开页面均不改变 Markdown 字节；重开默认全部展开。
- [x] 键盘导航、完整选择、保存和 undo/redo 不把视觉隐藏当作内容删除。
- [x] 既有三视图、滚动同步、标题目录、frontmatter 与原文保真测试不回归。
- [x] 候选 SHA 上通过标准门禁；Electron smoke 未执行时记录 `NOT_RUN`。
- [ ] 在 `.wt/DEV-055` / `dev/DEV-055` 隔离实现；独立 Standards + Spec 双轴审查仍待候选提交后执行，合并前必须完成。

## 关联决策

- [ADR-0013](../../../docs/adr/0013-heading-section-folding.md)
- [ADR-0004](../../../docs/adr/0004-source-mode-replaces-split-pane.md)（2026-09-17 修订）
- 术语：[CONTEXT.md](../../../CONTEXT.md) 标题章节 / 标题折叠 / Markdown 视图


## 实现记录（DEV-055）

- 新增 `packages/renderer/src/editor/source/heading-fold.ts`：使用 CodeMirror Markdown 语法树解析 ATX H1–H6 与 Setext H1/H2；blockquote 标题保留在目录但不生成 disclosure；章节范围到下一个同级或更高级非引用标题或文档末尾。折叠用视图 `StateField` + replace decoration，仅隐藏显示，不修改文档。
- 标题身份使用 tab 生命周期内整数 id，并通过 transaction change mapping 调和：正文编辑、标题改名/清空/同名与单行层级变化可靠保留；删除、转非标题、跨行替换、整文档重载或其他无法证明身份的情况安全展开。父子折叠状态独立，父展开后子状态保留。
- gutter disclosure 提供 `aria-label`、`aria-expanded`、`data-fold-state`、Tab 焦点和 Enter/Space 操作；键盘切换后 gutter marker 重建由新按钮承接焦点，并去重原生 keyboard click。上下方向键跳过隐藏区，Shift+Arrow 在隐藏边界保持现有可见选区；Mod+A 保持全文选择；普通跨折叠鼠标选区截断到可见边界。
- 仅 `format=markdown` 装配扩展；源码/分栏沿用同一 CodeMirror 实例，状态跨两者连续；右侧实时预览与独立预览视图的数据源仍是完整 `textRef`，不接入折叠 decoration。目录定位先展开必要祖先，目标标题自身折叠保留。外部重载显式清空状态；新建编辑器/重开 tab 默认全展开。
- 新增真实 CodeMirror renderer 测试 `packages/renderer/tests/source-heading-fold.test.ts`（14 例），覆盖解析、边界、gutter、鼠标/键盘、焦点承接、嵌套、空/同名/改名/层级变化、删除与 Undo、方向键/Shift+Arrow、全文与鼠标选择、原文字节/CRLF/onChange/undo 历史、目录 reveal、保存源完整、重开与 native-block 排除。

### 门禁与验收记录

候选提交前工作树验证（最终 SHA 由本票提交产生）：

- 定向测试：`source-heading-fold.test.ts` 14/14；关联 `app-origin-change.test.tsx`、`source-mode-outline.test.tsx`、`codemirror-host.test.ts`、`source-mode-markdown-panel.test.tsx`、`source-mode-autosave.test.tsx`、`outline.test.ts` 等共 70/70 通过。
- 完整 `pnpm vitest run`：150 文件通过 / 1 跳过，1248 测试通过 / 2 跳过。
- `pnpm typecheck`：全部 workspace 包通过。
- `pnpm lint`：0 error；4 个既有 `import()` type annotation warning，与 master 基线相同，均非本票文件。
- `pnpm build`：Electron Vite main/preload/renderer 构建成功（仅既有 Rollup chunk/annotation warning）。
- changed-format：本票改动文件 `prettier --check` 全部通过。
- `git diff --check`：通过。
- Electron smoke：`NOT_RUN`（未执行打包应用 smoke）。

### 审查状态

- 实现阶段已做提交前代码/规格自审并修复身份映射、外部重载 fail-open、测试替身兼容与选择边界问题。
- 未预填独立双轴 PASS：固定候选提交上的 Standards + Spec 独立审查仍待执行；本票保持 `implementation-complete`，不标记 closed。

### 独立双轴首审 FAIL 与修复

固定候选 `88b4f58` 的独立 Standards + Spec 双轴首审均为 **FAIL**；不得将该候选记录为通过，最终双轴验收项继续保持未勾选。首审发现及追加修复如下：

1. **Setext 章节起点错误**：原实现把 Setext 文本行末当作正文起点，导致 underline 本身被误判为章节内容，只有标题与 underline 的 H1/H2 也出现 disclosure。现将正文起点改为语法树 Setext heading 节点末尾（越过 underline）；分别覆盖无正文 H1/H2 不显示控件，以及有正文 H1/H2 边界正确且 underline 保持可见。
2. **gutter 控件不在 accessibility tree**：CodeMirror 给 `.cm-gutters` 父容器设置 `aria-hidden=true`，原 button 虽带 ARIA 属性仍被整个子树隐藏。现保留 aria-hidden gutter 内的纯视觉、非交互 marker，并在 `EditorView.dom` 下挂载非 aria-hidden 的绝对定位 disclosure overlay；可访问 button 与视觉 gutter marker 同步状态和位置，视觉 gutter click 仍可切换。真实 DOM 测试断言 button 无 `aria-hidden` ancestor，并覆盖 Tab focus、Enter/Space、准确 `aria-label` / `aria-expanded`、marker/control 重建后的焦点承接及视觉 gutter click。

修复后仍不预填独立双轴 PASS；必须在追加修复候选 SHA 上重新进行独立 Standards + Spec 双轴审查，方可勾选最终项或合并。
