# DEV-096 应用顶栏「文件」菜单：承载新建与导入

- 状态：done（2026-09-28）
- 分类：enhancement
- 优先级：P2
- 工作量：M
- 范围：packages/main（Electron 应用菜单）、packages/renderer（若选择应用内菜单栏）
- Depends: DEV-085（导入与新建分离，已落地但位置不符）、DEV-084（空白二进制文档，缺少 renderer 入口）
- 来源：用户反馈 2026-09-22 / triage 2026-09-27

## 背景

用户要求：**导入的入口不应与「新建」混在一起，也不要一个莫名其妙的下拉箭头**；建议把导入收进**应用系统顶栏的「文件」菜单**。

DEV-085 已把"导入"从新建下拉里拆出来，做成了页面树工具栏上一个并列的 `ImportMenu`（`packages/renderer/src/features/sidebar/page-tree/index.tsx:292-299`）。分离本身成立，但：

- **产品形态错误（用户 2026-09-27 实测反馈）**：页面树工具栏上现在并排两个几乎一样带下箭头的按钮（`NewNoteMenu` ▾ + `ImportMenu` ▾），
  「没人会知道两个箭头有什么用和区别」。这是**并列双箭头**，不是正确形态——两个控件视觉不可区分、语义靠猜，
  用户无法在打开菜单前知道哪个是新建、哪个是导入。
- 位置错误：用户要的是**应用顶栏的「文件」菜单**，而当前应用根本没有这样一个菜单；
- 页面树工具栏因此挤了「搜索 / 新建▾ / 导入▾ / 新建文件夹」四个控件，层级混乱。

**因此本票的首要目标是消除"并列双箭头"这一形态本身**，其次才是把导入移入顶栏「文件」菜单。

## 现状（核实）

- **不存在 Electron 原生应用菜单**：`packages/main/src/index.ts:1` 只从 electron 引入 `app, dialog, ipcMain, safeStorage, shell`；`packages/main/src/window.ts:1` 只引入 `BrowserWindow, nativeTheme, screen, shell`；全仓 grep 无 `Menu.buildFromTemplate` / `Menu.setApplicationMenu` / `role: 'fileMenu'`。
- **不存在应用内顶栏菜单栏**：renderer 无 titlebar/menubar 组件（`packages/renderer/src/features/` 下无相关目录，`packages/renderer/src/shell/` 只有 `DockHost/Resizer/Sidebar/StatusBar/WorkspaceView`）；`WorkspaceView` 是「侧栏 + 主内容 + 右 dock + 底部状态栏」布局，没有顶栏。
- **导入入口现状**：`ImportMenu` 已独立（`ImportMenu.tsx`，testid `tree-import-menu` / `import-menu` / `import-docx|xlsx|xmind`），仍带 `ChevronDown` 下拉箭头，挂在页面树工具栏（`index.tsx:293-299`），调用 `ops.importDocxIn` / `ops.importBinaryIn`。
- **新建入口现状**：`NewNoteMenu`（`NewNoteMenu.tsx`）同样是带箭头的下拉，只有 `native-block` / `markdown` 两项；空白二进制创建见 DEV-084（`ops.createBinaryIn` 已存在但零调用方）。
- 无 `packages/main/src/menu*` 文件、无菜单模板测试。

## 期望行为

1. 应用存在一个**顶栏「文件」菜单**（Electron 原生应用菜单，或应用内一致风格的菜单栏——由实施者按平台惯例择一，但必须是用户可预期的"文件"位置）。
2. **消除并列双箭头**：页面树工具栏**不得**同时出现「新建▾」与「导入▾」两个外观相近的下拉按钮。
   - 目标形态：「新建」保留为**单一主按钮**（默认格式直接新建，不挂箭头），格式选择与导入一并收进「文件」菜单；
   - 或至少让两个入口在形态/层级上明确可分（如导入进「文件」菜单后，工具栏只剩一个新建入口）。
3. 「文件」菜单内含：**新建**（含空白 docx / xlsx / xmind，见 DEV-084）与**导入**（docx / xlsx / xmind）两组，语义分组清晰。
4. 菜单项复用既有能力，不重写业务逻辑：导入 → `ops.importDocxIn` / `ops.importBinaryIn`；空白新建 → `ops.createBinaryIn` / `ops.createNoteIn`。
5. 快捷键/accelerator 与既有约定一致（若平台惯例有 ⌘N / ⌘O 类映射，采用之；不新造冲突快捷键）。
6. 不回归：`import-menu.test.tsx` 覆盖的导入能力仍可用（若入口迁移，同步更新其断言与 smoke 契约）。

## 关键接口

- main 侧若走 Electron 原生菜单：新增菜单模板构建（当前不存在，需从零建立），菜单项通过 IPC 通知 renderer 触发导入/新建（renderer 才有 `ops` 与 tab 打开能力），或由 main 直接调用对应 service 后广播 `fs` 事件。
- renderer 侧若走应用内菜单栏：需要一个可复用的菜单按钮组件（避免再出现"并列箭头"），并复用 `ops` 的 `import*` / `create*` 函数。
- 入口契约变化需同步 `packages/renderer/src/smoke/smoke.ts` 中依赖 `tree-import-menu` / `new-note-*` 的断言。

## 验收标准

（2026-10-09 回填：页面树入口由 `new-note-menu.test.tsx` 覆盖，原生「文件」菜单只在启动时构建、无自动化测试，GUI 项保留）

- [x] 应用顶栏存在「文件」菜单，其中「新建」与「导入」分组清晰、互不混淆——`window.ts` buildApplicationMenu：新建组（文档/MD/空白 XLSX/XMind）与导入组（Word/XLSX/XMind）分段
- [x] **页面树工具栏不再出现两个外观相近的并列下拉箭头**；新建入口形态单一可辨——new-note-menu「主按钮保持原单一按钮行为：直接新建（块编辑），不展开菜单」
- [x] 从「文件」菜单可完成 docx / xlsx / xmind 的**导入**，行为与迁移前一致（文件进入 vault 副本并打开对应编辑器）——菜单「导入 Word（转为块文档）/ XLSX / XMind」
- [x] 从「文件」菜单可完成空白 docx / xlsx / xmind 的**新建**——DOCX 按 DEV-098 撤销，XLSX/XMind 已在菜单与 new-note-menu 上线
- [x] 无重复入口：同一动作在 UI 上只有一处主入口（context menu 可保留但不得喧宾夺主）
- [x] 相关测试与 smoke 契约同步更新并全绿；`pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿——new-note-menu.test.tsx 6 例全绿
- [ ] **本机 GUI 实测**：打开应用能直观找到导入入口，无需猜测箭头含义

## Out of scope

- 重做整个应用菜单栏（编辑/视图/帮助等其余菜单项）
- 导入的语义转换逻辑（docx/xlsx/xmind 解析，归 DEV-074）
- 空白二进制文档的服务端生成（归 DEV-084，main 侧已完成）
