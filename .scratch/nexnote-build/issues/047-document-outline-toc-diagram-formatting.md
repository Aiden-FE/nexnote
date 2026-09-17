# DEV-047 · 标题目录、正文目录、图表快捷插入与 Markdown 轻量格式化

Type: dev
Module: editor
Status: closed
Blocked by: 无（可立即开始）
Depends: DEV-002（编辑器内核）、DEV-015（Mermaid 示范插件）、DEV-020（源码编辑与原文保真）、DEV-038（快捷插入）
Effort: L
Priority: P1

## Scope

依据 ADR-0012，为 Markdown 页面与块页面建立统一的标题目录派生语义，并提供正文目录块、tab/组件生命周期内的悬浮目录、流程图与甘特图快捷插入，以及显式触发、保守且原文保真的 Markdown 轻量格式化。目录导航不得向标题注入隐式锚点；源码编辑器与块编辑器维持独立 undo/redo 栈。

### 交付内容

1. **标题目录与标题条目**：从当前页面的标题派生有序层级结构；Markdown 标题条目携带源码定位，块标题条目携带块定位。识别 ATX/Setext 标题，排除 frontmatter、代码围栏及其他伪标题；支持标题跳级、重名、空标题与动态增删重排。
2. **正文目录块**：提供正文内目录插入入口；写盘仅保存 `<!-- nexnote:toc -->` 意图标记，显示条目从当前标题目录派生。标题变化后目录自动更新，不持久化条目快照；插入和删除标记进入当前编辑器的 undo/redo 历史。
3. **悬浮目录**：为当前页面提供临时标题导航 UI，复用标题目录派生结果；状态仅在所属 tab 或组件生命周期内有效，不写入正文、frontmatter 或 vault 配置；页面切换与组件销毁不得残留旧页面条目。
4. **无隐式标题锚点与定位导航**：目录派生、展示、点击导航和保存均不得向标题注入 slug、块 ID 或 HTML anchor；Markdown 通过源码范围定位，块页面通过块位置定位。已有用户显式锚点保持原义。
5. **图表快捷插入**：在快捷插入入口提供 Mermaid 流程图与甘特图模板；插入结果为可编辑 Mermaid 源码，并以标准 fenced code block（info string 为 `mermaid`）保存，不引入私有持久化语法。
6. **Markdown 轻量格式化**：仅由用户显式触发，可作用于选区或文档；执行保守、语义不变的局部整理，保护 frontmatter、代码围栏、换行风格及未选范围，不通过全量 Markdown 序列化制造无关 diff。
7. **独立撤销历史**：源码编辑器和块编辑器各自维护 undo/redo 栈；正文目录标记、图表插入与轻量格式化各自在发起编辑器中形成可撤销操作，不承诺跨编辑形态撤销。

## 安全不变量（继承全局约束）

- 无编辑地打开、目录派生/导航、悬浮目录开关及 Markdown 视图往返不得改变文件字节。
- 正文目录只持久化 `<!-- nexnote:toc -->` 意图，不落盘派生条目；标题导航不得产生隐式锚点或内部 ID 泄漏。
- Markdown 轻量格式化不得改写 frontmatter、代码围栏内容、未选范围或换行风格，不得改变正文语义。
- Mermaid 落盘格式必须是标准 `mermaid` fence；模板插入不得触发网络、AI provider 或自动内容生成。
- renderer 不直接访问 Node `fs`；未真实运行的 GUI、三平台或 smoke 验收必须标 `NOT_RUN`。

## 验收标准

功能：

1. Markdown 与块页面对同一标题结构生成顺序、层级和文本一致的标题条目；ATX/Setext、跳级、重名与空标题均有覆盖，frontmatter 与 fenced code 中的伪标题不进入目录。
2. 点击 Markdown 标题条目定位到对应源码标题；点击块标题条目定位到对应 heading 块。标题增删、重命名或重排后导航目标随派生结果更新。
3. 插入正文目录后文件只新增 `<!-- nexnote:toc -->`；重新打开仍显示由当前标题派生的目录。修改标题不会把条目或自动生成链接写回文件；删除/撤销/重做目录标记行为正确。
4. 悬浮目录只展示当前页面标题，tab 内可用；切换页面、关闭 tab 或销毁组件后不保留旧条目，且正文、frontmatter 与 vault 配置均无悬浮 UI 状态写入。
5. 目录插入、展示、导航、保存及重开后，标题行不存在新增 slug、块 ID 或 HTML anchor；用户原有显式锚点不被删除或重写。
6. 流程图与甘特图快捷动作在当前光标处插入可编辑模板；块编辑与 Markdown 源码保存后均为标准 `mermaid` fenced code block，重开可继续编辑和渲染。
7. Markdown 轻量格式化仅在显式命令后产生 diff；选区与全文范围均可用，重复空行、合法列表/标题间距等目标规则有单测，frontmatter、fence 内容、CRLF/LF 及未选范围保持原样。
8. 源码侧的目录标记插入、图表插入和格式化可由一次 undo 撤销并 redo；块侧对应操作进入块编辑器历史；切换编辑形态后不得用另一形态的旧历史覆盖当前内容。
9. 既有 Markdown 原文保真、Mermaid 解析/序列化、快捷插入、页面树与编辑器交互测试不回归。

门禁（候选 SHA 上执行并留证；本票创建时均未声明已完成）：

10. `CI=true pnpm -r typecheck`。
11. `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`。
12. `pnpm lint`。
13. `pnpm build`。
14. `bash scripts/check-changed-format.sh master`。
15. `git diff --check master...HEAD`。
16. Electron smoke 覆盖目录派生/导航、正文目录标记重开、悬浮目录生命周期、两类图表插入、格式化与 undo/redo；未真实运行时记录 `NOT_RUN`，不得以单测或构建替代。

流程：

17. 在 `.wt/DEV-047` / `dev/DEV-047` 隔离实现；固定候选 SHA 上完成 Standards 与 Spec 双轴审查后再合并，合并后复跑门禁并更新 checkpoint。

## 验收记录（2026-09-17，候选 974f7e4 + 双轴修复提交）

- `pnpm typecheck`：通过。
- `pnpm lint`：0 error；4 条仓库既有 `consistent-type-imports` warning。
- `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`：148 files passed / 1 skipped，1204 tests passed / 2 skipped（双轴修复后复跑）。
- `pnpm build`：通过。
- `git diff --check`：通过。
- Electron smoke：**246/246 checks passed**（既有 216 项零回归 + 本票新增 30 项，覆盖验收标准 16 的目录派生/导航、正文目录标记重开、悬浮目录生命周期、流程图/甘特图插入、轻量格式化、多行缩进与 undo/redo、页面树整行折叠）；证据：`.scratch/nexnote-build/smoke/DEV-047/results.json` 与截图。
- checkbox 几何偏差：0.00px（16px）、0.37px（19px）、0.20px（预览），满足 ≤2px。
- 双轴审查：Standards 轴 1×P2 + 5×P3、Spec 轴 1 High + 2 Medium + 2 Low，已全部修复（预览工具栏 ADR-0004 修订、目录引用块 parity 与预览文本匹配、格式化语义安全规则、注释/术语/import 风格、smoke 覆盖）；修复后 SHA 变更已按协议焦点重审。
- 未执行：合并后 post-merge 门禁与发布（v0.0.12）在后续流程完成，见 master 合并提交与 release tag。

## 关联决策

- [ADR-0012](../../../docs/adr/0012-derived-document-outline-and-markdown-editing-boundaries.md)
- [ADR-0004](../../../docs/adr/0004-source-mode-replaces-split-pane.md)（Markdown 原文保真与独立 undo 栈）
- [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)（快捷插入边界）
- 术语：[CONTEXT.md](../../../CONTEXT.md) 标题目录 / 正文目录块 / 悬浮目录 / 标题条目 / 图表快捷插入 / Markdown 轻量格式化
