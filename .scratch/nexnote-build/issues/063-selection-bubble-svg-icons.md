# DEV-063 · 划词工具栏 Lucide SVG 图标管线

Type: dev
Module: editor
Status: ready-for-agent
Blocked by: 无
Depends: DEV-050~057 既有工具栏与划词工具栏
Effort: M
Priority: P0

## What to build

划词工具栏的删除线图标与顶部工具栏使用同一 Lucide 图形，不再使用字形字符；AI 项下拉箭头改用几何居中的 ChevronDown SVG，与文字内容垂直居中对齐。划词工具栏其他图标也迁移到同一 SVG 管线，视觉风格统一。

用户视角的完成标准：划词工具栏与主工具栏的删除线完全一致；划词工具栏 AI 项的“AI”文字、Sparkles 图标与下拉箭头垂直居中对齐；其余图标（加粗、斜体、代码、链接、双链、停止等）同样清晰统一。

## Acceptance criteria

- [ ] kernel 的 selection bubble 支持注入 SVG icon renderer，保持 `data-icon` 语义契约和框架无关 DOM 实现。
- [ ] 渲染层通过安全 `createElementNS` 构建 Lucide SVG（避免不必要 `innerHTML`），图标来源与 `lucide-react` 顶部工具栏一致。
- [ ] `strike` 划词图标改为与主工具栏一致的 `Strikethrough` SVG。
- [ ] AI 下拉箭头改为 `ChevronDown` SVG，且与 AI 标签、Sparkles 图标垂直居中对齐。
- [ ] bold/italic/code/link/wikilink/sparkles/stop 等划词图标同步迁移；无 Lucide 对应图标的 `wikilink` 至少保留清晰且一致的视觉表达。
- [ ] 现有划词工具栏 DOM/ARIA/行为测试不回归；新增测试断言 SVG namespace 与关键图标存在。
- [ ] 六门禁通过。

## Blocked by

None (can start immediately).

## 实现记录

待实现后填写。

## 门禁与证据

待实现后填写。
