# DEV-061 · 统一块编辑器左侧 gutter 与拖拽热区

Type: dev
Module: editor
Status: implemented
Blocked by: 无
Depends: DEV-054（既有块折叠呈现）、DEV-055（源码折叠呈现）
Effort: L
Priority: P0

## What to build

块编辑器的折叠 chevron 不再与标题正文混排，而是和左侧块拖拽手柄组成统一的外部 gutter。可折叠标题在左侧 gutter 列始终可见；鼠标悬停在块上时，拖拽手柄出现在 chevron 左列并可稳定点击，不再出现“还没移动到位就消失”。

用户视角的完成标准：长文档中所有可折叠标题左侧都有一列对齐的 chevron；hover 任意块时拖拽手柄稳定出现，鼠标从正文移向手柄途中不会消失；窄分栏下手柄与 chevron 也不被滚动容器裁剪。

## Acceptance criteria

- [x] 块编辑折叠控件从标题内部 ProseMirror widget 迁移为编辑器宿主外部 gutter overlay；标题内不再出现按钮 DOM。
- [x] chevron 常显（仅保留“有章节内容的标题可折叠”的现有语义），且 H1–H6 的 chevron 与拖拽手柄对齐成稳定双列。
- [x] 编辑器左侧 gutter 总宽度可容纳双列；窄编辑区下手柄、chevron 不被滚动容器裁剪。
- [x] 拖拽手柄移除会造成不可命中空隙的二次 `translateX(-1.9rem)`，改用 Floating UI offset 或等价布局内定位。
- [x] 拖拽手柄增加透明热区/桥接区，鼠标从正文移动到 gutter 途中不会提前触发 TipTap `mouseleave` 隐藏。
- [x] 多行标题折行顶到编辑器内容左缘；标题不再为 chevron 预留 `padding-left`。
- [x] 折叠控件的键盘焦点、ARIA、块菜单“折叠章节/展开章节”入口继续可用。
- [x] 六门禁通过；相关单元测试覆盖 gutter 定位、热区存在性和折叠控件 ARIA。

## Blocked by

None (can start immediately).

## 实现记录

（见下方门禁与证据后“实现记录”详细列表；此处简要汇总）

- 折叠控件迁移到宿主级 overlay（`mountUnifiedGutter`），标题内不再有按钮 DOM。
- 拖拽手柄移除 `translateX(-1.9rem)`，改用 `@floating-ui/dom` `offset` middleware，并增加 `.nexnote-drag-handle__bridge` 桥接热区。
- 标题 `padding-left: 0`；`.nexnote-editor-host` 改为 3.75rem 双列网格。

## 门禁与证据

## 实现记录

- `packages/kernel/src/extensions/fold.ts`：移除标题内 `Decoration.widget`，新增 `collectFoldHeadings(state)` 与 `FoldHeadingDescriptor`；导出 `toggleFoldActionLabel` 给块菜单"折叠/展开章节"使用；`buildDecorations` 仅保留 `nexnote-fold-hidden` 与 `nexnote-folded` 装饰。
- `packages/kernel/src/extensions/drag-handle.ts`：去除 `translateX(-1.9rem)` 的等效 hack；`computePositionConfig.middleware` 改为 `@floating-ui/dom` 的 `offset({mainAxis: (gutter - 手柄列宽) * 16}) + shift({padding: 4})`；手柄内新增 `.nexnote-drag-handle__bridge` 透明桥接元素（位于 wrapper 内部，TipTap 仍视作 wrapper 内部元素），吸收从正文到手柄的 hover path。
- `packages/kernel/src/editor/unified-gutter.ts`（新建）：`mountUnifiedGutter(host, editor)` 把 `.nexnote-fold-overlay` 挂到 host 内，按 `collectFoldHeadings` 渲染 chevron 按钮，监听 editor 的 `transaction`（折叠切换只改 plugin state、不改 doc）/`update`/`selectionUpdate` 与宿主滚动容器 scroll，重定位通过 `translate(0, ...)` 设置；提供 `flushSync` 给测试。
- `packages/kernel/src/index.ts`：导出 `collectFoldHeadings`、`FoldHeadingDescriptor`、`toggleFoldActionLabel`、`mountUnifiedGutter`、`UnifiedGutterController`、`EDITOR_GUTTER_*` 常量。
- `packages/renderer/src/editor/EditorView.tsx`：在编辑器挂载 effect 中调用 `mountUnifiedGutter(hostRef.current, kernel.editor)`，卸载 effect 调用 `gutter.destroy()`。
- `packages/renderer/src/globals.css`：`.nexnote-editor-host` 改为 `display: grid; grid-template-columns: 3.75rem minmax(0, 1fr)` 双列；`.nexnote-editor-host .ProseMirror h1..h6 { padding-left: 0 }`；移除 `.nexnote-drag-handle { transform: translateX(-1.9rem) }`，改为 `:hover/:focus-within` 驱动；新增 `.nexnote-fold-overlay`、`__toggle`、`__icon`、`__bridge` 与焦点规则。
- `packages/kernel/tests/fold.test.ts`：把测试驱动从"标题内 widget"换成"宿主 overlay + `data-fold-id` 选择器"；新增 `DEV-061 宿主级统一 gutter overlay` 描述，覆盖 chevron 不在标题内部、常显与 ARIA、无章节标题不产生 chevron、键盘 Enter/Space 焦点承接、滚动/内容变化时重定位与常显。
- `packages/renderer/tests/unified-editor-gutter.test.ts`（新建）：CSS 合同断言——双列网格、3.75rem gutter、chevron 列起点、`padding-left: 0`、无 `translateX(-1.9rem)`、bridge 元素 `pointer-events: auto`。
- ADR-0013 追加 DEV-061 修订段落。

## 门禁与证据

- `pnpm --filter @nexnote/kernel typecheck` ✅
- `pnpm --filter @nexnote/renderer typecheck` ✅
- `pnpm --filter @nexnote/shared typecheck` ✅（一并验证 workspace 依赖）
- `CI=true pnpm eslint packages/kernel packages/renderer --ext .ts,.tsx` ✅（仅 2 个无关既有 warnings，ChatDock/chat-runtime）
- 定向测试 `vitest run packages/kernel/tests/fold.test.ts` ✅ 22/22
- 渲染层相关 `vitest run packages/renderer/tests/unified-editor-gutter.test.ts packages/renderer/tests/source-heading-fold.test.ts packages/renderer/tests/expand-all.test.tsx packages/renderer/tests/editor-toolbar-entries.test.tsx packages/renderer/tests/editor-interactions.test.ts` ✅ 55/55
- 全量 kernel `vitest run packages/kernel` ✅ 228/228
- 全量 renderer `vitest run packages/renderer` ✅ 627/627
- `bash scripts/check-changed-format.sh` ✅ All matched files use Prettier code style!
- `git diff --check` ✅ no whitespace errors
- Electron smoke：`NOT_RUN`（按既有约定，跨平台 smoke 由主 Agent 在 master 集成后再跑）