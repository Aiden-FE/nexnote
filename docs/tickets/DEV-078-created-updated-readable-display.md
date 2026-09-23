# DEV-078 created/updated 面板内可读时间展示（存储格式不变）

- 状态：ready-for-agent
- 分类：enhancement
- 优先级：P2
- 工作量：S
- 范围：packages/kernel（展示纯函数）、packages/renderer
- Depends: 独立可合入；建议在 DEV-077 之后实施（语义对齐）；不接受独立
- 来源：用户反馈 2026-09-22
- 重审：triage 2026-09-22 —— 现状核实，行号补齐；展示纯函数签名钉死，禁止 renderer 散写 toLocaleString

## 背景

created/updated 在 frontmatter 中以 ISO-8601 存储（如 `2026-09-22T01:23:45.000Z`，`serializeField` 用 `Date.toISOString()`，`packages/kernel/src/frontmatter/model.ts:348-350`）。产品要求**存储格式保持不变**（机器可读、跨时区明确），但用户在文档属性各展示位看到的应该是人类可读的 `年-月-日 时:分:秒`，现状：

- **属性表格编辑器**（`packages/renderer/src/features/frontmatter/FieldEditor.tsx:402-417`）：Date 值计算 `iso = value.toISOString()`，`hasTime = !iso.endsWith('T00:00:00.000Z')`，input `type={hasTime ? 'datetime-local' : 'date'}`，`inputValue = iso.slice(0,16)` 或 `iso.slice(0,10)` —— 渲染的是 UTC ISO 片段，没有按本地时区格式化。
- **右侧只读 PropertiesPanel**（`packages/renderer/src/features/frontmatter/PropertiesPanel.tsx:126-133`）：时间区直接渲染 `stats.created`/`stats.updated`（`font-mono` 文本）。
- **`pageStatistics`**（`packages/renderer/src/features/frontmatter/frontmatter-utils.ts:171-194`）：created/updated 输出 `data.created.toISOString()` 或 raw 字符串。
- **FrontmatterValueDisplay**（`PropertiesPanel.tsx:168-172`）：Date 值渲染 `<span className="font-mono...">{value.toISOString()}</span>`。
- **getString**（`packages/kernel/src/frontmatter/model.ts:401`）：Date → toISOString 字符串。

## 期望行为

1. **新增统一展示纯函数**（kernel frontmatter 层）：把 `Date | string | null | undefined` 格式化为本地时区下的 `YYYY-MM-DD HH:mm:ss`；无法解析时原样回退，不抛错。时区按应用运行的本地时区（与产品当前「本地优先、单机使用」定位一致；不做时区选择器）。
   - 函数名：`formatDisplayDateTime(value: Date | string | null | undefined): string`
   - 边界：`null` / `undefined` / 空串 → 返回 `''`（让调用方决定回退文案）；解析失败 → 返回 `String(value)`；Date → 用 `Intl.DateTimeFormat` 或手工 `getFullYear/getMonth/getDate/getHours/getMinutes/getSeconds` 并左补零。
2. 各展示位统一调用该函数：
   - `PropertiesPanel` 时间区（read-only）
   - `FrontmatterValueDisplay` Date 分支
   - `FieldEditor` 日期行的展示态：编辑控件聚焦时保留 datetime-local；失焦展示可读串；或在控件旁展示可读值（具体交互由 agent 决定，但用户应能看到可读时间）。
   - `pageStatistics`：created/updated 的展示值改为走该函数（或由调用处格式化，类型保持 string）。
3. **存储与序列化零改动**：写入文件的仍是 ISO（含毫秒/Z），本票纯展示；YAML 源码模式显示原文。
4. 字符串型 created/updated（非 Date）先尝试解析，失败则原样显示。
5. **禁止**：renderer 各组件内不再有 `toLocaleString` / `toISOString` 用于展示的目的；展示统一走 `formatDisplayDateTime`。ESLint 自定义规则（可选）。

## 关键接口

- kernel 新增 `formatDisplayDateTime`，放在 frontmatter 模型/工具模块并从 kernel 包导出。
- `pageStatistics` 内部直接调用该函数（不必暴露到类型上）。
- renderer 只读展示组件改为消费该函数；不直接 import `Intl.DateTimeFormat`。

## 验收标准

- [ ] 属性面板各展示位的 created/updated 显示为 `YYYY-MM-DD HH:mm:ss`（本地时区），不再出现裸 ISO 或 `font-mono` 的 UTC 串
- [ ] 文件中存储的 created/updated 仍为 ISO 格式，序列化与往返字节语义不变（DEV-077 落地后，`updated` 自动维护路径同样不改格式）
- [ ] 无法解析的字符串值原样展示，不报错；空值显示 `—` 或等价回退
- [ ] 纯函数有单测：UTC→本地换算、日期与时间分量、非法输入回退、null/undefined
- [ ] `pnpm typecheck` / `pnpm lint` / 相关 Vitest 全绿

## Out of scope

- 相对时间（「3 小时前」）展示
- 时区配置或多时区支持
- updated 自动维护逻辑（归 DEV-077）