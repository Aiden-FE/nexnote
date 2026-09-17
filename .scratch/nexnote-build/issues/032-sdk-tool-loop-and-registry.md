# DEV-032 · SDK 原生工具循环与统一注册表

Type: dev
Module: ai
Status: closed
Blocked by: DEV-031（SDK 流式迁移）
Depends: DEV-014（Skill 系统）
Effort: L
Priority: P1

## Scope

落实 ADR-0008 的工具部分：以 SDK 原生 tool-call loop 替换现有「pre-tool 阶段先跑 allowlist 只读工具、结果拼 system message 再流式补全」的过渡实现；`tool-registry` 扩展为检索 Skill 与 Agent 工具的统一注册表，对话、写作、翻译共享；既有 allowlist/审批/审计接点接到 SDK 的工具执行路径上。

### 交付内容

- 模型返回 tool_calls → 注册表解析 → 执行 → 结果回传 → 续答的多轮闭环。
- 统一注册表：检索 Skill 与 Agent 工具同处登记，声明名称、参数 schema、只读/写入属性、是否需审批。
- 只读工具 `search_notes`、`list_pages` 迁移到注册表且行为不变。
- 审批与审计事件经 `agent:runEvent` 可见；已有 approval-store / audit-store 接点复用。
- provider 不支持 function calling 时优雅降级（只读注入或明确提示），不静默失败。

## 安全不变量（继承全局约束）

- 工具执行遵循 allowlist；未注册工具不可执行。
- 写工具默认需审批（权限模式见 DEV-039）。
- 只读工具不得写盘、不得发起额外网络请求（除本机索引查询）。
- 未真实运行的 GUI/真实网络验收标 `NOT_RUN`。

## 验收标准

功能：

1. mock provider 返回 tool_calls → 工具执行 → 结果回传续答，多轮闭环可验证。
2. 既有只读工具行为与输出格式不回归；旧 pre-tool 注入实现删除。
3. 审批/审计事件在 UI 与事件流中可见，含工具名、目标、结果摘要。
4. 不支持工具的模型降级路径有自动化断言。
5. request-spy：工具执行不产生计划外 provider 请求。
6. 统一注册表可被后续票（DEV-039/040/041）直接扩展，新增能力无需改链路。

门禁（候选 SHA 上执行并留证）：

7. `CI=true pnpm -r typecheck`；`env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`；`pnpm lint`；`pnpm build`；`git diff --check master...HEAD`。
8. Electron smoke 全绿：对话中工具调用与结果注入可见。

流程：

9. 在 `.wt/DEV-032` / `dev/DEV-032` 隔离实现；Spec 轴对照 ADR-0008 审查 PASS 后 `git merge --no-ff`；合并后复跑门禁并更新 README 与 checkpoint。

## 关联决策

- ADR：[0008 Vercel AI SDK 基座](../../../docs/adr/0008-vercel-ai-sdk-agent-foundation.md)
- 术语：[CONTEXT.md](../../../CONTEXT.md) Agent 工具（Agent Tool）/ 检索 Skill（Retrieval Skill）
