# DEV-035 · 编辑器工具栏统一与单行溢出折叠

Type: dev
Module: shell
Status: closed
Blocked by: 无（可立即开始）
Depends: DEV-022（Tab 顺序与快捷键）
Effort: M
Priority: P1

## Scope

文件名只在 Tab 显示，左上角独立文件名移除；原区域改为单行编辑器工具栏，常用编辑、AI 与插入动作统一收口。宽度不足时默认进入「更多」溢出菜单，Tab 只承担页面识别与切换。

## 验收标准

1. 块/源码模式均无独立左上角文件名，工具栏保持单行。
2. Tab 文件名过长截断并以 tooltip 展示完整名称。
3. 窄窗口下溢出动作可从「更多」执行，AI 入口整体折叠。
4. 工具栏和溢出菜单全部键盘可达；H1 改名后的 Tab 同步不回归。
5. 通过 typecheck、测试、lint、build、diff-check；Electron smoke 覆盖窄窗口。

## 流程与决策

在 `.wt/DEV-035` / `dev/DEV-035` 隔离实现，双轴审查通过后合并。详见 [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)。
