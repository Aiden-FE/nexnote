# DEV-030 · 零隐式 AI 请求门禁

Type: dev
Module: ai
Status: open
Blocked by: 无（可立即开始）
Depends: DEV-009（Provider Adapter）、DEV-011（检索/向量索引）
Effort: M
Priority: P0

## Scope

落实 ADR-0005 的硬不变量：任何 AI provider 请求（含 chat、embeddings、分类、索引）必须由用户显式意图触发；普通编辑路径零请求。诊断记录显示普通编辑期间出现 `/embeddings` 调用并返回 400，说明存在隐式触发路径。本票建立请求层测试基建并修复现存问题，使该不变量成为常驻门禁，供后续全部 AI 票复用。

### 交付内容

- 主进程级 request-spy / mock provider 测试基建：拦截所有发往 AI provider 的 HTTP，断言按场景为零或显式。
- 覆盖场景断言：输入、删除、粘贴、撤销/重做、光标与选区变化、自动保存、H1 改名、Tab 切换、打开编辑器/dock/预览、普通搜索与页面浏览 → 零 provider 请求。
- 排查并修复现存隐式调用（重点：embedding/索引是否挂在保存或编辑链路、是否有 debounce 后自动触发的语义检索）。
- 输出场景-请求矩阵文档，作为后续票据的验收依据。

## 安全不变量（继承全局约束）

- 不因建立 spy 而弱化生产 fail-closed 行为；spy 仅测试期注入。
- API key 不进日志与测试产物。
- 未真实运行的 GUI 验收标 `NOT_RUN`。

## 验收标准

功能：

1. request-spy 基建落地，上列全部场景有自动化断言且全绿。
2. 现存隐式触发路径（若确认存在）修复，并有回归断言固化。
3. 显式 AI 操作（划词写作、询问 AI、对话发送、显式索引/语义搜索）仍正常发请求，不被误伤。
4. 场景-请求矩阵文档进入仓库，标明每场景允许的请求集合。

门禁（候选 SHA 上执行并留证）：

5. `CI=true pnpm -r typecheck`；`env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`；`pnpm lint`；`pnpm build`；`git diff --check master...HEAD`。
6. Electron smoke 全绿，新增覆盖：普通编辑后检查请求层无 AI 调用。

流程：

7. 在 `.wt/DEV-030` / `dev/DEV-030` 隔离实现；双轴审查（Spec 轴对照 ADR-0005 逐条）PASS 后 `git merge --no-ff`；合并后复跑门禁并更新 README 与 checkpoint。

## 关联决策

- ADR：[0005 显式 AI 意图与流式结果](../../../docs/adr/0005-explicit-ai-intent-and-streaming-results.md)
- 术语：[CONTEXT.md](../../../CONTEXT.md) 显式 AI 意图（Explicit AI Intent）/ 渐进式召回（Progressive Recall）
