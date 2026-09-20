# DEV-067 · 编辑器工具栏按钮 hover tooltip 可见性修复

Type: dev
Module: editor
Status: ready-for-agent
Blocked by: 无
Depends: DEV-035（既有工具栏 Tooltip 实现）、DEV-050（icon-first 工具栏）
Effort: S
Priority: P1

## What to build

编辑器工具栏按钮 hover 时看不到功能提示 tooltip，而划词工具栏按钮 hover 有 tooltip，行为不一致。用户视角的完成标准是：块编辑器工具栏与源码/分栏视图工具栏的所有按钮（含「更多」溢出按钮）hover 时都能看到与划词工具栏同等观感的 tooltip。

triage 定位到的根因：tooltip 实际已渲染（`ToolbarTooltip` 组件存在于 `packages/renderer/src/editor/toolbar/Tooltip.tsx`，且 `EditorToolbar.tsx:253/342` 已包裹每个按钮），但 `EditorToolbar.tsx:338` 的 actions 行容器带 `overflow-hidden`：

```
className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
```

tooltip 为 `position: absolute; top: 100%; mt-1`，伸出 32px 高工具栏行下缘 → 被该 `overflow-hidden` 祖先裁剪，视觉上"没有 tooltip"。

修复方向（agent 依据实现约束选择其一，优先级从高到低）：

1. tooltip 改为 `position: fixed`（或 Floating UI），脱离 overflow 裁剪上下文，同时保持现有 hover/focus/Esc 语义。
2. actions 行的 `overflow-hidden` 改为可替代的单行裁剪方案（如对按钮本身 `min-w-0` + 溢出集合逻辑不变），tooltip 不再被裁。
3. tooltip 用 `createPortal` 提升到 body 层。

不得回归的约束：溢出集合计算（`resolveToolbarLayout`）依赖实测按钮宽度，改动不得破坏宽度测量与「更多」折叠逻辑；键盘 focus 也要能弹出 tooltip；Esc 关闭行为保留。

## Acceptance criteria

- [ ] 块编辑器工具栏与源码/分栏视图工具栏的所有按钮（含「更多」）hover 时 tooltip 可见，观感与划词工具栏 tooltip 一致（popover 底色、圆角、字号）。
- [ ] tooltip 不再被工具栏 actions 行或任何祖先 `overflow-*` 裁剪；在窗口边缘（最右按钮）时不得溢出视口（自动左右翻转或夹紧）。
- [ ] 键盘 Tab 聚焦按钮时 tooltip 同样弹出，Esc 关闭，`aria-describedby` 关联保留。
- [ ] 工具栏溢出折叠（`resolveToolbarLayout`）与「更多」菜单行为不回归；现有 `toolbar-tooltip` 相关测试全绿。
- [ ] 补充回归测试：断言 tooltip 在 actions 行 `overflow-hidden` 环境下仍然可见（如 portal 到 body 或 fixed 定位断言）。
- [ ] 六门禁通过。

## Blocked by

None (can start immediately).

## 实现记录

待实现后填写。

## 门禁与证据

待实现后填写。
