# DEV-091 分功能指定模型的候选列表与「编辑 AI Profile」读取结果对齐

- 状态：done（2026-09-28）
- 分类：bug
- 优先级：P1
- 工作量：S
- 范围：packages/renderer（主要）；packages/main / packages/shared（若需统一 `ai:listModels` 语义）
- Depends: DEV-075（分功能指定模型，已发布 v0.0.26，本票修其遗留缺陷）
- 来源：用户反馈 2026-09-22 / triage 2026-09-27

## 背景

用户在「设置 → AI」为某个功能指定模型时，选定供应商后下拉里的模型候选**明显缺项**，而同一个供应商在「编辑 AI Profile」里能读出的模型列表是完整的。两处入口读到的结果不一致，用户无法为功能选到实际可用的模型。

DEV-075 只是把「自由输入 + 已识别模型下拉」建起来，并没有保证两处候选**同源**。本票解决这个对齐问题。

## 现状（核实）

- **设置页分功能候选**：`ModelPicker`（`packages/renderer/src/features/ai/AiSettingsSection.tsx:437-522`）走 `ai:listModels` IPC，结果存进模块级 Map `MODEL_CANDIDATES_CACHE`（`:28`）。
  - 仅在聚焦且**无缓存**时拉取（`:489`）；只有「刷新」按钮清缓存（`:515`）。
  - **空数组也会被写成有效缓存**（`:36-37`），此后该 profile 的下拉就一直为空；只有请求抛错才删缓存（`:39-43`）。
  - 缓存 key 只有 `profileId`，不含 baseUrl / 凭据指纹；`ai:configChanged`、profile 保存、测试连接成功都不失效它（订阅点见 `packages/renderer/src/stores/ai-config.ts`）。
- **「编辑 AI Profile」**：`AiSetupWizard.tsx:175-189` 走的是 `ai:testConnection`，且传入的是**表单内实时 candidate**（`{kind, baseUrl, credentialToken, defaultModel}`），从 `result.models` 取值（`:189`）。向导还会展示候选总数与最多 12 个 chip（`:529-530,576-593`），设置页没有任何数量提示。
- **main 侧查询链路**：`ai:listModels` → `packages/main/src/ipc/ai-handlers.ts:51-53` → `ai-service.ts:301-303` → `targetAdapter()`（`:262-299`）→ `openai.ts:280-300`，是**实时** `GET /models`，**没有**静态内置目录、没有磁盘缓存、没有按 provider 过滤。设置页查的是**已保存 profile**（`ai-service.ts:295-297`），向导查的是**未保存的 candidate**（`:270-293`）。
- **结论：可复现，两个独立原因，均非"静态目录 vs 实时接口"**：
  1. 两处查询目标不同 —— 已保存 profile vs 表单内 candidate；baseUrl/凭据改动未保存时列表必然不同。
  2. 缓存永不失效且**缓存空结果** —— 一次成功但为空（或早期失败后的空态）会让设置页下拉长期缺失候选，而向导每次实时重拉所以是完整的。
- 附带差异（次要）：设置页用 `<datalist>` 前缀过滤，用户已输入某模型 id 时会隐藏其它候选；向导展示总数/芯片而设置页没有。

## 期望行为

1. **同一供应商在两处读到的候选完全一致**：分功能模型下拉与「编辑 AI Profile」的模型候选来自同一查询语义、同一数据源。
2. **缓存正确性**：空结果不得被当作有效缓存（下次聚焦/打开可重试）；缓存 key 至少包含 profile 标识 + 解析后的 baseUrl + 凭据指纹，配置变更（profile 保存、`ai:configChanged`、连接测试成功）时失效相关条目。
3. **未保存编辑不影响候选**：向导内改了 baseUrl/凭据但未保存时，用户选择的模型仍应可用；保存后设置页候选随之刷新（不残留旧缓存）。
4. 降级路径保持：请求失败时仍可自由输入模型名，不阻塞用户。

## 关键接口

- `ai:listModels` 的取值口径需统一：要么接受与 `ai:testConnection` 同形的 candidate 参数，要么在 main 侧提供一个"按 profile 或 candidate 解析目标"的统一查询函数，供两处复用。
- `MODEL_CANDIDATES_CACHE`（renderer）键值语义修正：缓存有效性的判定必须区分"已成功返回非空"与"失败/空"。
- 配置变更订阅点需补一次缓存失效。

## 验收标准

（2026-10-09 收口：`packages/renderer/tests/ai-model-candidates.test.tsx` 9 例全绿，逐条覆盖如下）

- [x] 同一 profile 下，设置页分功能模型下拉与「编辑 AI Profile」的候选集合一致（顺序可不同）——「同一 profile：设置页下拉候选 === 「编辑 AI Profile」读到的候选」
- [x] 一个返回空列表的供应商（或一次失败的拉取）不会被永久缓存；重新聚焦或点「刷新」能拿到最新结果——「空结果不写缓存」「一次空结果不会让下拉长期为空」
- [x] profile 的 baseUrl / 凭据保存后，设置页候选随之刷新，不展示旧 profile 的缓存——「缓存键含连接签名」「配置变更淘汰失效条目」
- [x] 请求失败时降级为自由输入，不报错、不卡死——「请求失败时降级为自由输入」
- [x] 新增单测覆盖：空结果缓存不得命中、配置变更后缓存失效、两处候选一致性
- [x] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿
- [ ] 向导内修改未保存的 baseUrl/凭据后，所选模型仍可保存并生效——**人工验收项**，无自动化覆盖

## Out of scope

- 引入静态内置模型目录或对模型做能力过滤（当前 provider 返回什么就展示什么）
- 修改 DEV-075 已定的「自由输入 + 下拉」双模式交互
- 模型列表的排序策略、分组、搜索
