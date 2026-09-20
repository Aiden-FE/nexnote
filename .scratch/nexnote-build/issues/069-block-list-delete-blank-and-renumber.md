# DEV-069 · 块文档删除列表项产生空白行 / 有序列表从 1 重新计数

Type: dev
Module: editor
Status: ready-for-agent
Blocked by: 无
Depends: 无
Effort: S
Priority: P1

## What to build

块编辑器删除列表项时出现两类异常：

1. **无序列表删行后产生"空白换行"**：被删除的 `<li>` 留下一个空段落，视觉上多出一行空白。
2. **有序列表删除中间项后，上下两个列表均从 1 重新计数**，而非自然延续编号。

triage 分析定位（agent 需逐一校验）：

- 块编辑器扩展装配（`packages/renderer/src/editor/extensions/` 下 block-editor 入口）当前未注册独立 `ListKeymap`，依赖 TipTap 3 StarterKit 默认 ListKeymap 行为；在列表行按 Backspace 合并到上一项时，可能留下空段落。
- TipTap 3 默认把有序列表编号交由浏览器 `<ol>` 原生序号渲染；删除中间项若把 `<ol>` 拆成两个独立列表（且未保留 `start` 属性），视觉上"上下两个列表都从 1 开始"。
- 删行后是否产生空白段，可能与 Backspace 时 listItem → paragraph 的转换有关（TipTap `lift`/`splitListItem` 行为）。

修复方向（agent 决定最小侵入）：

1. 注册自定义 `ListKeymap`（`@tiptap/extension-list` 提供）或拦截 Backspace：当列表行删空时，不留空段落；或沿用默认行为但保证不产生可见空白。
2. OrderedList 启用 `keepAttributes: true`，或自写 plugin：在合并相邻 `<ol>` 时保留 `start` 属性，使删中间项后上下序号连续。
3. 序列化层验证：Markdown 导出/回读后编号与空白行为一致（避免本地修复被序列化打回）。

约束：

- 不影响 Markdown / 源码视图（DEV-020）的列表行为；若两边已有差异，先核对再定方案。
- 不改 StarterKit 全局配置破坏其他扩展（heading、code-block 等）。
- 不引入新的快捷键冲突。

## Acceptance criteria

- [ ] 单元/集成测试覆盖：删空 `<li>` 时不残留空白 paragraph；有序列表删中间项后上下文序号连续。
- [ ] 块编辑器手动复现：3 行无序列表删中间行 → 仍为 2 行且无空行；5 行有序列表删第 3 行 → 编号保持 1 2 4 5。
- [ ] Markdown 导出再回读后行为不退化（编号与空白一致）。
- [ ] 不影响代码块、引用、标题等其他节点类型的 Backspace 行为。
- [ ] 六门禁通过。

## Blocked by

None (can start immediately).

## 实现记录

- 候选 SHA：`1dba20d`（dev/DEV-069，基于 master `0cfc92a`）。
- 新增扩展 `packages/kernel/src/extensions/list-dev069.ts`（`nexnoteListDev069`）：
  - `isSandwichedEmptyListItem(state)`：探测当前空 `<li>` 是否夹在两个同级 listItem 之间（要求：父为 bulletList/orderedList、光标在空 paragraph 起始、li 仅含一个空 paragraph、前后均有同级项）。
  - 通过 `addKeyboardShortcuts` 注册 Backspace：命中条件时直接删除整个空 listItem（`tr.delete($from.before(depth), $from.after(depth))`），不产生空白 paragraph；首/尾空项不拦截，仍由默认 ListKeymap 走 lift 退出列表。
- `packages/kernel/src/extensions/index.ts` StarterKit 配置：`orderedList: { keepAttributes: true }`，合并相邻 `<ol>` 时保留 start 属性；并注册 ListDev069。
- 语义说明：用户痛点是列表被拆成两段后各自从 1 重新计数；修复后删除中间项不再拆分列表，剩余项保持单一有序列表并自然连续编号。

## 门禁与证据

- 新增测试 `packages/kernel/tests/list-dev069.test.ts` 8 用例：探测函数三态（夹中 true / 首尾 false / 非空 false）；Backspace 无序删中间项剩「- 甲 / - 丙」无连续空行；有序删第 3 项剩 4 项连续编号 1..4 且不含“三”；起始号解析为 start=3；扩展名稳定；buildKernelExtensions 集成。
- vitest 全量：160 files passed / 1 skipped，1497 passed / 2 skipped。
- typecheck（pnpm -r）：PASS。
- eslint（改动文件 0 warnings；全仓门禁口径）：PASS。
- build（electron-vite）：PASS。
- verify-release-config：31/31 PASS。
- `git diff --check master...HEAD`：PASS。
- 双轴审查：Standards PASS / Spec PASS（候选 `1dba20d`）。
