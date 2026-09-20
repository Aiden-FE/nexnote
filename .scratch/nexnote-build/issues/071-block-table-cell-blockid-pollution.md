# DEV-071 · 块文档表格切回后单元格追加 `^id` 乱码（block ID 污染）

Type: dev
Module: editor
Status: ready-for-agent
Blocked by: 无
Depends: 无
Effort: S
Priority: **P0（数据污染）**

## What to build

块文档插入表格 → 切到其他 tab（或切到 Markdown 视图）→ 切回来时，表格**每个单元格**内容末尾追加形如 `^rz1j8s53` 的 Obsidian 风格块 ID 后缀。删除该后缀再切回，依然会重新出现。属于**写盘数据污染**：Markdown 表格 cell 文本已被注入 `^<id>` 后缀，且每次切回都会被再次序列化注入。

triage 已确认根因（agent 需复核）：

- `packages/renderer/src/editor/markdown/block-id.ts:40-46` 的 `BLOCK_ID_TYPES` 白名单包含 `paragraph` / `heading` / `listItem` / `codeBlock` / `table`，允许 UniqueID 对这些类型自动分配 blockId。
- 表格 `tableCell` / `tableHeader` 的子节点默认是 `paragraph`，因此 cell 内段落也被自动分配 blockId。
- `injectPlaceholderForBlockIds`（block-id.ts:287 起）对 `isInlineIdHost`（即 `paragraph`）在序列化前把 `^<id>` 作为内联占位符追加到段落末尾；Markdown 表格 cell 序列化把该占位符原样写入 cell 文本。
- 同文件 170-171 行的注释明确写着"表格单元格等嵌套内容保持字面文本，用户写的 `^alpha` 不得被吞掉"——但当前代码只在**parse 方向**对嵌套内容做了保护，**serialize 方向**没有对齐，形成不对称缺口。
- cell 内的 `^<id>` 回读时被当作普通文本，随后 UniqueID 又为该段落分配新 blockId，循环污染，删除后永远会再长回来。

修复方向（agent 决定最小侵入）：

1. **serialize 方向过滤**：在 `injectPlaceholderForBlockIds` / `stripIds` 路径上，当 paragraph 处于 `tableCell` / `tableHeader` 内时**不注入** `^<id>` 占位符；cell 文本保持纯净。
2. **parse 方向兜底**：`liftPlaceholdersToBlockIds` 对 cell 内段落的 `extractTrailingPlaceholder` 结果直接丢弃（不提升为 blockId），与新用户手动写的 `^alpha` 字面文本语义一致。
3. **UniqueID 白名单裁剪**：评估把 `paragraph` / `heading` 从自动分配范围中按"是否位于表格 cell 内"细化（或干脆不自动分配给 cell 内段落）。
4. **脏数据迁移**：发布前需提供一次性清理（agent 评估是否本期纳入；建议作为 acceptance criteria 的一部分）。

约束：

- 不影响 blockId 在非表格段落上的现有行为（双链角标、DEV-044 既有成果不回归）。
- 不改 `table` 节点本身的 blockId 注入（整表锚点仍走独立 `^id` 行）。
- 保持用户在 cell 内手写 `^alpha` 的字面文本不被吞掉（parse 方向既有语义）。
- 脏数据迁移需幂等：重复执行不产生二次副作用。

## Acceptance criteria

- [ ] 单元/集成测试：块编辑器插入 3x3 表格 → 输入文本 → 切到其他 tab / 切 Markdown 视图 → 切回；每个 cell 文本**不包含** `^<id>` 后缀，写盘 Markdown 同样干净。
- [ ] 单元测试：构造含 cell 内 `^id` 后缀的脏 Markdown → 切到块视图 → 切走 → 切回；cell 文本干净、后缀不持久化（幂等）。
- [ ] 非表格段落上的 blockId（`^<id>` 后缀）行为不回归：双链角标、`[[链接#^id]]` 跳转相关既有测试全绿。
- [ ] 表格整体锚点（整表后独立 `^id` 行）行为不回归。
- [ ] 用户在 cell 内手写 `^alpha` 字面文本不被吞掉。
- [ ] 提供脏数据清理方案（一次性命令或下次打开时自动迁移），并附说明与幂等性测试。
- [ ] 六门禁通过。

## Blocked by

None (can start immediately).

## 实现记录

- 候选 SHA：`2fb3757`（dev/DEV-071，基于 master `240d52c`）。
- 实现落点：`packages/kernel/src/markdown/block-id.ts`（非 brief 中预估的 renderer 路径，kernel 包为权威实现处）。
- serialize 方向：`injectPlaceholderForBlockIds` 拆出 `injectPlaceholderForBlockIdsInContext(node, inCell)`，进入 `tableCell`/`tableHeader` 后对 paragraph/heading 剥除 blockId 属性而非注入占位符；`stripIdsInCell` 处理无内容节点。
- parse 方向：`liftPlaceholdersToBlockIds` 在 walkNodes 之后追加 `stripCellAnchorsDeep`——递归进入单元格宿主，剥除段落末位文本节点的 `^id`（`CELL_TRAILING_ANCHOR_RE` 要求锚点前有空白；`CELL_ONLY_ANCHOR_RE` 处理整段仅锚点的空 cell 污染形态），中部 `^alpha` 字面文本保留。打开脏文件即完成迁移，幂等。
- 脏数据迁移：采用「下次打开自动清理」方案（parse 时剥除 + 下次保存写盘干净），无需独立一次性命令。
- 测试：新增 `packages/kernel/tests/block-id-cells.test.ts` 7 用例（serialize 不注入 / 脏数据剥除+幂等 / 整段锚点 / 中部保留 / 模拟 UniqueID 补 ID 全链路 / 非表格段落不回归 / 表格整体锚点不回归）。

## 门禁与证据

- vitest：159 files passed / 1 skipped，1489 passed / 2 skipped（含新增 7 用例；kernel 包 18 files 240/240）。
- typecheck（pnpm -r）：PASS。
- eslint（改动文件 + 全仓门禁口径）：PASS。
- build（electron-vite）：PASS。
- verify-release-config：31/31 PASS。
- `git diff --check master...HEAD`：PASS。
- 双轴审查：Standards PASS / Spec PASS（对照候选 `0d4bd90`）。
