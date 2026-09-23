# DEV-086 工具栏表格行列操作折叠为一个菜单（不再平铺挤占空间）

- 状态：ready-for-agent
- 分类：enhancement
- 优先级：P2
- 工作量：S
- 范围：packages/renderer
- Depends: 无
- 来源：用户反馈 2026-09-22
- 重审：triage 2026-09-22 —— 现状核实：光标位于表格内时，4 个表格上下文动作作为扁平顶级按钮插入到「插入」菜单前（`entries.tsx:290-306`，注释 "DEV-070：光标位于表格内时，在插入菜单前插入 4 个表格上下文动作"）；`ToolbarMenuSpec` 已支持（entries.tsx:176-186），改造点明确

## 背景

当块编辑器光标在表格内时，工具栏会插入 4 个表格操作按钮（行后增 / 列后增 / 删行 / 删列），与「撤销/重做/标题/格式/插入/AI」等顶级按钮同层（`packages/renderer/src/editor/toolbar/entries.tsx:290-306`）。这 4 个按钮占用了大量水平空间，挤压了更常用的撤销/重做/标题等动作；同时其语义内聚（都是表格内操作），适合折叠为子菜单。

现状（核实）：
- 4 个 action id：`table:row-below` / `table:column-right` / `table:row-delete` / `table:column-delete`（`entries.tsx:298-303`，定义在 `packages/shared/src/editor/editor-actions.ts:312-379`）。
- 编辑器命令分发：`addRowAfter` / `addColumnAfter` / `deleteRow` / `deleteColumn` 在 `packages/renderer/src/editor/EditorView.tsx:937-948`。
- 光标在表格内的判定：`editor.isActive('table')` on `selectionUpdate`（EditorView.tsx:686-690），由 `inTable` prop 传入 `blockToolbarEntries`。
- 工具栏渲染：扁平 flex row，溢出时折入「更多」按钮（`packages/renderer/src/editor/toolbar/EditorToolbar.tsx:327-360` 与 `overflow.ts`）；`kind: 'menu'` 已有现成模式（entries.tsx:235-261 的 FORMAT_MENU_ID / INSERT_MENU_ID）。
- smoke 与既有测试引用：`packages/kernel/tests/slash-table-actions.test.ts` 引用 4 个 id，不依赖工具栏形态。

## 期望行为

1. **折叠为单一「表格」菜单**：光标在表格内时，把 4 个 action 合并为一个 `ToolbarMenuSpec`（kind: 'menu'），挂入原插入位（替代 4 个独立 `ToolbarActionSpec`）；菜单 label / icon 与现有菜单风格对齐（参考 FORMAT_MENU_ID / INSERT_MENU_ID，entries.tsx:235-261）。
2. **菜单项顺序**：建议「在下方插入行」「在右侧插入列」「删除行」「删除列」—— 与现有 action 顺序一致；可用 `kind: 'separator'` 在中间分一组（插入组 / 删除组），让菜单不至于平铺到底。
3. **可见性**：仅当 `inTable` 为 true 时该菜单出现在工具栏中；离开表格即移除（与原行为一致）。进入 / 离开菜单本身不影响光标位置。
4. **保留所有命令可达**：现有快捷键（如有）、slash 命令（`/插入表格`）、编辑器命令都不受影响——只是 UI 层从顶级按钮改成菜单。
5. **不影响溢出行为**：工具栏现有「更多」溢出策略继续生效；新的「表格」菜单与其它顶级按钮同等参与溢出折叠。

## 关键接口

- `packages/renderer/src/editor/toolbar/entries.tsx`：将 `entries.tsx:296-306` 的 4 个 action splice 替换为一个 menu entry；menu 的 `items` 由 `editorActionsForMode` 派生或直接写子项；id 建议 `toolbar-table-menu`（新增），避免与任何 `table:*` action id 冲突。
- 编辑器命令分发（`EditorView.tsx:937-948`）不变。
- 既有 `table:*` action 定义（`editor-actions.ts:312-379`）保持不变；菜单内子项继续引用它们。
- 数据契约：`ToolbarMenuSpec` 已具备 `items: ToolbarSubItemSpec[]`（entries.tsx:176-186）；不需要新增类型。

## 验收标准

- [ ] 光标在表格内时，工具栏在原插入位出现一个「表格」菜单（而非 4 个独立按钮）
- [ ] 菜单内 4 项可见、可点击，行为与原先 4 个按钮一致
- [ ] 光标离开表格后该菜单自动消失（与原 inTable 行为一致）
- [ ] 工具栏溢出逻辑不受影响；窄窗口下仍能正确折叠
- [ ] 现有 slash 命令、快捷键、命令面板触发表格操作的行为不变
- [ ] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿；`slash-table-actions` 测试仍过

## Out of scope

- 新增表格操作（如「上方插入行」「左侧插入列」「合并单元格」「切换表头」）—— 这些命令本身存在（TipTap `addRowBefore` / `addColumnBefore` 等），但属新增能力，不在本票
- 表格行/列焦点高亮（归 DEV-087 候选）
- 表格上下文菜单（右键单元格）