# DEV-094 待办列表（taskList/taskItem）删除后残留空白行

- 状态：done（2026-09-28）
- 分类：bug
- 优先级：P1
- 工作量：S
- 范围：packages/kernel（列表扩展）
- Depends: DEV-069（列表删除空白行修正，只覆盖无序/有序列表）
- 来源：用户反馈 2026-09-22 / triage 2026-09-27

## 背景

块编辑器删除 TODO/待办列表项后，原地仍留下一条空白行。用户给的清单本身就是从待办列表复制来的，中间夹着空白行——正是这个残留。

DEV-069 修了无序列表（`bulletList`）与有序列表（`orderedList`）的同类问题，但**待办列表（`taskList` / `taskItem`）没被覆盖**，所以用户仍能复现。

## 现状（核实）

- 扩展装配：`packages/kernel/src/extensions/index.ts:122-123` 注册 `TaskList`、`TaskItem.configure({ nested: true })`；`:144` 注册 DEV-069 的修复扩展 `ListDev069`；`:110-113` 给 `orderedList` 加 `keepAttributes`。kernel/renderer 内没有自定义 `ListKeymap`，走 TipTap 3 StarterKit 默认（`@tiptap/extension-list` 的 listKeymap 默认同时处理 `listItem` 与 `taskItem`）。
- **修复的覆盖面不够**：`ListDev069`（`packages/kernel/src/extensions/list-dev069.ts:23-49`）里 `isSandwichedEmptyListItem` 硬要求当前节点是 **`listItem`**（`:33`），且父列表是 **`bulletList`/`orderedList`**（`:35`）。粘贴的清单解析为 `taskList > taskItem`，探测返回 `false`，`removeSandwichedEmptyListItem`（`:52-61`）不触发，Backspace 落回默认 `handleBackspace`；其 `$from.index(itemDepth) !== 0` 判定会拒绝"夹在中间"的项，最终由 ProseMirror 默认 lift 留下空段落 → **空白行**。
- 序列化往返：`TaskItem.renderMarkdown` 经 `renderNestedMarkdownContent(node, h, prefix)`，被清空的段落会被序列化为 `- [ ] ` 之类，空行在保存/回读后仍存在。`@tiptap/markdown` 的 `createImplicitEmptyParagraphsFromSpace` 会把列表项之间的裸空格展开为隐式空段落（kernel 在 `packages/kernel/src/markdown/pipeline.ts:149-152` 已注明该上游行为，normalize 仅在测试中使用）。
- 测试覆盖：`packages/kernel/tests/list-dev069.test.ts:85-109` 只有 `- 甲` 与 `1.` 两组用例，**没有 taskItem 用例**。
- git 历史：DEV-069 由 `1dba20d` 落地（经 `2129a3b` 合并，已含在 master），此后 `list-dev069.ts` 无后续提交——修复真实存在但未覆盖待办列表路径。

**结论：在待办列表上仍可复现。**

## 期望行为

1. 在待办列表中间某项被清空后按 Backspace，该 `taskItem` **整体被删除**，不残留任何空白段落/空白行。
2. 待办列表首/尾项退出列表的行为与无序/有序列表一致（"退出列表"语义保留）。
3. 删除整段待办列表、或只留最后一项时，不产生多余空行。
4. 保存 → 回读（Markdown 往返）后行为不退化：不重新冒出空行，待办勾选状态保持。
5. `bulletList` / `orderedList` 既有行为与 DEV-069 的有序列表编号连续性不回归。

## 关键接口

- `isSandwichedEmptyListItem`（`packages/kernel/src/extensions/list-dev069.ts:23-49`）的列表类型判定需同时接受 `taskList`（`:35`），节点探测需同时接受 `taskItem`（`:29,:33`），空判定需兼容 `taskItem` 的子结构（含 checkbox 语义）。
- 若 `taskItem` 空态结构不同于 `listItem`（子节点数量/类型），空段落判定需按实际 schema 调整，不改命令层契约。
- `ListDev069` 的 `addKeyboardShortcuts().Backspace`（`:66-73`）返回 `true` 时才短路默认 keymap，务必只在真正命中的用例短路。

## 验收标准

（2026-10-09 回填：`list-dev069.test.ts` 的「DEV-094 · 待办列表」段覆盖，相关套件全绿）

- [x] 3 项待办列表清空中间项并按 Backspace → 只剩 2 项且无空白行——「3 项待办列表删中间项：整体删除，不留空白行，剩 2 项」
- [x] 待办列表末尾项/首项按 Backspace 的退出行为与无序列表一致，不残留空段——「空 taskItem 位于首/尾时探测返回 false（让默认 lift 退出列表）」
- [x] Markdown 导出再回读：待办项数量、勾选状态、无多余空行——「已勾选（checked）的中间空 taskItem 同样被整体删除且不改变其他项勾选态」
- [x] `bulletList` / `orderedList` 行为不回归（DEV-069 用例全绿，含有序编号连续）——同文件 DEV-069 段
- [x] 新增单测覆盖 `taskItem` 的"夹在中间空项被整体删除"，与现有 `list-dev069.test.ts` 用例并列
- [x] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿

## Out of scope

- 有序列表重新计数（DEV-069 已覆盖）
- 列表内嵌套列表/多级缩进的删除语义重做
- 上游 `@tiptap/markdown` 的隐式空段落规范化策略（只保证本应用行为不退化）
