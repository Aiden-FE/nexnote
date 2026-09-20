# DEV-070 · 块文档表格快捷插入行/列

Type: dev
Module: editor
Status: ready-for-agent
Blocked by: 无
Depends: 无
Effort: M
Priority: P1

## What to build

Markdown 文档可直接编辑 Markdown 语法增加行列；块文档插入表格后**没有任何 UI 入口**来增加行/列——既无工具栏按钮，也无 slash 菜单条目，也无划词工具栏。用户反馈明确指出"MD 文档还能手动添加，块文档直接没有任何办法"。

triage 排查定位：

- 块编辑器扩展装配已注册 `TableKit`（来自 `@tiptap/extension-table` 套件），原生命令 `addRowBefore/After`、`addColumnBefore/After`、`deleteRow/Column`、`mergeCells` 等均可用。
- 当前块编辑器顶部工具栏 `EditorToolbar.tsx`、slash 菜单 `source-slash-menu.ts`、划词工具栏 `source-bubble.ts` 均未暴露任何 table-row / table-column 命令按钮。
- Markdown 视图之所以"能手动添加"是因为它本身渲染原始 Markdown 文本，用户可手敲 `| ... |` 新增行；块视图是 WYSIWYG，没有等价入口。
- 表格已是块文档合法节点（slash 菜单可插入），扩展命令链路完备，问题纯在 UI 暴露层。

triage 定位到的代码点（agent 需校验）：

- `packages/renderer/src/editor/toolbar/entries.tsx`（icon-first 工具栏注册点）
- `packages/renderer/src/editor/toolbar/EditorToolbar.tsx`
- `packages/renderer/src/editor/source/source-slash-menu.ts`（slash 菜单注册点）
- `packages/renderer/src/editor/interactions/bubble/source-bubble.ts`（划词工具栏）

修复方向（agent 决定最小侵入）：

1. **顶部工具栏**：当光标落在 `editor.isActive('table')` 时，工具栏出现"下方插入行 / 右侧插入列 / 删除当前行 / 删除当前列"4 个 Icon-first 按钮，沿用 DEV-050/DEV-063 的 SVG 图标库。
2. **slash 菜单**：在 `editor.isActive('table')` 时增加"插入行 / 插入列 / 删除行 / 删除列"条目，与现有菜单视觉一致。
3. **划词工具栏**：本期**不**增加表格按钮（避免误触；后续按反馈再加）。
4. **键盘可达**：TipTap `@tiptap/extension-table` 默认 `Tab` 在末列末行自动新增一行，验证保留即可；可选扩展 `Mod+Shift+方向键` 视情况纳入（agent 评估）。

约束：

- 不修改 `@tiptap/extension-table` / `TableKit` 默认行为；仅包装官方命令。
- 不破坏 Markdown 视图的"手敲 Markdown"路径。
- 按钮图标沿用既有 Icon-first 风格（DEV-050 / DEV-051 / DEV-063），不引入新图标库。
- 按钮的禁用态需正确处理：例如仅 1 行/1 列时禁用"删除当前行/列"。

## Acceptance criteria

- [ ] 块编辑器插入 2x2 表格后，光标落在单元格内：
  - 顶部工具栏出现"插入行 / 插入列 / 删除行 / 删除列"按钮，点击可执行对应官方命令。
  - slash 菜单 `/` 触发后出现同 4 个条目。
  - `Tab` 在末列末行自动新增一行（TipTap 默认行为）。
- [ ] Markdown 文档侧"手敲 Markdown 新增行"行为不回归。
- [ ] 划词工具栏不引入 table 行/列按钮。
- [ ] icon-first 与 slash 菜单的样式/间距与既有工具栏（DEV-050 / DEV-051 / DEV-052）一致。
- [ ] 单测：mock editor 断言工具栏 / slash 菜单在 `isActive('table')` 下渲染对应按钮；断言命令调用。
- [ ] 六门禁通过。

## Blocked by

None (can start immediately).

## 实现记录

- 候选 SHA：`32e1abc5740a15e897d45b58b461b1e98f670a0b`（dev/DEV-070，基于 master `2129a3b`）。
- shared（`src/editor/editor-actions.ts`）：新增 `QuickInsertCapability` 值 `'table-cursor'`；新增 4 个 catalog 动作 `table:row-below` / `table:column-right` / `table:row-delete` / `table:column-delete`，`modes: ['block']`、quick 契约 execution `insert-at-cursor` + capability `table-cursor`。
- kernel：
  - `quick-insert.ts`：新增 view→editor WeakMap 注册表（`registerEditorView`/`getEditorForView`），plugin `view()` 回调登记；`triggerContext` 在 `isNodeActive(view.state, 'table')` 时把 `'table-cursor'` 加入 capabilities，slash 菜单可见性由既有 capability 管道自动过滤；sync 提交路径补齐 `afterSlashCommit` 回调执行（与 explicit-ai/external-command 路径对齐）。
  - `quick-insert-catalog.ts`：4 个 handler 经 `afterSlashCommit` 在 slash trigger 消费提交后调用 editor 官方命令 `addRowAfter`/`addColumnAfter`/`deleteRow`/`deleteColumn`。
- renderer：
  - `toolbar/entries.tsx`：`blockToolbarEntries` 新增 `inTable` 选项，true 时把 4 个动作插入插入菜单之前；导出 4 个动作 id 常量。
  - `EditorView.tsx`：新增 `inTable` 反应式状态，selectionUpdate/update 时布尔比对仅跨越边界才 setState；`runToolbarCommand` 分发 4 个表格命令。
- 划词工具栏按 brief 不增加表格按钮；Markdown 手敲路径不变。

## 门禁与证据

- 新增测试：`kernel/tests/slash-table-actions.test.ts` 4 用例（cell 内可见 / 普通段落隐藏 / row 动作执行后行数 +1 且 trigger 消费 / deleteRow 行数 -1）；`renderer/tests/toolbar-table-entries.test.tsx` 3 用例（inTable 显隐、插入菜单前排序、动作类型）。
- vitest 全量：163 files passed / 1 skipped，1505 passed / 2 skipped（首轮 1 fail 为 chokidar flake 既有基线，重跑全绿）。
- typecheck（pnpm -r）：PASS。
- eslint（改动文件 0 errors）：PASS。
- build（electron-vite）：PASS。
- verify-release-config：31/31 PASS。
- `git diff --check master...HEAD`：PASS。
- 双轴审查：Standards PASS / Spec PASS（候选 `32e1abc5740a15e897d45b58b461b1e98f670a0b`）。
