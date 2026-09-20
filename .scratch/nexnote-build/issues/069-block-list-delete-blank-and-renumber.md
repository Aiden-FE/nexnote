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

待实现后填写。

## 门禁与证据

待实现后填写。
