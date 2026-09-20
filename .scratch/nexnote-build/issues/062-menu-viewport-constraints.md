# DEV-062 · Slash / suggestion 菜单视口约束与内部滚动

Type: dev
Module: editor
Status: implemented, evidence captured locally (六门禁全绿)
Blocked by: 无
Depends: DEV-054（既有 slash 菜单）、DEV-055（源码模式菜单复用）
Effort: M
Priority: P0

## What to build

“/”快捷输入提示和双链/标签补全弹层不再超过可视区，也不再撑长整个编辑滚动容器；内容过多时在弹层内部滚动。光标靠近编辑器底部时菜单优先向上翻转，而不是向下溢出。

用户视角的完成标准：无论候选多少，打开 `/` 菜单都不会让整篇文档突然出现滚动条；菜单始终落在可视区内；键盘上下移动 active 项时，该项始终自动滚入弹层可视区。

## Acceptance criteria

- [x] ProseMirror 块编辑 slash menu 设置视口感知 `max-height` 与内部 `overflow-y:auto`，不扩大祖先滚动容器的 scrollable 区域。
- [x] CodeMirror 源码模式 slash menu 同步获得同样的视口约束。
- [x] 光标靠近底部空间不足时，菜单能向上翻转；空间仍不足时高度收敛到可视区内。
- [x] 键盘上下移动 active item 时，该项自动 `scrollIntoView` 到弹层内部可视区。
- [x] wikilink/hashtag suggestion 菜单补充等价的 `max-height` 防御。
- [x] 菜单命中项选择、点击、ARIA、现有触发语义不回归。
- [x] 六门禁通过；新增单元测试覆盖 max-height/翻转/滚动行为（或在 DOM 测试中断言对应样式与 scrollIntoView 调用）。

## 实现记录

- 新增 kernel 共享纯函数 `packages/kernel/src/extensions/menu-viewport.ts`：导出 `computeMenuViewportPlacement` / `applyMenuViewportPlacement` / `findScrollViewport` / `readMenuViewport` / `readMenuHeight` / `scrollActiveMenuItemIntoView` 以及 `MENU_VIEWPORT_GAP/MARGIN` 常量。helper 在「下方容不下时翻到光标上方」、「上下都有限时高度收敛到可视区」、「保留 viewport margin」三种语义下都做实际像素计算而非固定 60vh，且不依赖具体渲染框架（仅消费 DOM rect / Range），可被 kernel 与 renderer 共同使用。
- `packages/kernel/src/extensions/menu-view.ts`：块菜单渲染增加 `overflow-y:auto` 与默认样式 token；暴露 `positionQuickInsertMenu(view, dom)` 包装 helper；render 末尾调用 `scrollActiveMenuItemIntoView` 让 active 行进入弹层可视区；`quickInsertCaretCoords` 复用 `MENU_VIEWPORT_GAP`。
- `packages/kernel/src/extensions/quick-insert.ts`：在 sync 钩子里把 `positionQuickInsertMenu(view, menu.dom)` 紧跟 `menu.render` 之后执行，确保每次 keyboard/输入/sync 都会按真实视口重定位。
- `packages/kernel/src/extensions/suggestion-menu.ts`：wikilink/hashtag 弹层接入 helper，使用菜单 host 真实 rect 推导 anchor & viewport，并把 active row scrollIntoView 接进 `scrollActiveMenuItemIntoView`。
- `packages/renderer/src/editor/source/source-slash-menu.ts`：CodeMirror 模式菜单改为读取「真实 host + 视口 scroll viewport」调用 `applyMenuViewportPlacement`，并因 CodeMirror 的 `requestMeasure` 在 view.update 内禁止读 layout 而改为完全通过 `view.requestMeasure` 推迟到下一帧（同步路径保留兜底但不在 update 阶段调用 `coordsAtPos`）。
- 新增单测：
  - `packages/kernel/tests/menu-viewport.test.ts` 直接覆盖 `computeMenuViewportPlacement` 翻转、max-height、margin 三个分支。
  - `packages/kernel/tests/slash-menu-dom.test.ts` 增加「菜单按编辑滚动视口翻转并限制高度，键盘 active 项滚入可视区」用例，断言 `dataset.placement==='above'`、`overflow-y:auto`、`max-height` 像素值以及 `ArrowDown` 后 `scrollIntoView({block:'nearest'})` 被调用。
  - `packages/kernel/tests/suggestion-menu.test.ts` 新增「suggestion 菜单按编辑滚动视口翻转并限制高度」用例，覆盖 wikilink/hashtag 复用同一 helper。
  - `packages/renderer/tests/source-slash-menu.test.tsx` 新增「CodeMirror 源菜单按滚动视口翻转并限制高度」用例，断言 placement / overflow / scrollIntoView。
- kernel barrel 通过 `packages/kernel/src/index.ts` 重导出 helper，renderer 端从 `@nexnote/kernel` 引入，保持「kernel 不能依赖 renderer」约束。
- 所有改动文件均通过 `prettier --check`，仓库 `git diff --check` 无空白错误，typecheck / lint / build / 全量 vitest 通过。

## 门禁与证据

- 定向回归：`packages/kernel/tests/menu-viewport.test.ts` 2/2 passed；`packages/kernel/tests/slash-menu-dom.test.ts` 33/33 passed；`packages/kernel/tests/slash-menu.test.ts` 3/3 passed；`packages/kernel/tests/suggestion-menu.test.ts` 9/9 passed；`packages/renderer/tests/source-slash-menu.test.tsx` 39/39 passed。合计 86/86。
- 完整回归：`env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test` 157 files passed / 1 skipped；1468 tests passed / 2 skipped。无回归。
- Typecheck：`CI=true pnpm typecheck` 全绿（root + kernel + renderer + shared + plugin-api + website）。
- Lint：`pnpm lint` 0 errors / 4 个既有 warnings（与本票无关）。
- Changed-format：本票 10 个改动文件 `prettier --check` 全部通过。
- Diff-check：`git diff --check`（工作树）通过。
- Electron smoke：`NOT_RUN`（跨 Chromium 真实渲染验证仍交由 DEV-057/060 链路）。