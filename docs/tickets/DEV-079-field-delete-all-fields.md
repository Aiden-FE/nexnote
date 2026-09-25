# DEV-079 文档属性各字段添加后允许删除（含标准字段）

- 状态：done（v0.0.26）
- 分类：enhancement
- 优先级：P1
- 工作量：S
- 范围：packages/kernel、packages/renderer
- Depends: DEV-025（字段目录与属性面板）；本票**前置**于 DEV-077（updated 缺失后不再维护）、DEV-080（type 移除后该目录项不再存在）；建议作为该组第一张先行落地
- 来源：用户反馈 2026-09-22
- 重审：triage 2026-09-22 —— 现状核实（FieldEditor.remove 的硬编码早返、FieldRow 删除按钮 disabled、tooltip 全部对得上），无方案改动；强化交互细节与目录回退路径

## 当前行为

`FieldEditor`（`packages/renderer/src/features/frontmatter/FieldEditor.tsx`）：
- `remove(key)` 在 `isStandardField(key)` 时直接 return（lines 75-80）；
- `FieldRow` 删除按钮对标准字段 `disabled`（lines 289-303），图标替换为 `MoreHorizontal`「…」，tooltip 为「标准字段不可删除」（line 300）。

字段目录（DEV-025 浮层）可以把 7 个标准字段逐个加进文档，但加错/不再需要时无法移除，只能手写 YAML 删行，与「字段可感知、可操作」的目标矛盾。

其它相关硬约束（不应被本票回归）：
- `onRename` 对标准字段禁用（lines 82-88）
- 双击重命名对标准字段禁用（lines 249, 276-281）
- 字段目录的「已添加」态：标准字段添加后，在目录中处于「已添加」禁用态；删除后需能恢复可添加

## 期望行为

1. **所有字段都可删除**：移除 `remove` 中对标准字段的保护，标准字段与自定义字段删除行为一致——从 frontmatter 数据中移除该键并走既有保存链路写回（`FrontmatterPanel.onChange` → 上层 `saveSourceText` → `fs:writeTextFile`）。
2. **删除走确认**：标准字段删除时给轻量确认（如「删除标准字段 updated？删除后该属性不再由 NexNote 维护」之类的文案，避免误删；自定义字段维持直接删除。确认走 Popover / Dialog 一致复用既有组件；不要每次都弹系统 confirm）。
3. **删除后字段目录恢复可添加**：字段目录（DEV-025 浮层）的「已添加」禁用态由"该 key 已在数据里"决定，删除后该键从数据中消失，目录项自然恢复可点击。
4. **不破坏既有交互**：`onRename` 对标准字段的限制保持不变（标准字段不可重命名）；折叠、类型切换等保持不变。
5. **级联注意事项**：DEV-077 的 `updated` 自动维护在文档数据中无 `updated` 键时应当**静默跳过**（不创建该键，不抛错）；这是本票落地后 DEV-077 的预期对接。本票不需要为 DEV-077 留接口，但单测要覆盖"删除 `updated` 后再编辑正文，文件不新增 `updated`"——此断言由 DEV-077 验收，本票只确保删除接口可用。

## 关键接口

- kernel：可不动；`isStandardField` / `STANDARD_FIELD_CATALOG` 仍是「是否标准字段」的判定，本票不引入新能力位。如未来需区分「标准且禁止重命名」「标准且禁止删除」，可加 `removable?: boolean` 字段，默认 true——但本票不强制做（removable 默认 true 与「全部可删」等价）。
- renderer `FieldEditor.remove`：去掉 `isStandardField` 硬编码的禁用分支（lines 75-80）。
- renderer `FieldRow` 删除按钮：恢复为统一的可点击 trash 图标（line 302）；`disabled` 计算改由"是否处于编辑中"等其它状态决定，与「是否标准字段」解耦。
- 字段目录（DEV-025 浮层）：无需修改，本票落地后该目录的「已添加」态由 frontmatter 数据真实状态驱动。
- 渲染层删除确认：新增一个轻量 inline 确认组件（建议命名为 `ConfirmRemoveFieldRow` 或复用现有 `Popover`），与现有 UI 风格一致。

## 验收标准

- [x] 7 个标准字段与自定义字段添加后均能通过删除按钮移除并写回文件
- [x] 标准字段删除有确认提示（文案带「由 NexNote 维护」等语义差异），自定义字段直接删除
- [x] 删除后字段目录对应项恢复可添加（不再显示「已添加」禁用态）
- [x] 删除字段不影响其他字段与正文；YAML 序列化结果中该键消失
- [x] 标准字段仍不可重命名；折叠/类型切换等既有交互不回归
- [x] 单测覆盖：标准字段删除、删除后目录状态、删除后保存往返、删除 `updated` 后文件不再出现该键
- [x] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿

## Out of scope

- updated 自动维护与只读（归 DEV-077；本票落地后该功能才能正常工作）
- type 字段从目录移除（归 DEV-080）
- 批量删除/字段排序
- 重命名权限的进一步细分（removable / renamable 等能力位是可选改进，不强制本票做）