# DEV-093 confidence 由系统计算：属性面板只读展示

- 状态：done（2026-09-28）
- 分类：bug
- 优先级：P1
- 工作量：S
- 范围：packages/kernel（字段目录 readonly 标记）
- Depends: DEV-077（readonly 标准字段机制，已发布 v0.0.26）、DEV-008（confidence 引擎）
- 来源：用户反馈 2026-09-22 / triage 2026-09-27

## 背景

`confidence` 是系统按 Git 提交历史计算出的可信分数（0-100），由应用内部写入 frontmatter，用户不应在文档属性里手动编辑它。当前属性表格里它渲染成一个可编辑的数字输入框，用户可以随手改掉这个派生值，导致展示口径与引擎计算结果不一致。

## 现状（核实）

- 字段目录定义：`STANDARD_FIELD_CATALOG` 中 `confidence`（`packages/kernel/src/frontmatter/model.ts:78-82`）为 `type:'number'`，描述"由 Git 提交历史计算的可信分数（0-100）"，**没有 `readonly` 标记 → 当前可编辑**。对照同一文件 `updated`（`:72-77`）已设 `readonly: true`。
- 计算与写入：`computeConfidenceResults()`（`packages/main/src/confidence/confidence-service.ts:113-169`）计算；`ConfidenceService.syncFrontmatter()`（`:231-247`）在 `config.features.confidenceFrontmatter` 开启时经 `setFrontmatterNumber(current,'confidence',result.score)`（`:239`）写回文件。
- 展示：renderer 通过 `useConfidence`（`packages/renderer/src/features/frontmatter/use-confidence.ts:6-33`）只读展示在 `PropertiesPanel` 的「置信度」区（`PropertiesPanel.tsx:128-131,216-258`）。
- 可编辑性判定：`FieldRow`（`packages/renderer/src/features/frontmatter/FieldEditor.tsx:224-346`）里 `const readonly = isReadonlyStandardField(name)`（`:227`）。readonly 时渲染 `data-testid="frontmatter-readonly-<name>"` + `readonlyDisplayValue(value)` + "由 NexNote 自动维护"（`:334-338`）；否则进 `ValueEditor`，number 分支是 `<Input type="number">`（`:431-441`）。**`confidence` 没有 readonly 标记，所以当前落入可编辑数字框。**
- 机制已就绪：`StandardFieldDef.readonly`（`model.ts:35-45`）+ `isReadonlyStandardField()`（`:103-107`，从 `packages/kernel/src/index.ts:31` 导出），是 DEV-077 建立的标准"派生字段"通道；`readonlyDisplayValue`（`FieldEditor.tsx:348-354`）已能处理 number。

## 期望行为

1. `confidence` 视为**派生/系统字段**：在属性表格中以只读形式展示，样式与 `updated` 一致（只读文本 + "由 NexNote 自动维护"）。
2. 只读展示走统一的可读路径，不再出现可编辑的数字输入框。
3. 目录里 `confidence` 的描述继续说明其来源（Git 提交历史），让用户理解为何不可编辑。
4. 不改变引擎计算与写回逻辑；不改变 PropertiesPanel 已有的「置信度」只读区。

## 关键接口

- `STANDARD_FIELD_CATALOG` 的 `confidence` 项补 `readonly: true`，复用 `isReadonlyStandardField()` 判定——不新增机制。
- 若属性面板需要额外的说明文案，走 `STANDARD_DESCRIPTIONS`（`FieldEditor.tsx:24`），不散写常量。

## 验收标准

（2026-10-09 回填：`field-catalog.test.tsx` 与 `frontmatter.test.ts` 覆盖，相关套件全绿）

- [x] 属性表格中 `confidence` 渲染为只读（存在 `data-testid="frontmatter-readonly-confidence"`），无可编辑输入框——field-catalog「confidence 走只读分支，无可编辑输入框」
- [x] 只读值为数字文本，空值回退 `—`——field-catalog「confidence 空值回退 —」
- [x] `updated` 的只读行为不回归——同用例断言 updated 只读且无 input
- [x] 引擎仍按 `confidenceFrontmatter` 开关写回 `confidence`，计算结果不变——frontmatter.test.ts / properties-confidence.test.tsx 覆盖
- [x] 新增/更新单测：`isReadonlyStandardField('confidence') === true`，且 FieldEditor 对 confidence 走只读分支
- [x] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿

## Out of scope

- confidence 的计算算法与权重（归 DEV-008）
- 在属性面板新增置信度明细/解释 UI（归现有 PropertiesPanel 置信度区）
- 其他标准字段的 readonly 策略调整
