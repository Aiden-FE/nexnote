# DEV-084 支持直接新建 docx / xlsx / xmind 空白文档（而非只能导入）

> **2026-09-28 撤销说明（DEV-098）**：本票的 docx 部分（新建空白 docx、仓库内 docx 编辑）
> 已被 DEV-098 撤销——docx 不再入库编辑，导入即转 .md 块文档。
> xlsx / xmind 新建能力保留。详见 `docs/tickets/DEV-098-remove-docx-editing.md`。

- 状态：done（2026-09-28）
- 分类：enhancement
- 优先级：**P1**（用户报"仍只能导入"；主进程能力已就绪，缺 UI 接线）
- 工作量：S（剩余部分）
- 范围：packages/main（已完成）、packages/renderer（**待补**）
- Depends: DEV-074（in-app binary editors，已落地，提供 save/read/import 链路）；与 DEV-085（导入入口分离）配套实施
- 来源：用户反馈 2026-09-22
- 重审：triage 2026-09-22 —— 现状核实：新建菜单目前仅 `native-block` / `markdown` 两个 .md 选项（`NewNoteMenu.tsx:16-31`），二进制文档只能走导入路径；要求扩展为四类空白文档创建
- 重审：triage 2026-09-27 —— **上文 2026-09-22 的"现状核实"仍然准确，本票并未真正收口**。逐项复核当前工作树：
  - **main 侧确实已落地**：`binary:create` IPC 已注册（`packages/shared/src/ipc/channels/binary.ts:45`，payload `:81-84`），handler 在 `packages/main/src/ipc/binary-handlers.ts:91-102`，服务 `BinaryService.createBinary`（`packages/main/src/binary/binary-service.ts:116-140`），空白字节生成 `renderEmptyBinary`（`:262-274`，docx=`blocksToDocx([])`、xlsx=`writeModelToXlsx`、xmind=`writeModelToXmind`），含冲突重命名与 sidecar；测试 `packages/main/tests/binary-create-empty.test.ts` 覆盖三格式 + 冲突 + 清洗 + sidecar。
  - **renderer 入口缺失（用户不可达）**：`NewNoteMenu.tsx:16-31` 的 ITEMS **仍只有** `native-block` / `markdown`；`NewNoteFormat` 仍是 `'native-block' | 'markdown'`（`packages/renderer/src/features/sidebar/page-tree/ops.ts:16`），shared 类型扩展未做；`createBinaryIn`（`ops.ts:59-66`）**零调用方（死代码）**，全仓 grep 只命中定义本身；无 renderer 测试覆盖空白创建。
  - 因此第 40 行"新建菜单能创建空白…"的勾选**当前不成立**，属过早勾选（勾的是 main 能力而非用户可达路径）。

## 剩余工作（triage 2026-09-27）

把已就绪的 `binary:create` 接到用户可见入口，使本票验收标准第 1、2 条真正成立：

1. renderer 新建入口提供空白 docx / xlsx / xmind 三种创建项，点击调用 `createBinaryIn`（或等价 `invoke('binary:create')`）并打开对应二进制编辑器 tab。
2. 入口位置与 DEV-096（顶栏文件菜单）协调：若 DEV-096 先落地，空白创建项应放在同一「文件」菜单里，不再另起一个诡异的下拉箭头。
3. `NewNoteFormat` / 相关共享类型按需扩展（注意 `BinaryKind` 中 xmind 记为 `'mindmap'`，需对齐）。
4. 补 renderer 测试覆盖"从入口创建空白三种格式"，避免再次出现"后端有、前端没有调用方"的静默缺口。

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

（2026-10-09 收口：triage 2026-09-27「入口不存在」的结论已过期——`NewNoteMenu.tsx` 的 `new-note-xlsx` / `new-note-xmind` 与窗口菜单「新建空白 XLSX / XMind」均已上线。docx 部分按 DEV-098 撤销，不再属于本票范围。）

- [x] 新建菜单能创建空白 xlsx / xmind，并在 vault 内形成对应扩展名的可打开文件（`packages/renderer/src/features/sidebar/page-tree/NewNoteMenu.tsx`，testId `new-note-xlsx` / `new-note-xmind`；窗口菜单同）
- [ ] 新建空白 docx —— **不再需要**（DEV-098 已撤销仓库内 docx 编辑，导入即转 .md 块文档）
- [ ] 创建后默认打开该文件，编辑器为对应格式的二进制编辑器（xlsx 表格、xmind 思维导图） ← **人工 GUI 实测项**
- [x] 不破坏现有导入路径（docx/xlsx/xmind 的导入入口仍可用，smoke 同步）
- [x] 命名冲突自动加 `name 2.ext` / `name 3.ext`（沿用 `nextUntitledName`）—— main 侧 `binary-create-empty.test.ts` 已覆盖
- [x] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿（`binary-create-empty.test.ts` 5 例全绿）
- [x] 新增单测：每种 kind 的空白模板字节可解析回 `parseXlsxToModel` / `parseXmindToModel` / `readDocxToHtml`（fail-closed 不破）—— `packages/main/tests/binary-create-empty.test.ts`

## Out of scope

- 导入入口的迁移（归 DEV-085）
- 默认模板多样化（如"财务模板""项目计划模板"）
- 空白 docx 的字体/页面样式调整（沿用 `blocksToDocx` 的默认）
- 空白 xmind 的样式/主题调整
