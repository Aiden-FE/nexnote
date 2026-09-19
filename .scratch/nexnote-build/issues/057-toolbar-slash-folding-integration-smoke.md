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

- 隔离实现： / ，基线 ；最终代码候选 SHA：。最终证据 JSON 内 ，由 fail-closed  强制比对；缺失结果、超时、非零退出、平台/版本元数据不匹配均会失败。
- Windows/Linux packaged smoke 在当前 macOS arm64 环境 ；最终 results.json 明确列入  与 ，需对应 runner 按 Electron ABI staging、设置完整  后执行 。
- 稳定 selector：块菜单 ，源码菜单 ；保留 、、。断言菜单可见、候选、键盘选择、触发词消费和 H2 结果，未使用不存在的 selector。
- 可信输入：块/源码路径经 preload → main  鼠标定位、键盘/粘贴输入驱动 packaged Chromium；渲染层不调用 slash hook、不注入菜单状态或内部 transaction。旧合成  helper 已删除。
- 最终证据：（强制入库）；appVersion=0.0.14、platform=darwin、electronVersion=44.2.0、electronAbi=149， checks passed，含 40 个相对截图文件名。执行后已运行 better-sqlite3 node binding ready: /Users/aiden/dev/aiden/nexnote/.wt/DEV-057/node_modules/.cache/nexnote-native-bindings/better-sqlite3/darwin-arm64-abi147/better_sqlite3.node 恢复 Node ABI147。
- 非打包门禁：Scope: all 7 workspace projects
✓ Lockfile passes supply-chain policies (verified 1d ago)
Lockfile is up to date, resolution step is skipped
Already up to date

Done in 306ms using pnpm v11.15.1
Scope: 6 of 7 workspace projects
apps/website typecheck$ tsc --noEmit
packages/plugin-api typecheck$ tsc --noEmit -p tsconfig.json
packages/shared typecheck$ tsc --noEmit -p tsconfig.json
apps/website typecheck: Done
packages/plugin-api typecheck: Done
packages/shared typecheck: Done
packages/kernel typecheck$ tsc --noEmit -p tsconfig.json
packages/kernel typecheck: Done
packages/renderer typecheck$ tsc --noEmit -p tsconfig.json
packages/renderer typecheck: Done、完整测试 、lint 、build、changed-format、diff-check 均通过。
- 独立 Standards/Spec/证据对抗审查：最终候选  待主代理复审；本票不预填 PASS。
