# DEV-059 · 翻译工作台

Type: dev
Module: ai
Status: implemented
Branch: `dev/DEV-059`
Code diff base: `0af6750`（当前 `origin/master`）
Decision: [ADR-0014](../../../docs/adr/0014-translation-modes-and-no-reasoning-requests.md)
Vocabulary: [CONTEXT.md](../../../CONTEXT.md)

## 行为与边界

- 新增全局、独立于编辑器实例的翻译工作台。命令面板在没有页面或选区时仍可打开；块编辑与 Markdown 源码/分栏视图的划词工具栏 AI 下拉也提供入口，并以当前选区作为可编辑初稿。
- 打开、输入、粘贴、修改目标语言都不会发起 AI 请求。只有点击“翻译”或在非 IME composition 状态按 `Cmd/Ctrl+Enter` 才显式提交。
- 原文 draft 始终可编辑；划词、全文、工作台三入口共享单次 200,000 字符上限。超限显示剩余/超出额度、禁用提交且绝不截断。
- 工作台结果只读、流式、可复制。停止保留已显示内容并标记未完成；关闭取消当前 run 并丢弃 draft/结果，不写页面、不写知识库、不进入 tab/文档树。
- runId 由每次主进程运行唯一分配；新提交取消上一流，旧 run 的晚到事件不更新当前会话。关闭与知识库切换均取消并清理会话。
- 源语言自动检测由翻译供应商完成。目标语言取 AI 设置中的全局默认；触发点临时切换只影响当次会话，不覆盖全局默认。
- AI 设置新增翻译默认目标语言和独立翻译 Profile assignment；复用既有 Profile，不新增供应商体系。未设置翻译 assignment 时兼容回退 writing assignment，再回退全局默认 Profile。
- 继续复用 `translation` scenario 与 `agent:run:translation` IPC，只扩展 `mode: input`。主进程持有 prompt、强制 `reasoningEffort: none`，翻译 scenario 工具集合恒为 0。
- 预览视图仍不新增编辑器翻译入口；全局命令打开工作台不依赖编辑器。划词/全文既有行为保持兼容。

## 验收覆盖

- main：input mode validation、200k 边界、主进程 prompt、reasoning none、0 tools、独立 translation assignment 与 writing fallback、AI 设置 IPC 持久化。
- renderer：零隐式请求、显式提交与 IME-safe 快捷键、runId 并发/迟到事件、关闭/停止/知识库切换取消、复制与重开清空、三入口长度、不写盘、命令面板和块/Markdown 划词下拉入口、设置 UI。
- 回归：划词/全文流式结果、选区消失清理、预览无入口、工具栏键盘可达性、零隐式 provider 请求。

## 真实证据

证据目录：`../evidence/DEV-059/`（日志为本地 `.log`，受 `.gitignore` 管理；本票记录可复核结果）。

- `typecheck.log`：`CI=true pnpm typecheck` PASS（shared/kernel/renderer/plugin-api/website）。
- `main-typecheck.log`：独立 main `tsc` FAIL，4 个 master 基线错误；涉及 `git-sync-doctor.ts`、`git-sync-doctor.test.ts`、`native-binding.test.ts`，这些文件相对 master 未改。DEV-059 触达文件未新增 main 类型错误。
- `full-test.log`：PASS，156 test files passed / 1 skipped；1413 tests passed / 2 skipped。定向命令均使用 `pnpm exec vitest run`。
- `lint.log`：PASS，0 errors / 4 个既有 warnings。
- `build.log`：PASS，main/preload/renderer 均构建完成。
- `changed-format.log`：候选提交后 `scripts/check-changed-format.sh master` PASS，所有变更文件符合 Prettier。
- `diff-check.log`：候选提交后 `git diff --check master` PASS。

## 复审 FAIL 历史与修复轮

- `f97597c` 独立复审：**Standards FAIL / Spec FAIL**。问题为划词/全文语言选择自动发起翻译、缺 DEV-060 reasoning output filter 与非流参数、异步默认语言覆盖用户选择、runId 返回前事件丢失、测试绕过真实入口，以及 code diff 基线包含非 DEV-059 release 继承提交。
- 本轮先将 DEV-059 自身提交重放到正确基线 `0af6750`，再 cherry-pick DEV-060 `cd1adf1` 与修复候选 `0a68725`；冲突合并保留 DEV-059 独立 translation Profile/input mode 和 DEV-060 translation-only reasoning 防泄漏。
- 修复：selection/document 语言修改只 patch 会话，不发请求；浮层新增显式“翻译/重新翻译”按钮。工作台继续由按钮或 IME-safe `Cmd/Ctrl+Enter` 提交。
- 修复：workbench 默认语言异步 hydration 绑定捕获 session id，并通过 `languageTouched` 闭包拒绝覆盖用户当次选择；旧会话回调不能修改新会话。
- 修复：`translate-stream` 在 awaiting-runId 阶段缓冲事件，invoke resolve 后仅回放匹配 runId；取消清空缓冲，迟到 resolve 只补 cancel，之后事件不生效；并发乱序 run 隔离。
- 测试升级为真实命令面板 command run、真实 TipTap AI 下拉 dispatch、真实 textarea input/keydown/compositionStart/compositionEnd，以及真实 `vault:changed` 事件关闭三个并发槽位并拒绝晚到事件。
- `gateway.ts` 已将无关 Prettier 排版恢复为 `0af6750` 基线，仅保留 translation feature routing / zero-tools 语义及 DEV-060 runtime 接线。

## 新候选

- Fixed code candidate: `646aeeb`（核心修复 `17d6109`；deferred 配置测试 `7664558`；gateway 基线清理 `4cd2654`；review 覆盖收尾 `646aeeb`）。
- DEV-060 定向：用户指定原 26 测试命令现为 27/27 PASS（translation-request 因本票 input mode 多 1 用例）；DEV-059 main/renderer 定向此前 8 files / 144 tests PASS，最终关键三文件 47 tests PASS。日志 `../evidence/DEV-059-fix/dev060-targeted.log`、`dev059-targeted.log`。
- 六门禁：root typecheck PASS；完整测试 156 files passed / 1 skipped、1428 tests passed / 2 skipped；lint PASS（0 errors / 3 个既有 warnings）；build PASS；changed-format（base `0af6750`）PASS；diff-check（`0af6750...HEAD`）PASS。完整测试首轮发生既有 `watch-service` chokidar 时序 flake，隔离 11/11 PASS 后全量重跑全绿；日志位于 `../evidence/DEV-059-fix/`。
- Main 独立 typecheck 仍按前轮记录为未覆盖于 root command；本轮改动未触及那 4 个基线错误文件。
- Standards review: 待新固定候选独立复审。
- Spec review: 待新固定候选独立复审。
- 禁止合并或修改 master；本票仅交付 `dev/DEV-059` 固定候选。
