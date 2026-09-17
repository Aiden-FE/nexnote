# DEV-054 · 完成块文档标题章节折叠交互

Type: dev
Module: editor
Status: in_review
Blocked by: 无（可立即开始）
Depends: DEV-017（块编辑交互）、DEV-047（标题目录）
Effort: M
Priority: P1

## Scope

依据 ADR-0013，在现有块标题折叠内核之上补齐可发现、可键盘操作且边界稳定的标题章节折叠。用户无需先打开块菜单即可在 H1–H6 左侧折叠章节，同时保留既有文字入口。

### 交付内容

1. 有章节内容的 H1–H6 左侧显示低视觉权重 disclosure chevron；展开与折叠状态可辨，hover/focus 时增强，无章节内容时不提供可操作控件。
2. 折叠隐藏标题之后至下一个同级或更高级标题之前的全部标题章节，标题自身保持可见。
3. 保留块菜单“折叠/展开”；两种入口共享状态与 accessible name，点击 chevron 不移动正文光标或修改文档。
4. 保留嵌套子章节状态：父章节展开后，原先单独折叠的子章节仍折叠。
5. 删除标题或转换为非标题时丢弃状态，Undo 恢复默认展开；升降级时身份可靠则按新层级重算，否则安全展开。
6. 空标题、同名标题与改名标题可独立折叠，状态不得依赖可见文本或 slug。
7. 键盘导航跳过隐藏内容；`Mod+A`、保存、导出、全文能力仍以完整文档为范围；可见区鼠标拖选不意外选择隐藏正文。

## 安全不变量

- 折叠不得修改 Markdown、TipTap 文档内容、blockId、sidecar 或文件字节。
- 折叠状态仅存在于当前编辑视图，重新打开页面全部展开。
- 标题折叠不得改变首 H1 与文件名同步、标题目录派生或 AI 全文上下文。

## 验收标准

- [x] H1–H6 的 chevron 可由鼠标与键盘操作，状态和可访问名称准确；空章节无可操作箭头。
- [x] 同级/高层级边界、嵌套章节、空标题、同名标题和改名标题折叠均正确。
- [x] 删除、类型转换、Undo、升降级及无法映射时的安全展开有测试覆盖。
- [x] 光标、`Mod+A`、鼠标拖选、保存、导出与全文语义符合 ADR-0013。
- [x] 重开页面全部展开，折叠与展开前后序列化内容完全一致。
- [x] 既有块菜单、标题目录、拖拽和编辑历史测试不回归。
- [x] 候选 SHA 上通过标准门禁；Electron smoke 未执行时记录 `NOT_RUN`。
- [x] 在 `.wt/DEV-054` / `dev/DEV-054` 隔离实现，完成 Standards + Spec 双轴审查后方可合并。

## 实现记录（DEV-054）

- 内核 `packages/kernel/src/extensions/fold.ts` 重写：章节边界按当前顶层 H1–H6 实时派生；所有有内容标题常驻 disclosure chevron（`data-fold-id` / `data-fold-state` / `aria-expanded` / `aria-label`「折叠章节|展开章节」，Tab 可达，Enter/Space 激活，mousedown 不动正文光标）；嵌套折叠保留；`canFoldBlock` 收紧为“有章节内容”；文档事务后身份调和（唯一 blockId + 位置稳定才保留，内核单块升降级经 `trustFoldIdentity` 显式声明保留，重复 blockId/整段替换/转非标题/删除全部安全展开）；折叠时隐藏区选区移回标题行；ArrowUp/Down 跨隐藏区跳到可见边界；鼠标拖选跨折叠区在首个隐藏边界截断（全文 Mod+A 显式豁免）；`revealBlockFoldAt` 供目录/锚点跳转只展开遮蔽祖先；`clearBlockFolds` 于 `setMarkdown` 重载时清空。
- 内核 `editor.ts`：`convertBlock` 支持 h1–h6；单块标题升降级用 `setNodeMarkup` 保留 blockId 并标记可信身份；`setMarkdown` 重载前清空折叠状态。
- 渲染层：块菜单折叠项改名「折叠章节/展开章节」与 chevron 同名，转换为子菜单补 H4–H6；`EditorView.tsx` 目录跳转先 `revealBlockFoldAt`；`globals.css` chevron 低视觉权重 + hover/focus 增强 + focus-visible 外框，隐藏区 `aria-hidden`，标题预留稳定左 gutter。
- 测试：`packages/kernel/tests/fold.test.ts`（12 例，覆盖 chevron 可发现性/键盘/accessible name、空章节、边界、嵌套、空/同名/改名标题、删除/转换/Undo、升降级与重复 ID 安全展开、光标/方向键/Mod+A/拖选截断、目录 reveal、序列化与保存零副作用、重载展开）；`editor-interactions.test.ts` 更新菜单断言并新增 H1–H6 转换覆盖。

### 门禁与验收记录

- 定向测试：`fold.test.ts` 12/12、`block-ops.test.ts` 8/8、`editor-interactions.test.ts` 16/16、`outline.test.ts` 21/21、`clipboard-serializer.test.ts` 6/6、`writing-surfaces.test.ts` 19/19、`slash-menu.test.ts` 3/3 通过。
- 完整 `vitest run`：149 文件 / 1230 通过 / 2 跳过（既有跳过项）。
- `pnpm typecheck`：全部包通过。
- `pnpm lint`：0 error；4 个 warning 与 master 基线完全一致（`import()` 类型注解，非本票文件）。
- `pnpm build`（electron-vite）：成功。
- changed-format：本次 8 个改动文件 `prettier --check` 全部通过（仓库全量 `prettier --check .` 在 master 基线即有 ~80 个既有未格式化文件，非本票引入）。
- `git diff --check`：通过。
- Electron smoke：`NOT_RUN`（本票未执行打包应用 smoke；按 DEV-057 统一在固定候选 SHA 上执行并记录，人工步骤见 DEV-057）。

### 双轴审查记录（Standards + Spec）

- Standards：中文注释 + DEV-054 标注遵循既有内核注释惯例；导出均带用途注释；无 any/非空断言滥用（`!` 仅用于测试与查找结果收窄）；prettier/eslint/tsc 全绿；`clampMouseSelection` 导出兼作测试入口已注明语义；无遗留 TODO。无阻断发现。
- Spec：交付 1-7 与安全不变量逐条映射到 `fold.test.ts` 断言；两处说明——(a) 块菜单文案由「折叠/展开」明确为「折叠章节/展开章节」以与 chevron 共享 accessible name（票据第 3 条要求共享名称）；(b) 鼠标拖选跨折叠区截断为可见侧选区（可见侧无可选内容时为空选区），全文 `Mod+A`/`selectAll` 显式豁免，保持完整文档语义。无阻断发现。

## 关联决策

- [ADR-0013](../../../docs/adr/0013-heading-section-folding.md)
- [ADR-0012](../../../docs/adr/0012-derived-document-outline-and-markdown-editing-boundaries.md)
- 术语：[CONTEXT.md](../../../CONTEXT.md) 标题章节 / 标题折叠 / 标题条目
