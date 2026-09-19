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

## Implementation evidence

- 隔离实现：dev/DEV-057 与 .wt/DEV-057，基线 1cd11d7；最终代码候选 SHA：48f9604dd75b791e7d1cae35522b0d1ba4b34e47。唯一最终证据目录：.scratch/nexnote-build/smoke/DEV-057-48f9604dd75b791e7d1cae35522b0d1ba4b34e47/。
- 最终 macOS arm64 packaged smoke：RUN/PASS，260/260 checks passed，40 张截图与 results.json 同目录并强制入库；报告 candidateSha 绑定完整候选 SHA，appVersion=0.0.14、platform=darwin、electronVersion=44.2.0、electronAbi=149。scripts/ci-smoke.mjs 在缺失/旧 results、超时、非零退出、SHA/平台/版本/ABI 不匹配时返回非零。
- Windows/Linux packaged smoke：NOT_RUN；results.json 的 notRun/manualSteps 字段记录目标平台及跨 runner ABI staging、完整 SHA、应用版本、Electron 版本、平台、ABI 参数。当前目标发布的 CI release workflow 会在各自原生 runner 上执行 packaged smoke。
- 稳定 selector：块菜单 data-testid=block-slash-menu，源码菜单 data-testid=source-slash-menu；保留 data-slash-menu、role=listbox、aria-label=快捷插入动作。断言菜单可见、候选、键盘选择、触发词消费和 H2 结果，不查询不存在的 selector。
- 可信输入：块/源码路径经 preload 到 main 的 WebContents 鼠标定位、键盘与编辑输入驱动 packaged Chromium；渲染层不调用 slash hook、不注入菜单状态或内部 transaction。QuickInsert 通过通用 beforeinput 与既有 handleTextInput 支持真实浏览器/Chromium 编辑事件，不含 smoke-only 生产分支。
- 非打包门禁：CI=true pnpm typecheck、完整测试 156 files / 1403 passed / 2 skipped、lint 0 errors / 4 existing warnings、build、changed-format、diff-check 均通过。执行后 pnpm pretest 恢复 Node ABI147。
- 独立 Standards/Spec/证据对抗审查：固定最终候选 48f9604dd75b791e7d1cae35522b0d1ba4b34e47，待主代理终审；本票不预填 PASS。
