# DEV-059 · 翻译工作台

Type: dev
Module: ai
Status: implemented
Branch: `dev/DEV-059`
Base: `master`
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
- `changed-format.log`：实现提交前工作树尚未进入 `master...HEAD`，脚本报告无已提交变更；最终候选提交后必须复跑并更新本节。
- `diff-check.log`：`git diff --check master` PASS。

## 候选

- Candidate SHA: 待最终提交后填写。
- Standards review: 待固定 SHA。
- Spec review: 待固定 SHA。
- 禁止合并或修改 master；本票仅交付 `dev/DEV-059` 固定候选。
