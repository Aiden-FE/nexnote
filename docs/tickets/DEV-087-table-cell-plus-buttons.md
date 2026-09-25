# DEV-087 表格单元格焦点加号图标：行左下加行、列右上加列

- 状态：实现完成（待发布 v0.0.27）
- 分类：enhancement
- 优先级：P2
- 工作量：M
- 范围：packages/kernel（PM 插件）、packages/renderer（图标样式与挂载）
- Depends: 无（与 DEV-086 解耦；可独立实施）
- 来源：用户反馈 2026-09-22
- 重审：triage 2026-09-22 —— 现状核实：表格用 `@tiptap/extension-table` 3.31.3，内核包仅在 prosemirror-tables 之上加了 `^blockId` 往返（`packages/kernel/src/extensions/code-table.ts:44-96`）；焦点/选区状态由 `tableEditing` 插件提供（`CellSelection` / `selectedRect`）；`selectionUpdate` hook 可观察 cell 焦点（`packages/renderer/src/editor/EditorView.tsx:686-690` 已用 `isActive('table')`）

## 背景

块编辑器表格（TipTap 3）当前只暴露列宽拖拽（prosemirror-tables `columnResizing`），没有任何焦点态的"加号"图标。用户希望：

- 鼠标焦点在某个**行**（某行任一单元格获焦）时，该行**左下角**出现一个加号图标，点击 → 在该行下方插入新行。
- 鼠标焦点在某个**列**（某列任一单元格获焦）时，该列**右上角**出现一个加号图标，点击 → 在该列右侧插入新列。
- 加号图标应该 hover/focus 时显示，避免常驻遮挡；点击立即触发；视觉与编辑器工具栏图标风格一致（lucide `Plus` 类）。

## 现状（核实）

- TipTap 3 表格扩展：`packages/kernel/src/extensions/code-table.ts` 中 `KernelTable` 仅在 prosemirror-tables 之上挂 `^blockId` markdown 序列化插件；底层 `prosemirror-tables` 提供 `tableEditing` 插件与 `CellSelection`。
- 命令可用：编辑器已暴露 `addRowAfter`（EditorView.tsx:938）、`addColumnAfter`（line 941）、`deleteRow`（944）、`deleteColumn`（947）；命令面板与 slash 命令已能触达。
- 选区观察：`state.selection` 可暴露 `CellSelection`（`selection instanceof CellSelection`）+ `selectedRect({selection, roles})` 计算所在行列；`selectionUpdate` 事件已是 hook 点（参见 `drag-handle.ts` / `unified-gutter.ts` 的 addProseMirrorPlugins 模式）。
- 装饰 API：ProseMirror 的 `Decoration.widget(pos, dom, { side: ... })` 能挂任意 DOM 到文档位置；适合在行末 / 列头位置插入加号图标。

## 期望行为

1. **新建 PM 插件**（建议名 `table-cell-plus-buttons`）：在 `packages/kernel/src/extensions/table-cell-plus-buttons.ts` 实现，提供：
   - `addProseMirrorPlugins()` 返回一个 ProseMirror plugin，订阅 `selectionUpdate` / `view update`。
   - 当 `selection instanceof CellSelection` 或 `editor.isActive('table')` 时，根据 `selectedRect` 得到当前 cell 所属 row index 与 column index。
   - 通过 `Decoration.widget` 在该行最后一个 cell 的末尾（`side: -1`，视觉上"左下角"靠单元格底部对齐）插入 row-plus 按钮 DOM；该列第一个 cell 的开头（视觉上"右上角"）插入 column-plus 按钮 DOM。
2. **图标与交互**：
   - icon：lucide `Plus`（与现有工具栏图标风格一致）；尺寸 14~16px；悬浮卡片背景 + 阴影，与块级 drag-handle 视觉对齐（参考 `packages/kernel/src/extensions/drag-handle.ts` 的实现风格）。
   - 显隐：仅当鼠标位于该行/列的视觉范围（hover/focus 在 cell 内）时显示；其它时刻不显示，避免噪声。
   - 点击：调用 `addRowAfter` / `addColumnAfter`；点击后保留原焦点策略（保持新行/列的最近单元格获焦，便于连续编辑）。
3. **样式**：由 renderer 侧挂 Tailwind 类（不引入新依赖）；DOM 节点上加 `data-testid="table-row-plus"` / `data-testid="table-col-plus"` 便于冒烟与组件测试。
4. **不破坏既有交互**：
   - 列宽拖拽句柄（`columnResizing` 的 `.column-resize-handle`）继续可用，与新增按钮不冲突（位置不同）。
   - 块级 drag-handle、gutter、`addRowAfter/addColumnAfter` 命令面板入口、slash 命令、工具栏「表格」菜单（DEV-086）全部保留。

## 关键接口

- 新增 `packages/kernel/src/extensions/table-cell-plus-buttons.ts`：默认导出 `TableCellPlusButtons` Extension，调用 `Extension.create({ addProseMirrorPlugins() { ... } })`。
- 在 `packages/kernel/src/extensions/index.ts`（约 line 118-121 处 `KernelTable.configure({ resizable: true })` 旁）接入该扩展。
- renderer 不需要新增组件——插件直接产出 DOM；如有样式侵入问题，在 renderer 的 editor content styles 中补一个针对 `[data-testid="table-row-plus"]` / `[data-testid="table-col-plus"]` 的 selector。

## 验收标准

- [x] 鼠标焦点在表格某行任意单元格时，该行左下角出现加号图标；点击后该行下方新增一行，光标合理落位
- [x] 鼠标焦点在表格某列任意单元格时，该列右上角出现加号图标；点击后该列右侧新增一列，光标合理落位
- [x] 鼠标移出表格区域（hover 离开）时加号图标淡出或消失
- [x] 多个相邻 cell 选区（CellSelection）下加号仍可见且可点击；不闪烁 / 不重复出现
- [x] 列宽拖拽、块级 drag-handle、工具栏「表格」菜单、slash 命令面板命令入口 全部不回归
- [x] 新增单测：plugin 装饰计算（按 mock 选区得到正确 row/col index）、点击回调触发正确命令
- [x] `pnpm typecheck` / `pnpm lint` / 相关 Vitest / 端到端冒烟全绿

## Out of scope

- 上方插入行 / 左侧插入列的对应按钮（命令 `addRowBefore` / `addColumnBefore` 存在但属新增能力，本票只覆盖后增/右增）
- 表格右键上下文菜单
- 单元格内上下文菜单（DEV-061 块级 gutter 路线不动）