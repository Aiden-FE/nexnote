# DEV-062 · Slash / suggestion 菜单视口约束与内部滚动

Type: dev
Module: editor
Status: ready-for-agent
Blocked by: 无
Depends: DEV-054（既有 slash 菜单）、DEV-055（源码模式菜单复用）
Effort: M
Priority: P0

## What to build

“/”快捷输入提示和双链/标签补全弹层不再超过可视区，也不再撑长整个编辑滚动容器；内容过多时在弹层内部滚动。光标靠近编辑器底部时菜单优先向上翻转，而不是向下溢出。

用户视角的完成标准：无论候选多少，打开 `/` 菜单都不会让整篇文档突然出现滚动条；菜单始终落在可视区内；键盘上下移动 active 项时，该项始终自动滚入弹层可视区。

## Acceptance criteria

- [ ] ProseMirror 块编辑 slash menu 设置视口感知 `max-height` 与内部 `overflow-y:auto`，不扩大祖先滚动容器的 scrollable 区域。
- [ ] CodeMirror 源码模式 slash menu 同步获得同样的视口约束。
- [ ] 光标靠近底部空间不足时，菜单能向上翻转；空间仍不足时高度收敛到可视区内。
- [ ] 键盘上下移动 active item 时，该项自动 `scrollIntoView` 到弹层内部可视区。
- [ ] wikilink/hashtag suggestion 菜单补充等价的 `max-height` 防御。
- [ ] 菜单命中项选择、点击、ARIA、现有触发语义不回归。
- [ ] 六门禁通过；新增单元测试覆盖 max-height/翻转/滚动行为（或在 DOM 测试中断言对应样式与 scrollIntoView 调用）。

## Blocked by

None (can start immediately).

## 实现记录

待实现后填写。

## 门禁与证据

待实现后填写。
