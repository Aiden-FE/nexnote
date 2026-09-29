# DEV-097 未编辑空白文档关闭时应自动删除

- 状态：done（2026-09-28）
- 分类：bug
- 优先级：P2
- 工作量：M
- 范围：packages/renderer（tab-store、EditorView、TabStrip）
- 来源：用户反馈 2026-09-28 / triage 2026-09-28

## 背景

用户在文档顶栏页签区域点击 "+" 按钮新建并打开一个空白文档，未做任何编辑就直接关闭该页签时，期望这个空白文档被自动删除。当前行为是：文件在页签打开时就已写入磁盘，关闭页签仅移除内存中的 TabDescriptor，磁盘文件残留。

## 现状（核实）

- **"+" 按钮**：`TabStrip.tsx:235-245` 调用 `openTab({ kind: 'page', title: '未命名页面' })`，无 `pagePath`。
- **文件立即落盘**：`EditorView.tsx:413-422` 的 load effect 在文件不存在时立即写入 `未命名页面.md`（内容 `# 未命名页面\n\n`），用户尚未编辑文件就已存在于磁盘。
- **关闭无清理**：`closeTab()`（`tab-store.ts:189-200`）仅做数组过滤移除 tab，无任何文件删除或清理逻辑。
- **dirty 不可见**：dirty 状态仅在 `EditorView` 内部以 `useRef` 跟踪（`EditorView.tsx:313`），tab store 的 `TabDescriptor` 无 dirty/edited 字段，close 时无法判断文档是否被编辑过。
- **对比 `createPage()`**：`create-page.ts` 中的 `createPage()` 函数（用于 Cmd+T）会先创建文件再打开 tab，走的是不同路径；"+" 按钮绕过了它。

## 期望行为

1. 用户通过 "+" 按钮新建空白页签后，若**未做任何编辑**就关闭该页签，对应的磁盘文件应被自动删除。
2. 若用户已编辑过内容（dirty = true），关闭时**不删除文件**（保持当前行为，或后续增加保存提示——但不在本票范围内）。
3. 同一文件被多个 tab 打开时，关闭其中一个 tab 不应删除文件（需检查是否有其他 tab 引用同一路径）。
4. 删除操作应静默完成，不弹确认对话框（因为文件内容本就是自动生成的占位内容）。

## 关键接口

- `TabDescriptor` 需新增 `dirty` 或 `edited` 字段（或由 tab store 提供查询机制），使 `closeTab` 能感知文档是否被编辑。
- `EditorView` 的 `dirtyRef` 需提升为 tab store 可见状态（例如通过 `setDirty(tabId, boolean)` 回调），或在 close 时由 tab store 向 EditorView 查询。
- `closeTab()` 需在关闭前判断：(a) 该 tab 是否从未被编辑；(b) 对应文件是否为自动生成（内容等于初始占位 `# 未命名页面\n\n`）；(c) 无其他 tab 引用同一路径。三者皆满足时调用 `fs:deleteFile`（或等价 IPC）删除文件。
- 需考虑 `closeOtherTabs`、`closeTabsToRight`、`closeTabsForPath` 等批量关闭场景，同样适用清理逻辑。

## 验收标准

- [ ] 通过 "+" 新建空白页签，未编辑直接关闭，磁盘上不残留 `未命名页面.md`
- [ ] 通过 "+" 新建空白页签，编辑内容后关闭，文件保留在磁盘
- [ ] 同一文件被两个 tab 打开时，关闭其中一个不删除文件
- [ ] 批量关闭（关闭其他 / 关闭右侧）同样遵循上述规则
- [ ] 不影响 Cmd+T / `createPage()` 路径的正常新建行为
- [ ] 相关测试覆盖上述场景；`pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿

## Out of scope

- 关闭已编辑文档时的保存提示（需独立 ticket）
- 二进制 tab（docx/xlsx/xmind）的同类清理（路径不同，需单独处理）
- 文件回收站机制（直接删除即可，因为内容是自动生成的占位内容）
