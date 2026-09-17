# DEV-056 · 标题目录跳转与“全部展开”

Type: dev
Module: editor
Status: implementation-complete
Blocked by: DEV-054（块标题折叠）、DEV-055（Markdown 标题折叠）
Depends: DEV-047（标题目录与悬浮目录）
Effort: M
Priority: P1

## Scope

依据 ADR-0013，打通标题目录、查找与两种编辑器折叠状态。用户跳转到隐藏标题或查找命中隐藏正文时，应用自动恢复目标所需的可见路径；同时提供明确的“全部展开”恢复入口。

### 交付内容

1. 标题目录点击隐藏目标时，自动展开所有遮蔽目标的祖先章节，再定位并高亮目标。
2. 目标标题自身若已折叠则保持折叠，因为标题行可见；不得清空无关分支的折叠状态。
3. 编辑器查找命中隐藏内容时采用同样的最小祖先展开规则并定位命中。
4. 在标题目录菜单与命令面板提供“全部展开”，同时作用于当前页面当前编辑视图。
5. 本轮不提供无差别“全部折叠”，也不持久化批量展开结果。
6. TipTap 与 CodeMirror 对用户保持一致语义，并提供屏幕阅读器可理解的状态反馈。

## 安全不变量

- 跳转、查找和全部展开仅改变临时视图状态，不修改正文、sidecar、标题目录数据或文件字节。
- 仅展开到达目标所必需的祖先，不重置目标自身或其他分支状态。
- 命令只作用于当前页面和当前 tab，不得串改后台页面折叠状态。

## 验收标准

- [x] 块文档与 Markdown 中，目录跳转到多层隐藏标题均展开必要祖先并准确定位。
- [x] 目标自身折叠与无关分支状态保持；重复跳转结果稳定。
- [x] 查找命中隐藏正文时可见、可定位，且不会展开整页无关章节。
- [x] 标题目录菜单与命令面板均可执行“全部展开”，键盘与屏幕阅读器可达。
- [x] 页面切换、tab 关闭与重开不残留或串用折叠状态。
- [x] Renderer 测试覆盖两种编辑器、嵌套祖先、目标自身折叠、无关分支和全部展开。
- [x] 候选 SHA 上通过标准门禁；Electron smoke 未执行时记录 `NOT_RUN`。
- [ ] 在 `.wt/DEV-056` / `dev/DEV-056` 隔离实现，完成 Standards + Spec 双轴审查后方可合并。

## 关联决策

- [ADR-0013](../../../docs/adr/0013-heading-section-folding.md)
- [ADR-0012](../../../docs/adr/0012-derived-document-outline-and-markdown-editing-boundaries.md)
- 术语：[CONTEXT.md](../../../CONTEXT.md) 标题折叠 / 标题目录 / 悬浮目录

## 实现记录（DEV-056）

- 块编辑与 Markdown 源码视图均在目录跳转或查找定位隐藏内容前，仅展开遮蔽该位置的已折叠祖先。标题自身的正文折叠状态、无关分支及重复定位结果保持不变；定位选区提供目标高亮。
- 新增当前视图“全部展开”原语，并在悬浮目录与命令面板提供入口；不注册任何“全部折叠”命令。命令经 tab id 精确解析当前编辑器实例，后台 tab 不会被修改。
- 新增当前页面查找栏（`Mod/Ctrl+F`），命中折叠正文时按同一最小祖先规则显现；不会夺走查找输入框焦点。
- 展开反馈使用当前 tab 过滤的 `aria-live` status；目录 active item 使用 `aria-current=location`。折叠、查找、跳转和批量展开均不写正文、sidecar 或文件。
- 覆盖真实 ProseMirror/CodeMirror renderer 的嵌套祖先、目标自身、无关分支、重复 reveal、零字节/零保存与全部展开；额外覆盖 activeTabId 路由，不串改后来注册的后台块/Markdown 编辑器。

### 门禁与验收记录

候选提交前工作树验证（最终 SHA 由本票提交产生）：

- 定向测试：`fold.test.ts`、`source-heading-fold.test.ts`、`expand-all.test.ts`、`commands-builtin.test.ts`、`source-mode-outline.test.tsx`、`caret-insert.test.ts`：通过。
- 完整 `pnpm test`：152 文件中 151 通过 / 1 跳过，1296 测试通过 / 2 跳过。
- `pnpm typecheck`：全部 workspace 包通过。
- `pnpm lint`：0 error；4 个既有 `import()` type annotation warning，均不在本票文件。
- `pnpm build`：Electron Vite 构建成功；仅既有 Rollup 动态导入/第三方注释 warning。
- changed-format：本票改动文件 `prettier --check` 通过。
- `git diff --check`：通过。
- Electron smoke：`NOT_RUN`（未执行打包应用 smoke，不以自动化测试或构建替代）。

### 审查状态

- 实现阶段已完成自审，并修复了重复命令注册、全局最近编辑器导致的跨 tab 操作风险、查找抢占输入焦点及 CodeMirror 更新钩子重入 dispatch 风险。
- 未预填独立 Standards + Spec PASS：固定候选提交上的独立双轴审查仍待执行。本票保持 `implementation-complete`，不标记 closed。
