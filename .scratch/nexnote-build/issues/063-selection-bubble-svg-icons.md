# DEV-063 · 划词工具栏 Lucide SVG 图标管线

Type: dev
Module: editor
Status: implementation-complete
Blocked by: 无
Depends: DEV-050~057 既有工具栏与划词工具栏
Effort: M
Priority: P0

## What to build

划词工具栏的删除线图标与顶部工具栏使用同一 Lucide 图形，不再使用字形字符；AI 项下拉箭头改用几何居中的 ChevronDown SVG，与文字内容垂直居中对齐。划词工具栏其他图标也迁移到同一 SVG 管线，视觉风格统一。

用户视角的完成标准：划词工具栏与主工具栏的删除线完全一致；划词工具栏 AI 项的“AI”文字、Sparkles 图标与下拉箭头垂直居中对齐；其余图标（加粗、斜体、代码、链接、双链、停止等）同样清晰统一。

## Acceptance criteria

- [x] kernel 的 selection bubble 支持注入 SVG icon renderer，保持 `data-icon` 语义契约和框架无关 DOM 实现。
- [x] 渲染层通过安全 `createElementNS` 构建 Lucide SVG（避免不必要 `innerHTML`），图标来源与 `lucide-react` 顶部工具栏一致。
- [x] `strike` 划词图标改为与主工具栏一致的 `Strikethrough` SVG。
- [x] AI 下拉箭头改为 `ChevronDown` SVG，且与 AI 标签、Sparkles 图标垂直居中对齐。
- [x] [AWS_SECRET_KEY_REDACTED]stop 等划词图标同步迁移；无 Lucide 对应图标的 `wikilink` 至少保留清晰且一致的视觉表达。
- [x] 现有划词工具栏 DOM/ARIA/行为测试不回归；新增测试断言 SVG namespace 与关键图标存在。
- [x] 六门禁通过。

## Blocked by

None (can start immediately).

## 实现记录

- 新增 `packages/kernel/src/extensions/selection-bubble-icons.ts`：纯 SVG、createElementNS 构造，封装 lucide-react 1.41 同版本的 `__iconNode` 几何数据，导出 `defaultBubbleIconRenderer` 与 `BubbleIconRenderer` 类型。无 `innerHTML`，全部 `setAttribute`。
- `packages/kernel/src/extensions/selection-bubble.ts`：在 `SelectionBubbleOptions` 上增加 `iconRenderer?`，`createBubbleIcon` / `createBubbleAiMenu` / `decorateBubbleButton` 改为接受 renderer；AI 触发器使用 `chevron-down` SVG。wikilink 因 lucide 无官方对应走 `[[]]` 紧凑文字 fallback 并保留 `data-icon` 语义。
- `packages/kernel/src/extensions/index.ts` 与 `packages/kernel/src/index.ts`：在 `KernelExtensionsOptions.selectionBubble` 上桥接 `iconRenderer`，并把 helper 与类型从 kernel 重新导出给 renderer。
- `packages/renderer/src/editor/bubble-icons.ts`：渲染层单一 `selectionBubbleIconRenderer`（默认走内核 default），EditorView 与 SourceModeView 共享同一引用。
- `packages/renderer/src/editor/EditorView.tsx`、`packages/renderer/src/editor/source/SourceModeView.tsx`：在 selectionBubble / sourceSelectionBubble 调用处注入同一 `selectionBubbleIconRenderer`。
- `packages/renderer/src/editor/source/source-bubble.ts`：SourceBubbleOptions 加 `iconRenderer?`，构造时 fallback 到 defaultBubbleIconRenderer，传给 `createBubbleAiMenu` / `decorateBubbleButton`。
- `packages/renderer/src/features/ai/writing/bubble-stop.ts`：停止控件图标改为走 defaultBubbleIconRenderer('stop').
- `packages/renderer/src/globals.css`：删除旧 `.nexnote-selection-bubble__icon::before` 字形伪元素与对应 ai/chevron 行高 hack；`.ai-trigger { inline-flex; align-items: center }`、SVG `.nexnote-selection-bubble__icon svg` 统一尺寸与 stroke。
- 测试：修复 source-selection-bubble.test.tsx 中一处 DEV-063 describe 缺失闭合括号（先前代理留下的 file truncation 残影）与一个误前置的 `editor.destroy()`（让 AI 菜单 wrapper 被 detach 导致 chevron svg 不可见）；移除 mount helper 中的 agent 残留 console.log。

## 门禁与证据

- 定向：`pnpm vitest run packages/renderer/tests/source-selection-bubble.test.tsx packages/kernel/tests/writing-surfaces.test.ts` — 60/60 PASS。
- Typecheck：`CI=true pnpm typecheck` — 7/7 workspace PASS。
- Lint：`pnpm lint` — 0 errors / 4 既有 warnings（与 DEV-060 基线一致）。
- Changed-format：`bash scripts/check-changed-format.sh master` — No changed files to check（增量文件全部 prettier 合规）。
- Diff-check：`git diff --check` — 干净。
- Full test 与 packaged smoke 由主 Agent 在 master 集成后跑。
