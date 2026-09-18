# DEV-053 · Markdown 编辑器实现 `/` 快捷输入菜单

Type: dev
Module: editor
Status: implementation-complete
Blocked by: DEV-052（共享 `/` 菜单语义完成块编辑落地）
Depends: DEV-020（CodeMirror 原文编辑）、DEV-038（快捷插入）
Effort: L
Priority: P1

## Scope

依据 ADR-0006 与 ADR-0004 的 2026-09-17 修订，在 Markdown 源码视图和分栏视图编辑侧实现完整 `/` 快捷输入菜单，补齐当前 CodeMirror 完全没有此入口的产品缺口，同时维持 Markdown 原文字节保真。

### 交付内容

1. CodeMirror 在安全触发上下文中打开与块编辑一致的文字化命令菜单；预览视图不提供快捷输入。
2. 复用共享动作名称、图标、分组、别名、过滤、键盘语义与能力判断；无法可靠表示为 Markdown 的动作不展示。
3. 支持正文、H1–H6、列表、任务列表、引用和代码块的当前空行转换，并支持适用的结构、媒体、双链、AI 与插件动作。
4. 结构动作在已有正文时只落到安全块边界，不从光标处截断文本；行内动作写入当前 CodeMirror 光标。
5. 动作确认、Escape、Backspace、无匹配空态及输入法提交后均保持明确、可预测的源码结果。
6. 所有编辑以 CodeMirror 事务进入当前 undo/redo 栈，不经过 TipTap 序列化。

## 安全不变量

- 未执行动作时不得改写 Markdown、frontmatter、换行风格、尾随空行或未触及范围。
- 预览视图保持只读；菜单不得写入非活动 tab 或其他页面。
- 普通 `/`、菜单浏览和取消零 AI 请求；只有显式确认 AI 动作才请求 provider。
- 解析或菜单错误不得阻断源码编辑与保存。

## 验收标准

- [ ] 源码视图与分栏编辑侧可通过真实键盘输入打开、过滤并执行 `/` 菜单；预览视图无入口。
- [ ] 与块编辑保持动作语义、名称、分组及键盘行为一致，Markdown 不适用动作被能力过滤。
- [ ] 基础块转换、结构插入、双链和 AI 插入分别落到正确位置且可单次 undo/redo。
- [ ] Escape 保留触发文本，确认精确消费触发串，无匹配不执行动作；非触发 `/` 保持原文。
- [ ] Renderer 测试挂载真实 CodeMirror 并走真实输入链路，覆盖源码/分栏/预览和原文保真。
- [ ] 既有 Markdown 三视图、标题文件名同步、frontmatter、冲突防护及选区工具栏测试不回归。
- [ ] 候选 SHA 上通过标准门禁；Electron smoke 未执行时记录 `NOT_RUN`。
- [ ] 在 `.wt/DEV-053` / `dev/DEV-053` 隔离实现，完成 Standards + Spec 双轴审查后方可合并。

## 关联决策

- [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)
- [ADR-0004](../../../docs/adr/0004-source-mode-replaces-split-pane.md)（2026-09-17 修订）
- 术语：[CONTEXT.md](../../../CONTEXT.md) 快捷插入 / Markdown 视图 / 源码视图 / 分栏视图

## Implementation evidence

- 2026-09-18: Markdown 源码视图和分栏编辑侧接入真实 CodeMirror `/` 快捷输入；预览与 native-block 临时源码模式不装配入口。共享 `EDITOR_ACTION_CATALOG` 提供名称、图标语义键、分组、别名、模式与执行契约，插件动作沿用 host capability 过滤。
- 定向验证：`pnpm exec vitest run packages/renderer/tests/source-slash-menu.test.tsx packages/renderer/tests/editor-toolbar-entries.test.tsx --maxWorkers=1 --testTimeout=60000`，2 个文件、47 个测试通过。真实 DOM keyboard/beforeinput/input 覆盖源码、分栏、预览、native-block 隔离；覆盖段落/H1–H6/列表/任务/引用/code 转换、代码/URL/路径/数学/词中/IME 排除、中文/英文/记号过滤、结构安全边界、媒体/插件 fail-open、双链、AI、取消、Backspace、空态、CRLF/frontmatter/尾随空行保真及 CodeMirror 单步 undo/redo。
- 候选 SHA 门禁（提交前）：`CI=true pnpm typecheck` 通过；`env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR pnpm test -- --maxWorkers=1 --testTimeout=60000` 通过（156 文件、1,395 测试；1/2 skipped）；`pnpm lint` 通过（仅既有 4 warnings）；`pnpm build`、`bash scripts/check-changed-format.sh`、`git diff --check` 均通过。
- Electron 真实 Chromium smoke：NOT_RUN（归 DEV-057）。
