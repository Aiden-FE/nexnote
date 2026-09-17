# DEV-031 · Vercel AI SDK 迁移（流式链路）

Type: dev
Module: ai
Status: closed
Blocked by: 无（可立即开始）
Depends: DEV-009（Provider Adapter）、DEV-010（写作辅助）、DEV-012（对话 dock）
Effort: L
Priority: P0

## Scope

落实 ADR-0008：AI 编排统一到 Vercel AI SDK。本票只做流式链路迁移——`agent:run:chat` 与 `agent:run:writing` 的生成经 SDK 发起，Provider Adapter（OpenAI 兼容协议、用户自定义 base-url/key/模型）仍是唯一接入层，自研 SSE 解析路径退役。工具循环不在本票范围（见 DEV-032）。若实现超出单上下文窗口，按 expand–contract 拆分：先并行保留旧路径，再切流，后删旧实现。

### 交付内容

- 主进程引入 `ai` 包，经 OpenAI-compatible client 指向既有 Provider Profile 配置，不绕过适配层。
- chat 与 writing 两条生成链路改走 SDK 流式接口。
- `agent:runEvent` IPC 协议（start/delta/done/error/context 等）保持向后兼容，渲染层订阅方式不变。
- 删除裸 fetch + 自写 SSE parser 的旧实现（不长期双轨）。
- 供应商参数差异（如 reasoning 开关）在适配层吸收，为 DEV-041 翻译铺路。

## 安全不变量（继承全局约束）

- API key 仅存系统凭据库，不进日志、不进产物、不进渲染层。
- 请求必须由显式意图触发（ADR-0005；DEV-030 门禁覆盖）。
- 未真实运行的 GUI/真实网络验收标 `NOT_RUN`。

## 验收标准

功能：

1. mock provider 下 chat 与 writing 流式端到端工作，首片段即时到达。
2. `agent:runEvent` 事件序列与迁移前一致（新增事件可加，旧事件语义与顺序不变）。
3. 旧 SSE 实现删除；代码中不存在并行第二套流式接入。
4. 断线、超时、provider 报错的错误事件语义不回归。
5. request-spy 断言：仅显式操作发请求。
6. reasoning 开关等参数可按请求覆盖（为 DEV-041 提供接口）。

门禁（候选 SHA 上执行并留证）：

7. `CI=true pnpm -r typecheck`；`env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`；`pnpm lint`；`pnpm build`；`node scripts/verify-release-config.mjs`；`git diff --check master...HEAD`。
8. Electron smoke 全绿：对话与写作流式在打包产物中工作。

流程：

9. 在 `.wt/DEV-031` / `dev/DEV-031` 隔离实现；双轴审查（Spec 轴对照 ADR-0008）PASS 后 `git merge --no-ff`；合并后复跑门禁并更新 README 与 checkpoint。

## 关联决策

- ADR：[0008 Vercel AI SDK 基座](../../../docs/adr/0008-vercel-ai-sdk-agent-foundation.md)、[0005 显式意图与流式](../../../docs/adr/0005-explicit-ai-intent-and-streaming-results.md)
- 术语：[CONTEXT.md](../../../CONTEXT.md) 供应商 Profile（Provider Profile）/ 流式生成（Streaming Generation）
