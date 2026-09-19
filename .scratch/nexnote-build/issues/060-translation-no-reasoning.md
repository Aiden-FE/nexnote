# DEV-060 · 翻译请求禁用 reasoning 与输出防泄漏

Type: dev
Module: ai
Status: implementation-complete
Blocked by: 无
Depends: DEV-041（临时翻译）、DEV-031（SDK 流式链路）
Effort: M
Priority: P0

## Scope

强化 translation-only 的 reasoning 禁用边界：请求协议真实携带 `reasoning_effort=none`，输出层屏蔽 reasoning channel 与协议标记，不以输出清洗替代模型侧关闭；非翻译场景保持现状。

## 安全不变量

- translation 流式请求和非流式 fallback 均携带 `reasoning_effort=none`；provider 拒绝该参数时显式失败，禁止静默移除后重试。
- translation 丢弃 `reasoningDelta`，并隐藏完整 `<think>` / `<analysis>` 协议块；标签大小写、标签内空白、嵌套混合、多块及任意 chunk 边界均适用。
- 只有完整 opening tag 才进入隐藏态。普通正文中的 `<`、`<thi`、`<think`、`<analysis`、`<thinking>` 与相似文本必须逐字保真；在正常 `done` 时 pending partial opening tag 原样 flush。
- 一旦观察到完整 opening tag，未闭合块及其中内容不得因 `done`、错误、取消或流截断泄漏。
- 错误/取消保留已输出译文；终止后的晚到事件不得再次输出。非 translation 场景的 delta / reasoningDelta / 标签文本不改变。
- 输出清洗是 provider 防御层，不替代请求侧 `none`。

## 验收标准

- [x] 主进程 translation 参数继续强制覆盖为 `reasoningEffort: none`，渲染层不能覆盖。
- [x] OpenAI-compatible 流式与非流式请求、Azure 非流式 deployment 路径均由真实 mock HTTP 断言 `reasoning_effort=none`。
- [x] provider HTTP 400 拒绝 reasoning 参数时仅产生一次请求并显式失败，不去参重试。
- [x] filter 覆盖普通 `<`/partial prefix/相似标签保真、完整标签每个切分点、固定种子随机 chunk、大小写与空白、nested mixed、多 block、未闭合 block。
- [x] gateway/runtime 覆盖 translation-only 清洗、正常 done flush、错误与取消保留已输出内容、隐藏缓冲不泄漏、终止后晚到事件屏蔽。
- [x] `gateway.ts` 的无关 Prettier 排版 diff 已回退；最终与 `master` 该文件逐字一致。
- [x] 六门禁已执行并留证；root typecheck 与 main 独立 typecheck 的覆盖差异和基线错误分开记录。
- [ ] 固定候选 SHA 上的独立 Standards + Spec 双轴复审待执行；本票不预填 PASS、不合并。

## 实现记录

- `packages/main/src/agent/reasoning-filter.ts` 使用小型字符状态机，仅识别完整 think/analysis 协议标签；潜在标签跨 chunk 缓冲，判定为普通正文或流正常结束时原样恢复。隐藏态使用 tag stack 处理 mixed nesting，并对未闭合块 fail-closed。
- `packages/main/src/agent/runtime.ts` 只为 translation 包装 provider 事件：屏蔽 reasoningDelta，delta 经 filter，done 先 flush 后透传；error / abort 后关闭事件闸门，防止晚到 delta/done。普通场景直接沿用原事件回调。
- `packages/main/src/ai/provider/openai.ts` 的非流式请求体补齐 provider-neutral `reasoningEffort` 到 OpenAI `reasoning_effort` 的映射，与流式 SDK 路径一致。
- `packages/main/tests/translation-request.test.ts` 增加 16 个定向用例，其中包含每个切分点循环与 100 轮固定种子随机 chunk。

## 门禁与证据

证据目录：`.scratch/nexnote-build/smoke/DEV-060/`（完整日志因 `.gitignore` 默认忽略；精选摘要随候选提交入库）。

- 定向：`pnpm exec vitest run packages/main/tests/translation-request.test.ts packages/main/tests/agent-gateway-e2e.test.ts`：26/26 PASS。
- 完整测试：`CI=true pnpm test`：156 文件通过 / 1 跳过；1413 测试通过 / 2 跳过。日志 `test.log`。
- Root typecheck：`pnpm typecheck`：PASS；该命令实际只运行 workspace 中声明 typecheck script 的包。日志 `typecheck-root.log`。
- Main 独立 typecheck：`pnpm exec tsc -p packages/main/tsconfig.json --noEmit`：FAIL，4 个错误均位于未修改文件（`git-sync-doctor.ts` 2 个、`git-sync-doctor.test.ts` 1 个、`native-binding.test.ts` 1 个）。在基线 worktree `dev/DEV-059` / `0af6750` 运行同一命令出现同样 4 类基线错误，另多一个已由既有 `cd1adf1` 修复的 translation feature fixture 错误；本票无新增 main type error。日志 `typecheck-main.log`、`typecheck-main-baseline.log`。
- Lint：PASS，0 errors / 4 个既有 warnings。日志 `lint.log`。
- Build：PASS。日志 `build.log`。
- Changed-format：PASS。日志 `changed-format.log`。
- Diff-check：`git diff --check master...HEAD` 与工作树 `git diff --check` 均 PASS。日志 `diff-check.log`。
- Release config：31/31 PASS（额外验证，不计入六门禁）。日志 `release-config.log`。
- Electron smoke：`NOT_RUN`；本票协议与生命周期由真实 mock HTTP + runtime 测试覆盖，未虚报 GUI PASS。

## 初审 FAIL 与修复

既有候选 `cd1adf1` 的 Standards/Spec 初审为 FAIL：`finish()` 会误删普通文本末尾 `<think` / `<analysis` / `<thi`，测试反而固化误删；且 `gateway.ts` 含无关 Prettier 排版 diff。本轮已修复过滤语义、补齐保真与全切分反例，并将 `gateway.ts` 恢复为 `master` 内容。新的候选必须重新进行独立双轴复审。
