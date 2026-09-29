# DEV-087 表格单元格焦点加号图标：行左下加行、列右上加列

- 状态：done（2026-09-28）
- 分类：enhancement
- 优先级：**P1**（用户实测：功能完全不可见）
- 工作量：M
- 范围：packages/kernel（PM 插件 + 测试）、packages/renderer（globals.css）
- Depends: 无（与 DEV-086 解耦；可独立实施）
- 来源：用户反馈 2026-09-22
- 重审：triage 2026-09-22 —— 现状核实：表格用 `@tiptap/extension-table` 3.31.3，内核包仅在 prosemirror-tables 之上加了 `^blockId` 往返（`packages/kernel/src/extensions/code-table.ts:44-96`）；焦点/选区状态由 `tableEditing` 插件提供（`CellSelection` / `selectedRect`）；`selectionUpdate` hook 可观察 cell 焦点（`packages/renderer/src/editor/EditorView.tsx:686-690` 已用 `isActive('table')`）
- 重审：triage 2026-09-27（第一次）—— 静态复核判定"已完整实现并接线"，**结论错误**。
- 重审：triage 2026-09-27（第二次，用户实测反馈后）—— **用户是对的，功能实际不可见；已定位并修复两个独立缺陷**，详见下节。

## 缺陷与修复（2026-09-27）

用户实测：光标停在单元格内看不到行加号，停在列头也看不到列加号。定位到**两个叠加缺陷**；只修任一个都不会让按钮出现。

### 形态修正（用户 2026-09-27 实测反馈，共四条）

**最终形态：行 / 列加号按上下文互斥**——表头行只属于列操作，正文行只属于行操作，
二者不同时出现。按选区上边界判定，与拖拽方向无关。

1. **行加号移到表格外侧**，避免遮挡单元格内容。
   - 装饰仍挂在行内最左单元格（取其内容起点），CSS 用 `left: -1.25rem` 把它推到表格左边界之外。
   - 关键约束：`.tableWrapper` 有 `overflow-x: auto`，按规范会把 `overflow-y` 也计算为 `auto`，
     横向移出表格的内容会被裁掉。因此给 `.tableWrapper` 加 `padding-left: 1.6rem` +
     `margin-left: -1.6rem`——为按钮让出左侧空间，同时**表格位置与宽度均不变**（浏览器实测确认）。
     （`prosemirror-tables/style/tables.css` 未被本应用引入，表格自身不会 `overflow: hidden`，
     故裁剪只来自 `tableWrapper`，上述处理充分。）
2. **列加号移到表格外侧（表格上方），不侵占单元格空间**（用户反馈："加号也不应该在表格内侵占空间"）。
   - 纵向 `top: -1.3rem`：按钮整体越过表格上边框，落在表格 `margin-top` 让出的空白带里，
     单元格内容空间零占用。
   - 为提供这条空白带，表格 `margin` 由 `1rem 0` 调整为 `1.6rem 0 1rem`（下边距不变）。
     **未使用负 `margin-top`**：那会把包装盒拉进上一段的区域，使上一段底部约 0.8rem 无法点击。
   - 列加号保持在列头聚焦时出现（`info.rect.top === 0`）。
   - 右侧另加 `padding-right: 0.8rem` + `margin-right: -0.8rem`：**实测判定为必需**——
     去掉后末列加号越出包装盒（`hOverflow = 8`，产生横向滚动条且会被裁剪）。
3. **聚焦列头时不出行加号**（互斥）。表头是列操作面：`rect.top === 0` 时只产出列加号并提前返回；
   正文行只产出行加号。避免两个按钮在列头上同时出现造成歧义。
4. **两个加号都居中对齐分割线**（用户反馈："都应该对齐两行或两列间的分割线"）。
   - 行加号纵向 `bottom: -0.575rem`（= 半个按钮高 1.15rem / 2）→ 几何中心正压在**该行与下一行之间**的分割线上。
   - 列加号横向 `right: -0.575rem`（= 半个按钮宽）→ 几何中心正压在**该列与右列之间**的分割线上。
   - 半高/半宽偏移与行高、列宽无关，任意尺寸下都居中；`box-sizing: border-box` 必须先设定，
     否则 1px 边框会让实际尺寸多出 2px、把按钮推离分割线（实测暴露过此问题）。
5. **行加号锚点是本行左边，不是光标所在单元格左边**（用户反馈："鼠标聚焦单元格时，行加号是在行的左边不是在单元格左边"）。
   - 这是个**真 bug**：原实现用 `info.rect.left` 作锚点列——那是**选区**左列，普通光标下等于光标所在列。
     因此光标停在第 3 列时，行加号会贴到第 3 个单元格的左边，而不是整行的左边。
   - 修复：锚点列固定为 `0`（`cellContentStart(info, info.row, 0)`），即该行第一个单元格。
   - 已加回归测试守护：光标置于第 3 列时，断言行加号所在单元格 `cellIndex === 0` 且 `rowIndex` 为光标行；
     **该测试在修复前会失败**（已实测确认），不是空转测试。
6. **加号 hover 显示友好提示**（用户反馈："加号 hover 上去应该有 tooltip 友好提示插入行/列"）。
   - kernel 侧写入 `data-tooltip`（文案 `在下方插入行` / `在右侧插入列`，与 `aria-label` 同源），
     CSS 用 `::after { content: attr(data-tooltip) }` 渲染 —— 纯 CSS，无 JS、无组件、无原生 title 的延迟。
   - 方位按容器裁剪约束定：行加号提示放**按钮右侧**（向左会被 `tableWrapper` 裁掉）、垂直居中；
     列加号提示放**按钮下方**（按钮紧贴表格上边框，上方只剩约 0.3rem，放上方会被裁掉）。
   - 实测：6 个位置（首/中/末列 × 中/末行）的提示框**全部落在容器可视区内**，无裁剪。

### 缺陷 1（功能致命）：真实光标下装饰恒为空

原 `getFocusedRectFromDoc`（`packages/kernel/src/extensions/table-cell-plus-buttons.ts:39`）要求
`selection.$from.parent.type === schema.nodes.tableCell`。

但真实光标停在单元格里时，`$from.parent` 是单元格内的 **paragraph**，永远不是 `tableCell`。
只有"多单元格 `CellSelection`"（`$from` 解析到 cell）才会通过。因此：

- **普通点击进入单元格 / 列头 → 恒返回 `null` → 一个装饰都不产生**，与用户所见一致；
- 而原测试用 `CellSelection.create(...)` 构造选区（`table-cell-plus-buttons.test.ts:108-110`），
  恰好绕开了这条路径，所以测试全绿——**测试覆盖的是假路径，不是用户路径**。

同一文件头部注释自认此局限："happy-dom 下 ProseMirror `Decoration.widget` 行为差异较大，
因此不渲染装饰 DOM"，测试只验证了 key 集合与命令链路，从未验证按钮真的会出现。

**复现证据**（新增用例，修复前）：
```
× 普通光标停在 cell 内时应出现行/列加号（真实使用路径）
  AssertionError: expected [] to deeply equal [ 'table-col-plus', 'table-row-plus' ]
× 光标停在列头（tableHeader）时也应出现列加号
  AssertionError: expected [] to deeply equal [ 'table-col-plus', 'table-row-plus' ]
```

**修复**：改为让 prosemirror-tables 的 `selectedRect(state)` 自行解析光标所在单元格——
它内部按 `tableRole` 向上寻找 cell，**同时支持 `TextSelection` 与 `CellSelection`**，
并对 `tableHeader` 同样生效；解析失败包在 try/catch 内返回 `null`，绝不在装饰计算中抛错。
挂载点改为：行加号挂在**行内最左单元格**内容起点、列加号挂在**列内最上单元格**内容终点，
配合 CSS 贴合该单元格的左下 / 右上角。

### 缺陷 2（即使修好缺陷 1 仍不可见）：样式不可靠

按钮 DOM 由 **kernel 包**产出，类名是 Tailwind utility；而 Tailwind 的扫描根是
`packages/renderer`（`electron.vite.config.ts:35` 的 renderer root），**kernel 的类名不会被扫描**。
同时全仓没有任何 `.nexnote-table-cell-plus` CSS，也没有为该按钮设过 `::after`/定位。

**修复**：在 `packages/renderer/src/globals.css` 手写 `.nexnote-table-cell-plus` 与
`--row` / `--col` 两个方位变体；并给编辑器内 `td`/`th` 设 `position: relative`
（此前缺失，`.selectedCell::after` 的 `position:absolute` 与新增按钮都需要它作为定位包含块）。

### 验收（本次修复新增）

- [x] 普通光标（`TextSelection`）停在**正文** cell 内 → 只出现行加号，**不出现列加号**
- [x] 光标停在列头（`tableHeader`）→ **只出现列加号，不出现行加号**（行/列互斥）
- [x] 行/列上下文随光标在表头与正文之间切换而互斥切换（列头↔正文↔列头均正确）
- [x] 多 cell 纯正文选区 → 只出一组行加号；跨表头选区 → 只出一组列加号
- [x] 光标移出表格 → 加号消失
- [x] 按钮 DOM 真实渲染：行加号挂 `td` 内、列加号挂 `th` 内；互斥时另一者不存在于 DOM
- [x] **行加号锚在本行左边**：光标置于第 3 列时，行加号仍挂在该行第 0 列（`cellIndex === 0`）且属于光标所在行
      （回归测试在修复前确实失败，已验证非空转）
- [x] **hover 提示**：两个按钮均带 `data-tooltip`（`在下方插入行` / `在右侧插入列`），与 `aria-label` 一致
- [x] **几何实测（浏览器，含中间/末行末列四种位置）**：
      表格宽度 417px、左缘 60px、`tableWrapper` 横纵溢出均为 0 —— 与改动前逐项一致；
      行加号中心与行底边偏差 `dy = -0.5px`（即 1px 边框的中心）→ **正压在行分割线上**（中间行与末行一致）；
      列加号中心与列右边偏差 `dx = -0.5px` → **正压在列分割线上**（中间列与末列一致）；
      四个按钮全部落在包装盒内，不被 `overflow` 裁剪
- [x] `packages/kernel` 284 用例通过（本票 16 个）；`electron-vite build` 通过（CSS 编译无误）；改动文件 typecheck / eslint / prettier 干净
- [ ] **待应用实测**：两个加号的最终观感（表格上间距由 1rem 变为 1.6rem）与本机 GUI 手感确认

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
   - 通过 `Decoration.widget` 在行内最左侧 cell 的内容起点插入 row-plus 按钮 DOM（CSS 再把它推到**表格外侧**左方，避免遮挡内容）；在列头 cell 的内容终点插入 column-plus 按钮 DOM（贴其右上角内部）。
2. **图标与交互**：
   - icon：lucide `Plus`（与现有工具栏图标风格一致）；尺寸 14~16px；悬浮卡片背景 + 阴影，与块级 drag-handle 视觉对齐（参考 `packages/kernel/src/extensions/drag-handle.ts` 的实现风格）。
   - 显隐：**行加号**在光标位于该行任意单元格时出现；**列加号仅在聚焦列头时出现**（正文单元格不出列加号，避免干扰编辑）。装饰本身由选区驱动，光标离开表格即消失。
   - 点击：调用 `addRowAfter` / `addColumnAfter`；点击后保留原焦点策略（保持新行/列的最近单元格获焦，便于连续编辑）。
3. **样式**：样式手写在 renderer 的 `globals.css`（**不用 Tailwind utility 类**——按钮 DOM 由 kernel 包产出，Tailwind 扫描根在 renderer，kernel 的类名不会被生成）；DOM 节点上加 `data-testid="table-row-plus"` / `data-testid="table-col-plus"` 便于冒烟与组件测试。
4. **不破坏既有交互**：
   - 列宽拖拽句柄（`columnResizing` 的 `.column-resize-handle`）继续可用，与新增按钮不冲突（位置不同）。
   - 块级 drag-handle、gutter、`addRowAfter/addColumnAfter` 命令面板入口、slash 命令、工具栏「表格」菜单（DEV-086）全部保留。

## 关键接口

- 新增 `packages/kernel/src/extensions/table-cell-plus-buttons.ts`：默认导出 `TableCellPlusButtons` Extension，调用 `Extension.create({ addProseMirrorPlugins() { ... } })`。
- 在 `packages/kernel/src/extensions/index.ts`（约 line 118-121 处 `KernelTable.configure({ resizable: true })` 旁）接入该扩展。
- renderer 不需要新增组件——插件直接产出 DOM；如有样式侵入问题，在 renderer 的 editor content styles 中补一个针对 `[data-testid="table-row-plus"]` / `[data-testid="table-col-plus"]` 的 selector。

## 验收标准

- [x] 光标停在表格某行任意单元格时，该行左下角出现加号图标；点击后该行下方新增一行，光标合理落位
- [x] 光标停在表格某列任意单元格时，该列右上角出现加号图标；点击后该列右侧新增一列，光标合理落位
- [x] 光标移出表格后加号消失（装饰随选区重建；不再依赖 hover 门控——PM 聚焦的是根容器，
      `table:focus-within` 不成立，且按钮仅"选区在单元格内"时才产出，等价于原来的显示条件）
- [x] 多个相邻 cell 选区（CellSelection）下仍只出现一组加号；不闪烁 / 不重复出现
- [x] 列宽拖拽、块级 drag-handle、工具栏「表格」菜单、slash 命令面板命令入口 全部不回归
      （kernel 全量 278 用例通过）
- [x] 新增单测：普通光标路径 + 列头路径 + 移出表格路径 + 多选路径 + 命令链路
- [x] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿（待端到端冒烟）
- [ ] **真实 GUI 实测**：点击/聚焦单元格看到按钮并成功加行加列（需本机装包或 dev 运行）

## Out of scope

- 上方插入行 / 左侧插入列的对应按钮（命令 `addRowBefore` / `addColumnBefore` 存在但属新增能力，本票只覆盖后增/右增）
- 表格右键上下文菜单
- 单元格内上下文菜单（DEV-061 块级 gutter 路线不动）