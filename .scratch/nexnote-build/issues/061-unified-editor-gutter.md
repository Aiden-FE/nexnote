# DEV-061 · 统一块编辑器左侧 gutter 与拖拽热区

Type: dev
Module: editor
Status: ready-for-agent
Blocked by: 无
Depends: DEV-054（既有块折叠呈现）、DEV-055（源码折叠呈现）
Effort: L
Priority: P0

## What to build

块编辑器的折叠 chevron 不再与标题正文混排，而是和左侧块拖拽手柄组成统一的外部 gutter。可折叠标题在左侧 gutter 列始终可见；鼠标悬停在块上时，拖拽手柄出现在 chevron 左列并可稳定点击，不再出现“还没移动到位就消失”。

用户视角的完成标准：长文档中所有可折叠标题左侧都有一列对齐的 chevron；hover 任意块时拖拽手柄稳定出现，鼠标从正文移向手柄途中不会消失；窄分栏下手柄与 chevron 也不被滚动容器裁剪。

## Acceptance criteria

- [ ] 块编辑折叠控件从标题内部 ProseMirror widget 迁移为编辑器宿主外部 gutter overlay；标题内不再出现按钮 DOM。
- [ ] chevron 常显（仅保留“有章节内容的标题可折叠”的现有语义），且 H1–H6 的 chevron 与拖拽手柄对齐成稳定双列。
- [ ] 编辑器左侧 gutter 总宽度可容纳双列；窄编辑区下手柄、chevron 不被滚动容器裁剪。
- [ ] 拖拽手柄移除会造成不可命中空隙的二次 `translateX(-1.9rem)`，改用 Floating UI offset 或等价布局内定位。
- [ ] 拖拽手柄增加透明热区/桥接区，鼠标从正文移动到 gutter 途中不会提前触发 TipTap `mouseleave` 隐藏。
- [ ] 多行标题折行顶到编辑器内容左缘；标题不再为 chevron 预留 `padding-left`。
- [ ] 折叠控件的键盘焦点、ARIA、块菜单“折叠章节/展开章节”入口继续可用。
- [ ] 六门禁通过；相关单元测试覆盖 gutter 定位、热区存在性和折叠控件 ARIA。

## Blocked by

None (can start immediately).

## 实现记录

待实现后填写。

## 门禁与证据

待实现后填写。
