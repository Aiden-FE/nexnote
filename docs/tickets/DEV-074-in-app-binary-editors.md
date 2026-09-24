# DEV-074 应用内二进制编辑器（docx / xlsx / xmind）

- 状态：done（v0.0.27）
- code-review 修复（2026-09-24）：
  - `binary-editor-host` 不再用 `did-finish-load` 触发 pending drain；渲染层 bootstrap 完成后主动 `binary:host:ready` ack（senderId 识别），主进程 drain。roundTrip 等待 ack 到达且 `__nexnoteHostFlush` 缺失时抛错而非静默成功。`close()` 跨 await 用 entry 引用 + webContentsId 双重核对，防止 close/reopen 销毁错对象。
  - `xmind` `content.json` sheet/rootTopic 上未建模字段（boundaries/relationships/theme/skeleton/topicPositioning）原样保留。
  - `xlsx` 关系 Id 冲突时丢弃重建端同 Id 项并回填原包关系；OpenXML 引用方写死 Id 不改名。
  - `binary:gitignore:set` 切换跟踪：保留 CRLF 与其它用户行，仅管理标记 + 三种扩展名；启用时同步 `git rm --cached` 已入库副本。
  - 编辑器/dir 行 onDrop 支持 Finder 拖入 docx/xlsx/xmind；外部路径仍仅主进程 dialogs 可见。
- 新增测试：`binary-editor-host.test.ts`（5 用例含 delayed bootstrap、ack timeout、interleaved close race）、`binary-xmind.test.ts`（content.json 字段保留）、`binary-xlsx.test.ts`（rId 冲突）、`binary-gitignore.test.ts`、`editor-drop-import.test.tsx`。
- 范围：packages/shared, packages/main, packages/renderer
- 架构依据：ADR-0015（accepted，含 2026-09-22 R3 修订与 spike 4 内存基线）
- 选型（R3 OSS 组合）：
  - xlsx：`@fortune-sheet/react`（编辑）+ `@corbe30/fortune-excel`（.xlsx 导入导出）
  - docx：`mammoth`（读 .docx→HTML）+ TipTap（编辑）+ `docx`（dolanmiu/docx，重建 .docx）
  - xmind：`simple-mind-map`（编辑 + .xmind 导入导出）

## 背景
产品诉求：在产品内直接打开并编辑 docx / xlsx / xmind，达到类似 WPS / 语雀 / Notion 的编辑预览效果。
现状事实：
- `packages/main/src/docx/` 自研为 Markdown 投影 + 段落级 docx-edit，UX 上限不足，且硬约束「原件只读、导出绝不覆盖」与新语义冲突。
- Univer 的 xlsx/docx 导入导出在 Proprietary 的 `@univerjs-pro/*`（含 license server），与本地优先定位冲突；已否决。
- `TabKind` 现仅 `welcome|page|docx|graph|settings`；fs-service 默认视图只返回 `.md/.markdown/.docx`。

## 核心语义
- **仓库内副本（Vault Copy）**：导入即在知识库内生成合规文件，内容与外部原件一致，此后与原件脱钩；可原地覆写、随 Git 版本化、可直接交外部软件使用。
- **docx 为语义级往返而非字节级保真**：段落/标题结构、加粗/斜体、表格内容、字体色、对齐保留；页眉页脚、编号样式、上下标不保留；需在 user guide 显式告知。
- **只读保留区**：xlsx 宏/图表/透视表、xmind 高级主题样式/外框/关联线不支持编辑，只读标注，保存时原字节不丢失。

## 实施任务
1. **依赖与许可**：root package.json 新增上述 5 个运行时依赖；`licenses/` 追加 MIT/BSD-2-Clause 随附许可文本；确认 Electron 打包可用。
2. **shared 契约**：
   - `TabKind` 追加 `'xlsx' | 'mindmap'`（与 `'docx'` 并列，不抽象 binary）。
   - 新增/扩展 IPC 通道命名空间：二进制文件导入（fail-closed zip/XML 校验）、读取、保存；复用现有 fs 沙箱 resolve；外部路径不接受 renderer 提供。
3. **main 进程**：
   - 导入服务：xlsx/xmind/docx 统一入口，落盘 vault 副本并写 sidecar 元数据；失败给明确错误。
   - 改写 `packages/main/src/docx/`：撤销「原件只读/导出绝不覆盖」硬约束及相关测试断言；自研投影保留为导入校验与降级路径。
   - xlsx 转换走 fortune-excel；docx 读 mammoth、写 dolanmiu/docx；xmind 读写走 simple-mind-map parse/export 逻辑（Node 侧 bundle）。
   - Git：二进制文档默认跟踪，设置项可切为不跟踪（写 `.gitignore`），不改动 ADR-0003 同步护栏。
4. **renderer**：
   - `openDocumentTab` 路由扩展：`.xlsx`→xlsx tab，`.xmind`→mindmap tab，`.docx`→可编辑 tab（替换现有只读 openDocx）。
   - 三类编辑器各运行在独立 `WebContentsView`（宿主边界、崩溃隔离）；保存/主题/命令经 IPC 桥；脚本资源按需加载。
   - 保存时机：编辑即写（debounce）+ 关闭 tab/窗口等待 pending 落盘完成。
   - 入口：页面树右键导入、拖拽到页面树/编辑器、命令面板；不做系统文件关联。
   - fs-service 默认视图扩展返回 `.docx/.xlsx/.xmind`；文件名搜索命中。
   - v1 不进双链/回链/关系索引/AI 召回。
5. **并发策略**：二进制文档 tab 并发上限 ≤3（可在 设置→编辑器 放宽至 1–8），超出按 LRU 关闭最早打开的 tab。

## 验收
- [x] 三种文件经三种入口导入（页面树「新建」菜单 / 命令面板 / openDocumentTab 路由），损坏文件 fail-closed 被拒绝且错误可操作（`binary-xlsx.test.ts`、`binary-xmind.test.ts` 覆盖拒绝路径）
- [x] xlsx：多 sheet、公式、合并单元格、基础样式（加粗/字体色/对齐/填充）往返保留（`binary-xlsx.test.ts` 往返用例）；宏/图表/透视表读取时识别为只读标注（`parseXlsxToModel` readonly 摘要）
- [x] docx：段落/标题/加粗斜体/表格/字体色/对齐保留（`binary-docx.test.ts` 往返用例）；不保留项（页眉页脚/编号样式/上下标）计数并在编辑器顶部与 user guide 明确告知
- [x] xmind：文本/树结构/备注/超链接/标签/概要往返（`binary-xmind.test.ts`）；外框/关联线在解析端不实现，读取结果带只读标注
- [x] 编辑器独立 WebContentsView 宿主（`packages/main/src/binary/binary-editor-host.ts`，崩溃隔离）；关闭 tab/窗口前 `flushAll`/`flushPending` 等待 pending 写入完成（ADR-0015 Decision 6）
- [x] `pnpm typecheck` 0 errors；`pnpm lint` 0 errors（7 warnings 均为改动前既存）；`npx vitest run` 1549 passed / 2 skipped（0 failed）；`pnpm build` PASS（含 editor-host.html 多页产物）
- [x] 测试与门禁证据按 DEV-ARCH-001 模式写入本 ticket（2026-09-22，worktree `.wt/DEV-074`，分支 `dev/DEV-074`）

## 实施记录（2026-09-22）

- 依赖（root package.json）：`@fortune-sheet/react`、`@corbe30/fortune-excel`、`mammoth`、`docx`、`simple-mind-map` + 转换所需的 `exceljs`/`jszip`/`xml-js`；renderer 增 TipTap 扩展与 `@tiptap/react`。许可文本追加至 `licenses/binary-editors/`（MIT + BSD-2-Clause + NOTICE）。
- shared：`TabKind` 追加 `'xlsx' | 'mindmap'`；`binary:*` IPC 命名空间（import/read/save/docx:read/docx:save/gitignore:host 生命周期）；docx 语义块模型 + HTML 子集解析 `shared/src/editor/docx-blocks.ts`（host 与 main 共用）；vault 设置 `binary.maxConcurrentTabs`（默认 3，clamp 1–8）。
- main：`packages/main/src/binary/`（xlsx-convert 用 fortune-excel FortuneFile 读 + exceljs 写；xmind-convert 复刻 simple-mind-map 纯数据层；docx-semantic 用 mammoth 读 + dolanmiu/docx 写；binary-service 统一 fail-closed 校验/乐观锁保存；binary-editor-host 管理 WebContentsView）；`document-domain` formatForPath 扩展 `.xlsx/.xmind`，`DOCUMENT_CAPABILITIES` write=true（撤销「原件只读」）；`DocumentService.write` 仍拒绝二进制格式（文本通道边界）；IPC 校验器与 `binary-handlers` 注册。
- renderer：`openDocumentTab` 路由 `.docx/.xlsx/.xmind`；`tab-store.openBinaryTab` LRU 并发控制（docx/xlsx/mindmap 合并计数）；`BinaryTabView` 宿主生命周期编排；`binary-host/` 编辑器宿主页面（editor-host.html 多页构建，TipTap/fortune-sheet/simple-mind-map 各自独立挂载）；设置页并发放宽滑杆；页面树「新建」菜单 + 命令面板导入入口。
- user guide：新增「8.5 应用内编辑 docx / xlsx / xmind」，显式告知 docx 语义级往返不保留项（页眉页脚、编号样式、上下标）。
- 改写既有断言：`docx-edit.test.ts` 能力矩阵 write:true；`open-document.test.ts` docx 路由改经 openBinary；`new-note-menu.test.tsx` 菜单项 3→5；`user-facing-copy.test.ts` 约束命令面板无票据标识。
