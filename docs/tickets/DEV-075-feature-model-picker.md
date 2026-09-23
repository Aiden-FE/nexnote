# DEV-075 分功能指定模型：自由输入 + 已识别模型下拉双模式

- 状态：ready-for-agent
- 分类：enhancement
- 优先级：P2
- 工作量：S
- 范围：packages/renderer（复用既有 `ai:listModels` IPC，无 main/shared 改动）
- 来源：用户反馈 2026-09-22（设置中分功能指定模型时缺少模型候选）
- 重审：triage 2026-09-22 —— 逐项核对过代码路径，主张全部成立，无方案改动；仅补充精确行号与缓存语义

## 背景

设置页「AI 供应商 → 分功能指定模型」中，选中供应商 Profile 后的模型输入是纯文本框，用户必须手工背出模型 id；写错只有到实际调用时才会失败。而主进程早已具备模型列表能力，renderer 从未调用：

- 主进程 IPC：`ai:listModels` handler 在 `packages/main/src/ipc/ai-handlers.ts:51-53`，实现在 `packages/main/src/ai/ai-service.ts:298-299`，入参 `AiConnectionTarget`（`packages/shared/src/types/ai.ts:123-132`，`{ profileId?, candidate? }`，只带 `profileId` 合法），返回 `{ models: string[] }`。
- renderer 全仓 0 个调用点（只有 main 侧契约测试在用）。

现状（`packages/renderer/src/features/ai/AiSettingsSection.tsx` 分功能指定区块）：
- 选中 Profile 后出现模型文本框（`data-testid="ai-feature-model-<key>"`，lines 366-373），`onChange` 直接 `setFeature(key, profileId, e.target.value)` 走 `ai:features:set` 写库——**每敲一个字符发起一次 IPC 状态写**。
- 切换 Profile 时由 `assignmentModelHint`（lines 400-407）填入该 Profile 的 defaultModel，仅此一个「候选」。

## 方案

模型输入支持两种模式并存，行为对齐字段目录（DEV-025）的既有交互习惯：

1. **下拉选择**：聚焦/点击模型输入框时调用 `ai:listModels({ profileId: 当前Profile })` 拉取候选，以下拉列表呈现；成功拉取后展示全部候选，当前值高亮。
2. **自由输入**：下拉仅是快捷方式，文本框保持可编辑，任意 id 均可保存（OpenAI 协议下模型列表不全/本地网关无列表是常态）。
3. **失败降级**：`ai:listModels` 失败（网络不可达、provider 不支持列表、空列表）时下拉静默不出现，只保留自由输入；在输入框下方以一行小字提示「无法获取模型列表，可直接输入模型 id」，不弹错误。
4. **提交节流 + 缓存**：候选拉取按 profileId 缓存（组件内 Map 或等价物），同一 Profile 不重复拉取，提供「刷新」入口清除缓存；文本编辑改为本地 state，onBlur / Enter / 下拉选中时才经 `ai:features:set` 提交，消除逐字符 IPC。
5. 交互细节自定，但不得引入新依赖；`data-testid="ai-feature-model-<key>"` 契约保留（smoke 依赖）。

## 验收标准

- [ ] 选中 Profile 后聚焦模型输入框，出现该 Profile 的模型候选下拉；点击候选项即选中并保存
- [ ] 下拉打开时仍可自由输入任意模型 id，失焦/回车保存后生效；逐字符输入期间不再每键触发 `ai:features:set`
- [ ] `ai:listModels` 失败或返回空列表时无下拉、无错误弹窗，自由输入路径完全可用，且有可理解的提示文案
- [ ] 同一 Profile 的候选列表有缓存，不随每次聚焦重复请求；可手动刷新
- [ ] 四个功能（写作/翻译/对话/embedding）行为一致；清除指定（X 按钮）行为不回归
- [ ] smoke 契约 `ai-feature-model-<key>` 不变；新增单测覆盖下拉渲染、选择写入、失败降级、缓存命中四条路径
- [ ] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿

## Out of scope

- Profile 创建向导（AiSetupWizard）内的模型输入改造
- main 进程 listModels 能力本身（已存在，若发现不可用属 DEV-009 回归，另报）
- 模型价格/上下文长度等元信息展示
