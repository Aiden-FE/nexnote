# DEV-057 · 工具栏、快捷输入与标题折叠集成 smoke

Type: dev
Module: integration
Status: implementation-complete
Blocked by: DEV-051（划词工具栏）、DEV-053（Markdown `/` 菜单）、DEV-056（折叠导航集成）
Depends: DEV-050～DEV-056
Effort: M
Priority: P1

## Scope

为本轮 Icon-first 工具栏、`/` 快捷输入与标题章节折叠建立真实用户路径的最终集成门禁，修复当前 slash-menu smoke 查询错误导致的空断言，并在打包应用中验证两种编辑器的可见行为与结果。

### 交付内容

1. 将 slash-menu smoke 改为稳定、真实且有判别力的 selector；断言菜单可见、可交互和动作结果，而非仅查询一个永不存在的 test id。
2. 在块文档与 Markdown 文档各执行一次真实键盘 `/` 流程，覆盖打开、过滤、选择、触发文本消费和写入结果。
3. 在打包应用验证顶部及划词工具栏的 Icon-first、动作分组、AI 入口、Tooltip/accessible name 与窄窗口溢出。
4. 验证 TipTap 与 CodeMirror 的正文/H1–H6 转换、撤销/重做及首 H1 文件名同步。
5. 验证两种编辑器的嵌套标题折叠、目录跳转自动展开祖先、“全部展开”、重开全部展开和 Markdown 字节保真。
6. 在固定候选 SHA 上绑定结果、日志和必要截图；无法在当前环境执行的平台项明确标记 `NOT_RUN` 并给出人工步骤。

## 安全不变量

- smoke 必须驱动打包应用的真实输入与可见 UI，不得用直接调用 hook、注入内部状态或错误 selector 制造假绿。
- 测试不得访问真实用户知识库、外部 provider 或网络 AI；AI 入口仅验证零隐式请求和菜单行为，除非使用明确隔离的测试 provider。
- Electron ABI smoke 完成后按项目协议恢复 Node ABI，避免污染后续测试环境。

## 验收标准

- [ ] 共享动作模型单测覆盖分组、别名搜索、编辑模式能力和上下文过滤。
- [ ] 编辑器集成测试通过真实键盘输入触发 `/`，不直接调用 `handleTextInput` 作为用户路径验收。
- [ ] Renderer 测试分别挂载真实 TipTap 与 CodeMirror，覆盖菜单、工具栏、标题转换和折叠关键路径。
- [ ] 打包 Electron smoke 在块文档与 Markdown 文档各完成一次真实 `/` 动作，并验证稳定 selector、可见性和结果。
- [ ] smoke 覆盖 Icon-first、Tooltip、响应式动作组、H1–H6、嵌套折叠、目录 reveal、全部展开、重开及 Markdown 字节不变。
- [ ] 候选 SHA 上通过 typecheck、完整测试、lint、build、changed-format、diff-check 和本票 Electron smoke；跨平台未运行项记录 `NOT_RUN`。
- [ ] 结果绑定候选 SHA，完成 Standards + Spec 双轴审查；合并后在 master 复跑门禁并更新 checkpoint 与 tracker。
- [ ] 在 `.wt/DEV-057` / `dev/DEV-057` 隔离实现。

## 关联决策

- [ADR-0006](../../../docs/adr/0006-editor-toolbar-and-quick-insert-boundaries.md)
- [ADR-0013](../../../docs/adr/0013-heading-section-folding.md)
- [ADR-0004](../../../docs/adr/0004-source-mode-replaces-split-pane.md)（2026-09-17 修订）
- 术语：[CONTEXT.md](../../../CONTEXT.md) 编辑器工具栏 / 划词工具栏 / 快捷插入 / 标题折叠

## Implementation evidence (2026-09-18)

- 隔离实现：`dev/DEV-057` / `.wt/DEV-057`，起点 `1cd11d7`，未更改 master 或总览 README。候选 SHA 见实现提交；独立 Standards/Spec 审查及合并后 master 门禁均待主代理执行，未预填 PASS。
- 稳定 selector：内核 `menu-view.ts` 的 `data-testid=block-slash-menu`、renderer `source-slash-menu.ts` 的 `data-testid=source-slash-menu`；保留 `data-slash-menu`、`role=listbox`、accessible name。`smoke.ts` 原不存在的 `data-testid=slash-menu` 否决式检查替换为对应编辑器的真实菜单可见、过滤、键盘选择、触发词消费与 H2 结果断言。核对源码视图范围，不将后台块文档菜单当作当前源码菜单。
- 浏览器真实路径：`typeWithKeyboard` 经 keydown + Chromium `execCommand('insertText')` 驱动 CodeMirror；`typeWithDomInput` 为 TipTap 同步真实 DOM selection 后逐字符派发 key/input（不调用内部 slash hook 或注入菜单状态）。共享目录单测新增模式、英文/中文别名、能力和上下文过滤。既有 `slash-menu-dom.test.ts` / `source-slash-menu.test.tsx` 均挂载真实编辑器并经输入事件触发；两种菜单的稳定选择器在测试中约束 `role`、accessible name、历史行为。
- 工具栏/划词：既有打包 smoke 覆盖常驻动作、窄窗「更多」整体组和 AI 下拉键盘、划词动作及 Tooltip；本轮添加源码 Icon-first AI/分组/Tooltip 断言。既有 `editor-toolbar-entries.test.tsx`、`editor-heading-actions.test.ts`、`rename-focus.test.tsx`、`fold.test.ts`、`source-heading-fold.test.ts`、`expand-all.test.tsx` 覆盖标题 H1–H6 正文转换/undo/redo/首 H1 文件名、两编辑器嵌套折叠、导航展开与重开。新增打包 Markdown 嵌套、目录跳转、全部展开、重开和磁盘字节对比断言。
- 门禁：`CI=true pnpm typecheck` PASS（5 包）；`env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test --maxWorkers=1 --testTimeout=60000` PASS（156 文件、1403 通过；1 文件/2 测试按既有条件跳过）；`pnpm lint` PASS（0 errors、4 个既有 warnings）；`pnpm build` PASS；`bash scripts/check-changed-format.sh` PASS；`git diff --check` PASS。最终提交后若继续更改测试，请重新记录数字。
- macOS arm64 打包：本机 Electron 44.2 离线复用、ABI149 staged、`--config.npmRebuild false` 目录打包、复制经验证的 ABI149 缓存至 asar.unpacked 并 ad-hoc 重签。旧 `-c.npmRebuild=false` 被当前 builder 解析成字符串而失败，`scripts/run-builder.mjs` 移除默认无效覆盖，改由调用者传布尔参数。`scripts/ci-smoke.mjs` 支持本机设置 `NEXNOTE_SMOKE_TIMEOUT_MS=600000`（CI 默认 180s）；测试完成已由 `pnpm test`/`pnpm pretest` 恢复 Node ABI147。
- packaged smoke **RUN, FAIL**：证据 `.scratch/nexnote-build/smoke/DEV-057/results.json`，257/261 checks PASS（4 FAIL）；CodeMirror `/h2`、嵌套折叠、目录 reveal、全部展开、重开与字节对比均 PASS。TipTap `/h2` 在 packaged Chromium 的合成 DOM 输入仍未打开菜单（仅保留 `/h2` 原文，未触发动作；renderer 真输入 DOM 测试通过）；另有既有 Cmd/Ctrl+E 预览切换、源码 AI Tooltip selector 和 DEV-048 预览滚动失败，详见 results.json，故不得声称全部通过。原先 180s 超时无法写回新结果，延至 600s 后得到明确失败清单。跨平台 Windows/Linux packaged smoke **NOT_RUN**（当前 macOS arm64 环境）；由对应 runner 打包、按其 Electron ABI staging、运行 `NEXNOTE_APP_PATH=<binary> pnpm smoke:ci` 并检查 results.json。
