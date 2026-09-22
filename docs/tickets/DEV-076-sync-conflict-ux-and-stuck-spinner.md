# DEV-076 冲突提示可诊断、Agent 修复入口与同步转圈收尾

- 状态：ready-for-agent
- 分类：bug
- 优先级：P0
- 工作量：M
- 范围：packages/main、packages/renderer
- 关联：DEV-073（同步 UX 统一，本轮补齐其未覆盖的冲突态与收尾）
- 来源：用户反馈 2026-09-22

## 当前行为（已核实的三个缺陷）

左下角状态栏出现「⚠ 冲突」时：

1. **hover 无有效信息**：冲突徽标只有原生 `title="存在未解决的合并冲突"`（`packages/renderer/src/features/git/index.tsx` 的 GitStatusItem），看不到冲突文件、原因或下一步。
2. **没有 Agent 修复入口**：`DoctorDialog`（含「让 Agent 修复 / 让 Agent 帮助解决」按钮）只在**本次会话内手动点击同步且抛错**后才出现。冲突若在启动时已存在，或由后台自动同步产生，徽标本身不可点击，用户无任何入口进入诊断/修复。
3. **同步转圈永不结束**：
   - `busy = phase !== null && phase !== 'done'`——主进程 sync 失败时发出 `phase: 'error'`，渲染进程却只在 `done` 时 600ms 后清 spinner，`error` 被永久当作「忙」，spinner 一直转；关闭 doctor 弹窗（dismiss）也不重置 phase。
   - 自动同步计时器调用 sync 时 `onProgress: undefined`，且主进程的 `onSyncProgress` 全局从未注册——后台自动同步对 UI 完全静默，既看不到阶段，失败也无任何提示。

## 期望行为

1. **spinner 在任何终态都收尾**：`error` 与 `done` 一样是终态，失败后 spinner 停止；错误信息以可感知方式呈现（tooltip / 徽标），而非靠永转的 loading 表达。
2. **冲突徽标可点击**：点击「⚠ 冲突」（或同步错误态）触发 `git:doctor:diagnose` 并弹出 `DoctorDialog`，展示冲突文件与说明，提供既有的一键修复 / Agent 帮助解决入口；若 doctor 不可用则降级为带具体错误文案的提示。
3. **hover 有实质内容**：tooltip 至少包含冲突类别与冲突文件列表（来自 `GitDoctorDiagnosis` / `GitStatus`），不是一句空泛的「存在冲突」。
4. **自动同步可见且必收尾**：自动同步的进度事件能到达渲染进程（在主进程 bootstrap 注册 `onSyncProgress` → 广播到主窗口，等价于手动同步的 `git:syncProgress` 路径）；UI 对自动同步显示阶段文案，done/error 都会结束 spinner；自动同步失败时按冲突态给出可点击的诊断入口。
5. dismiss doctor 后徽标/错误态回到一致的静态展示，不残留 spinner。

## 关键接口

- `GitStatusItem` 的 busy 判定：`error` 必须移出忙态；`phase` 在 doctor dismiss、错误展示后重置。
- `GitStatus`：已有 `conflict` 布尔；冲突文件细节以 `git:doctor:diagnose` 返回的 `GitDoctorDiagnosis.conflictFiles` 为准（不要求改 shared 结构；若 doctor 无法覆盖，可评估在 GitStatus 增补字段）。
- 主进程 `GitService.onSyncProgress(listener)`：在服务装配处注册，将事件经窗口广播；`syncProgressListener` 目前无任何注册点。
- 既有 `DoctorDialog` / `runOneClickRepair` / `openAgentHelp` 逻辑直接复用，不重写修复链路。

## 验收标准

- [ ] 手动同步失败（含冲突）后 spinner 停止，不再无限转圈；错误内容可见
- [ ] 「⚠ 冲突」徽标可点击，点击后弹出诊断对话框，含冲突文件与一键修复 / Agent 帮助入口
- [ ] hover 冲突徽标能看到具体冲突文件或类别信息
- [ ] 启动时已存在冲突、或后台自动同步产生冲突时，徽标出现且点击路径可用；自动同步失败不再静默
- [ ] 自动同步进行中有阶段反馈，done/error 均结束 spinner；dismiss 诊断后 UI 无残留 loading
- [ ] 新增/更新单测覆盖：error 终态收尾、冲突徽标点击触发诊断、自动同步进度事件到达 UI
- [ ] `pnpm typecheck` / `pnpm lint` / 全量 Vitest / `pnpm build` 全绿；Electron smoke 中冲突场景全绿

## Out of scope

- 改变同步策略（rebase/merge）与安全门禁（永不 force push 等）
- 重写 git doctor 的诊断/修复执行机制
- 自动同步间隔默认值调整
