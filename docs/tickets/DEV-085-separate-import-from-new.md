# DEV-085 导入入口与新建入口分离：导入归到文件操作组

- 状态：done（v0.0.26）
- 分类：enhancement
- 优先级：P2
- 工作量：S
- 范围：packages/renderer
- Depends: DEV-074（import 入口）；与 DEV-084（新建空白二进制文档）配套；DEV-084 落地后本票才动菜单结构
- 来源：用户反馈 2026-09-22
- 重审：triage 2026-09-22 —— 现状核实：导入三项与新建混在 NewNoteMenu 同一个 dropdown（`NewNoteMenu.tsx`），与 page-tree context menu（`packages/renderer/src/features/sidebar/page-tree/index.tsx:121-189`）；rename/delete/reveal 也同处一份菜单；与"导入是文件操作"的语义不符

## 背景

「导入」是把仓库外的文件（docx / xlsx / xmind）通过 `BinaryService.importBinary`（`packages/main/src/binary/binary-service.ts:64-102`）落盘到 vault 副本，是文件操作；「新建」是创建空白文档，是文档生命周期起点。当前两者被混在一起。

现状入口（已核实）：
- **新建下拉按钮**（`packages/renderer/src/features/sidebar/page-tree/NewNoteMenu.tsx`）：ITEMS 仅 `native-block` / `markdown`（lines 16-31）；下方紧跟导入 DOCX / XLSX / XMIND 三项（lines 195-267），用 `<div className="my-1 border-t" />` 分隔（lines 194 / 219）；目前 5 项混在一个 dropdown。
- **page-tree 节点右键菜单**（`packages/renderer/src/features/sidebar/page-tree/index.tsx:121-166`）：顺序为 新建笔记 / 新建文件夹 / separator / 导入 DOCX / 导入 XLSX / 导入 XMIND / separator / 重命名 / 删除 / separator / 在 Finder 中显示。
- **空白区域右键菜单**（`index.tsx:167-189`）：顺序为 新建笔记 / 新建文件夹 / 导入×3（no rename/delete/reveal，因无选区）。
- **命令面板**（`packages/renderer/src/features/commands/builtin.ts:221-244`）：`binary.importDocx/importXlsx/importXmind` 三个命令，归类「文档」。
- **拖拽外部文件**（`index.tsx:351-362` 的 `importDroppedFile`，`EditorView.tsx:163`，`SourceModeView.tsx:220`）：经 `fs:importBinaryFile` 落盘；这是无菜单的入口，本票不动。

## 期望行为

1. **新建菜单只放"新建"**：NewNoteMenu 的 ITEMS 数组在 DEV-084 落地后只保留/扩展为「新建块文档 / 新建 Markdown / 新建空白 DOCX / 新建空白 XLSX / 新建空白 XMIND」五项；导入三项移出本菜单。
2. **导入归到"文件操作"组**：
   - **page-tree 工具栏新增"导入"按钮**：与"新建"并列（或紧邻），点击调起导入选择对话框（沿用 `docx:import` / `binary:import` IPC，main 侧 `dialogs.pickFile`，`packages/main/src/ipc/docx-handlers.ts:25-33` 与 `binary-handlers.ts:55-78`）。
   - **右键菜单分组调整**：把"导入"三项移到"重命名 / 删除 / 在 Finder 中显示"附近（即「文件操作」分区），与新建区分隔；空白区域右键菜单把导入三项并入新分区；不要让"重命名"出现在空白区域（保持现状）。
   - **导入 popup（若使用二级菜单）**：建议二级菜单含三项导入，与现有文件操作按钮风格一致。
3. **命令面板**：`binary.importDocx/Xlsx/Xmind` 保留（命令面板与上下文菜单是两个入口；不在本菜单≠不可发现）。
4. **拖拽入口**：维持现状。
5. **smoke 契约**：当前 smoke 检查的 testid `new-note-docx/xlsx/xmind`（`NewNoteMenu.tsx:198/224/247`）指的是导入项。DEV-084 落地后这些 testid 的语义冲突由 agent 一并更新；本票统一在新位置命名 `import-docx/xlsx/xmind`（或等价 testid）并更新 smoke。`tree-new-note` / `new-note-menu` 等不变。
6. **不要重复**：导入功能本身不变；只是 UI 分区与 testid 变化。

## 关键接口

- renderer `NewNoteMenu.tsx`：删除导入三项（lines 195-267）及其分隔线；ITEMS 数组由 DEV-084 扩展。
- renderer `page-tree/index.tsx`：右键菜单（`index.tsx:121-166`、`167-189`）按上述分组重排；工具栏 `index.tsx:287-292` 的 NewNoteMenu 旁新增一个"导入"按钮组件（沿用现有按钮风格）。
- 新增组件：建议 `ImportMenu.tsx`（与 `NewNoteMenu` 同形态），testid 用 `tree-import-menu` / `import-docx` / `import-xlsx` / `import-xmind`。
- 命令面板 builtin.ts：本票不动。

## 验收标准

- [x] 新建下拉菜单不含"导入"项，只含"新建"项（DEV-084 落地后含 5 项）
- [x] page-tree 工具栏有独立的"导入"入口；点击弹出三项选择
- [x] 右键菜单"新建"组与"导入 / 文件操作"组明确分组；空白区域右键菜单保持结构但导入移到文件操作组
- [x] 拖拽外部文件、命令面板、context menu 三条路径的导入功能全部正常
- [x] smoke 契约更新：`import-docx/xlsx/xmind` 通过；旧的 `new-note-docx/xlsx/xmind` 若语义改变则相应调整或删除
- [x] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿

## Out of scope

- 直接新建空白二进制文档（归 DEV-084）
- 导入流程本身的改造
- 命令面板导入命令的位置调整（命令面板与上下文/工具栏入口解耦）
- 拖拽入口的体验调整