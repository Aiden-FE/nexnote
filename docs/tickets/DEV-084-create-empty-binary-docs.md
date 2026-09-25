# DEV-084 支持直接新建 docx / xlsx / xmind 空白文档（而非只能导入）

- 状态：done（v0.0.26）
- 分类：enhancement
- 优先级：P2
- 工作量：M
- 范围：packages/main、packages/renderer
- Depends: DEV-074（in-app binary editors，已落地，提供 save/read/import 链路）；与 DEV-085（导入入口分离）配套实施
- 来源：用户反馈 2026-09-22
- 重审：triage 2026-09-22 —— 现状核实：新建菜单目前仅 `native-block` / `markdown` 两个 .md 选项（`NewNoteMenu.tsx:16-31`），二进制文档只能走导入路径；要求扩展为四类空白文档创建

## 背景

新建页菜单的 ITEMS 数组（`packages/renderer/src/features/sidebar/page-tree/NewNoteMenu.tsx:16-31`）目前只支持 `native-block` 和 `markdown` 两个 .md 格式（都经 `createNoteIn` → `fs:createNote` → `createNote` 在 `packages/main/src/fs/page-ops.ts:60-86` 落盘 `# name` body）。二进制文档（docx / xlsx / xmind）只能走导入（DEV-074 在 v0.0.24 已落地）：

- 三个二进制格式的读取与保存已具备：`paragraph` 标签块 ↔ docx 通过 `docx-semantic.ts`（mammoth / dolanmiu-docx）；xlsx ↔ fortune-sheet 通过 `xlsx-convert.ts`；xmind ↔ simple-mind-map 通过 `xmind-convert.ts`；统一入口 `BinaryService`（`packages/main/src/binary/binary-service.ts`）。
- 但 `BinaryService.importBinary`（`binary-service.ts:64-102`）**要求 base64 输入**，传空 bytes 会抛 `BINARY_EMPTY`（line 87）；不存在"空白模板"路径。

## 期望行为

1. **main 侧新建空白 docx/xlsx/xmind**：新增三个 main 入口（在 `BinaryService` 或新 `binary:create` IPC handler），按 kind 输出：
   - **docx**：调用 `blocksToDocx([], title)`（`docx-semantic.ts:79`）生成含 1 个空段落的 docx 字节。
   - **xlsx**：调用 `writeModelToXlsx({ sheets: [{ name: 'Sheet1', celldata: [], config: {} }] })`（`xlsx-convert.ts:90`）生成单 sheet 空白工作簿。
   - **xmind**：调用 `writeModelToXmind({ data: { text: title }, children: [] }, title)`（`xmind-convert.ts:229`）生成单根节点思维导图。
   - 落盘到 vault 根（或指定目录），命名复用 `nextUntitledName` 模式（page-ops.ts:36-51）。
   - 写 `.nexnote` sidecar metadata：`{ format: kind, sourceSha256 }`（与 import 路径一致）。
2. **renderer 入口**：在新建菜单 ITEMS 数组中新增三个 `NewNoteFormat` 类型变体（或单独走另一组件），对应 `new-note-docx` / `new-note-xlsx` / `new-note-xmind` 三个 testid（如保留 smoke 契约）；点击后调用新 IPC `binary:create`，随后 `openTab`。
3. **菜单分组调整**：与 DEV-085 配套，把"导入"项移出本菜单；本菜单只放"新建"项（四种格式）。本票只动新建侧，DEV-085 处理导入。
4. **不破坏现有导入路径**：import handler 保持不变，本票只增不删；renderer 仍要保留调用 import 的入口（迁移到 DEV-085 的新位置）。
5. **错误处理**：若任一格式的空白模板生成失败（理论上不该，但异常路径仍要兜底），IPC 返回明确错误码，renderer 弹 toast（复用既有 toast 机制）；与 `BinaryServiceError` 命名对齐。

## 关键接口

- main：`binary:create(kind: BinaryKind, opts: { targetDir?: string; title?: string })` IPC handler；新增 `BinaryService.createBinary(kind, targetDir, title?)`；落盘走 `fs.importBinaryFile`（`fs-service.ts:181-249`，其已有"原子写 + 冲突重命名"语义）。
- shared：`NewNoteFormat` 增加 `docx` / `xlsx` / `xmind` 三值；`BinaryKind` 已存在（`'docx' | 'xlsx' | 'mindmap'`）—— 注意 `xmind` 在 BinaryKind 中是 `'mindmap'`（`binary-service.ts:24`），需对齐。
- renderer：NewNoteMenu 的 ITEMS 数组新增三个；testid 沿用 `new-note-docx/xlsx/xmind`（smoke 已在用，参见 `NewNoteMenu.tsx:198/224/247`）—— 这点要小心：现有 testid 关联的是"导入"项，**复用同名 testid 会让 smoke 误判为通过**。本票应该用新 testid（如 `new-note-empty-docx/xlsx/xmind`），**待 DEV-085 落地后由其更新 smoke 契约**。或：本票只新增空白创建入口、不改 ITEMS，复用 `NewNoteMenu` 之外的二级菜单（与 DEV-085 的方案解耦）；具体 UI 由 agent 与 DEV-085 一起决策。

## 验收标准

- [x] 新建菜单（或对应入口）能创建空白 docx / xlsx / xmind，并在仓库内形成对应扩展名的可打开文件
- [x] 创建后默认打开该文件，编辑器为对应格式的二进制编辑器（docx 块编辑、xlsx 表格、xmind 思维导图）
- [x] 不破坏现有导入路径（docx/xlsx/xmind 的导入入口仍可用，smoke 同步）
- [x] 命名冲突自动加 `name 2.ext` / `name 3.ext`（沿用 `nextUntitledName`）
- [x] `pnpm typecheck` / `pnpm lint` / 相关 Vitest / 端到端冒烟全绿
- [x] 新增单测：每种 kind 的空白模板字节可解析回 `parseXlsxToModel` / `parseXmindToModel` / `readDocxToHtml`（fail-closed 不破）

## Out of scope

- 导入入口的迁移（归 DEV-085）
- 默认模板多样化（如"财务模板""项目计划模板"）
- 空白 docx 的字体/页面样式调整（沿用 `blocksToDocx` 的默认）
- 空白 xmind 的样式/主题调整