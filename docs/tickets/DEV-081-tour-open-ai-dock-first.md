# DEV-081 引导「AI 对话与写作」步骤先展开右栏再定位

- 状态：ready-for-agent
- 分类：bug
- 优先级：P2
- 工作量：S
- 范围：packages/renderer
- Depends: 无
- 来源：用户反馈 2026-09-22
- 重审：triage 2026-09-22 —— 全部现状已核实，行号对齐；面板 id 钉死为 `'ai-chat'`；方案改为声明式 prepare/cleanup 是对的，但快照恢复语义有微妙边界须明示（见 §6）

## 当前行为

新手引导第 3 步「AI 对话与写作」的 spotlight 目标是右侧 Dock（`[data-tour="ai-dock"]`，挂在 `DockHost` 的 `<aside>` 上，`packages/renderer/src/shell/DockHost.tsx:35-38`）。但 Dock 默认收起（ui-store `dockVisible: false`，`packages/renderer/src/stores/ui-store.ts:63`），`DockHost` 收起时 `if (!dockVisible) return null;`（`DockHost.tsx:22`）——目标元素不存在，`readRect` 返回 null，引导卡片走「目标缺失优雅降级」直接居中弹出（`GuidedTour.tsx:128-129` 的 `top: '50%', left: '50%'`）。

用户视角：一个不知道是什么东西的引导框居中弹出来讲「右侧 Dock」，但屏幕上根本没有右栏；文案还提到「随时展开与收起 Dock」，完全无法对应到界面。只有点完或跳过后才可能发现右栏。

现状细节（核实）：
- `TOUR_STEPS` 中 step id `ai-dock` 在 `packages/renderer/src/tour/tour-steps.ts:31-36`，标题「AI 对话与写作」。
- dockPanel 注册：`dockPanelRegistry.register({ id: 'ai-chat', ... })` 在 `packages/renderer/src/features/dock/index.tsx:9-10`。
- `useUiStore.setActiveDockPanel(id)` 已包含 `setDockVisible: true` 副作用（ui-store.ts:97），所以"展开 Dock + 激活面板" 一句话搞定。
- 500ms 轮询测量在 `GuidedTour.tsx:69`，首帧 rAF 在 line 68。
- `TourStep` interface 当前只有 `id/targetSelector/title/description`（`tour-steps.ts:6-13`）。

## 期望行为

1. **进入该步前先打开 Dock**：当引导走到 `ai-dock` 步（或任意目标依赖 Dock 可见的步）时，调用 `useUiStore.getState().setActiveDockPanel('ai-chat')`（等价于 setDockVisible(true) + 激活面板）确保右栏已展开，再让 spotlight 测量定位；现有 500ms 轮询测量可自然拾取展开后的元素。
2. **离开该步时恢复原状**：用户从该步进入下一步（settings 步）或跳过/完成引导时，若 Dock 是因引导而展开的，恢复为引导前的状态（收起）；若用户本来就已展开 Dock，保持展开。记录「进入步之前的 `dockVisible`（以及 `activeDockPanel`）快照」实现恢复。
3. **上下步关系不变**：page-tree/editor 步不触碰 Dock；settings 步目标仍在左侧/设置入口，不受 Dock 展开影响。
4. **声明式 + 可扩展**：写成 step 的可选 `prepare?: () => void` / `cleanup?: (snapshot: unknown) => void`（或等价），把「展开 Dock」声明在 ai-dock 步上，**而非** 在 GuidedTour 里 if 单步硬编码——后续若有其他步需要先展开某个区域可复用同一机制。
5. 步骤文案微调可选：若展开后 spotlight 已能贴住右栏，现有文案即可用，不强制改文案。
6. **快照恢复的精确语义**（grill 强化）：
   - 快照在 `prepare` 调用**之前**抓取，记录 `dockVisible` 与 `activeDockPanel`。
   - `cleanup` 比较"当前是否还等于 prepare 时的状态"——若已被用户手动改动（用户点了 Dock 标题或设置里改了 dockVisible），则不动；否则恢复。
   - "step 切换"与"引导结束（skip/complete）"两种离开路径都要 cleanup；skip/complete 时还需要把引导前所有曾经被 prepare 改动的状态一并恢复（可保留 last-prepare-snapshot 队列）。
   - 若引导被打断（页面崩溃、组件卸载），快照恢复不一定需要保证——优先保证主路径正确。

## 关键接口

- `useUiStore`：已有 `setActiveDockPanel(id)` / `setDockVisible(visible)`，无需新增状态；快照放组件内 ref 或局部 state。
- `GuidedTour`：step 切换 effect 中按步声明前置动作与清理动作；保持 500ms 轮询（prepare 触发后 + rAF 即可拾取）。
- `TourStep`（`packages/renderer/src/tour/tour-steps.ts:6-13`）增加可选 `prepare?: () => unknown` 与 `cleanup?: (snapshot: unknown) => void`，类型宽松（snapshot 类型为 `unknown`）。
- `TOUR_STEPS`：在 `ai-dock` 步上加 `prepare`/`cleanup` 实现。

## 验收标准

- [ ] Dock 收起状态下开始引导，走到「AI 对话与写作」步时右栏自动展开，spotlight 正确框住右栏而不是卡片居中
- [ ] 从该步进入下一步或跳过/完成后，Dock 恢复引导前的状态（dockVisible=false、activeDockPanel 不变）
- [ ] 引导前 Dock 已展开时，离开引导后仍保持展开（不重复修改）
- [ ] 在该步期间用户手动改了 Dock 状态（点收起），引导离开后不强行复原
- [ ] 其他步骤（页面树/编辑器/版本时间线/设置）定位行为不回归
- [ ] 组件测试覆盖：prepare/cleanup 时机、已展开不重复动作、用户中途改动不被覆盖、跳过路径；`pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿

## Out of scope

- 引导步骤文案整体重写
- 首启动 AI 配置向导（OnboardingWizard）的弹出时机
- Dock 宽度调整或默认展开策略变更