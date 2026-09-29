# DEV-092 自动保存后光标跳到文档末尾（自写入内容回灌编辑器）

- 状态：done（2026-09-28）
- 分类：bug
- 优先级：P0
- 工作量：M
- 范围：packages/renderer（EditorView / SourceModeView 的 fs:changed 处理），packages/kernel（如需 selection 保真 API）
- Depends: DEV-077（created/updated 由应用维护：保存时刷新 frontmatter.updated）、DEV-088（解决后再同步）
- 来源：用户反馈 2026-09-22 / triage 2026-09-27

## 背景

用户报告：编辑过程中自动保存一触发，光标就跳到文档末尾，继续输入会落在错误位置，"文档几乎无法编辑"。

根因是应用**自己写入的文件被自己当成外部变更重载**——一次自我回灌（self-reload）把编辑器的选区冲掉。块编辑器与源码模式都受影响。

## 现状（核实）

写入链路与回声链路已逐行核对：

1. **保存时改了内容再落盘**：`saveSourceText`（`packages/renderer/src/editor/source/page-source-io.ts:85-95`）在 `diskText !== text` 时调用 `stampUpdated(text)` 刷新 `frontmatter.updated` 后再写。于是**磁盘字节 ≠ 编辑器 buffer**（buffer 里没有新时间戳）。
2. **dirty 被清掉**：`writeSnapshot` 结束时 `if (kernelRef.current?.getMarkdown() === markdown) dirtyRef.current = false`（`packages/renderer/src/editor/EditorView.tsx:501`）——`markdown` 是**盖戳前**的 buffer，所以条件成立，dirty 归 false。
3. **应用自身写入的回声被放行重载**：`fs:changed` 的 `origin === 'app'` 分支（`EditorView.tsx:750-772`）在 `!dirtyRef.current && kernelRef.current?.getMarkdown() !== text`（`:765`）时执行 `setMarkdown(text)`（`:766`）。此时 `text`（磁盘内容，含新时间戳）与 buffer 不等，条件为真 → **无条件整篇替换**。
4. **整篇替换必然丢选区**：`setMarkdown` → `kernel/editor.ts:176-181` 的 `setContent(json, { emitUpdate: false })`（`:180`）是**盲目全量替换**，不保存/恢复 selection；ProseMirror 的映射把光标推到文档末尾。源码模式同理更差：`codemirror-host.ts:220-234` 全量替换（`from:0,to:doc.length`），CodeMirror 对范围映射取 `assoc=-1` → 光标落到位置 0。
5. 现有防护（`emitUpdate:false`、CM 的 `programmatic` 标记、`AppWriteTracker`、dirty 检查、版本比对）只能**抑制冲突与死循环**，无法阻止这次自我回灌。

**结论：可复现，且两处编辑器都受影响。**

## 期望行为

1. **应用自身写入不得触发内容重载**：`origin:'app'` 且写入内容与编辑器 buffer 等价（忽略应用注入的 `updated` 时间戳差异）时，只更新基线版本/文本，**不得**调用 `setMarkdown`/全量替换。
2. **若确需重载**（真正的应用内联动改写，如 rename 联动重写了本页），必须**保留选区**：重载前后恢复光标/选区；无法映射时退化为"保持光标所在的近似位置"而不是末尾/开头，并且不得在用户正在输入时执行。
3. **保存的往返不改变编辑体验**：连续快速输入期间自动保存反复触发，光标位置在任何一次保存前后保持稳定。
4. 既有安全语义不回归：外部（非 app）修改仍按 `classifyExternalChange` 判定 conflict/reload；`updated` 仍在内容变化时刷新；字节保真（ADR-0004）语义不变。

## 关键接口

- `fs:changed` 的 `origin:'app'` 分支（`EditorView.tsx:750-772`）与 `SourceModeView` 对应分支的判定需要把"应用注入的时间戳差异"从"真实内容差异"中剔除（例如比较时对 frontmatter `updated` 做规范化，或由写入方回传写入后的规范文本供基线比对，`baseTextRef` 应记录**含戳的最终文本**）。
- `writeSnapshot`（`EditorView.tsx:469-502`）在保存成功后应把 `baseTextRef` 写成落盘的真实文本，而不是盖戳前的 buffer。
- 确需重载的路径要给 kernel 一个"保留 selection 的 setMarkdown"入口（`packages/kernel/src/editor.ts`）。

## 验收标准

- [ ] 块编辑器：光标置于文档中部持续输入，自动保存触发多次后，光标仍在原输入位置（不跳末尾）
- [ ] 源码模式（CodeMirror）：同上，光标不跳位置 0
- [ ] 单次「输入 → 等自动保存 → 立刻继续输入」，落点与输入顺序正确，内容不乱序
- [ ] 保存后 `frontmatter.updated` 仍被正确刷新（DEV-077 语义不回归）
- [ ] 真实外部修改仍正确弹出冲突/重载（`classifyExternalChange` 语义不回归）
- [ ] 新增回归测试：模拟"保存 → app 回声 fs:changed"，断言不调用全量 setMarkdown 且选区不变
- [ ] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿

## Out of scope

- 重做自动保存调度策略（debounce/间隔）
- 撤销栈语义调整
- 外部变更的 conflict UI（归 DEV-076/088）
