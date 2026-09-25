# DEV-080 移除文档属性 type 标准字段（类型由文档本身派生）

- 状态：done（v0.0.26）
- 分类：enhancement
- 优先级：P1
- 工作量：S
- 范围：packages/kernel、packages/renderer
- Depends: DEV-025（字段目录与属性面板）；与 DEV-077/079 同改 frontmatter 模块与 FieldEditor；DEV-079 须先落地（先放开标准字段删除，本票才能干净移除目录项）
- 来源：用户反馈 2026-09-22
- 重审：triage 2026-09-22 —— 现状已核对，标准字段顺序数组确认在 `packages/kernel/src/frontmatter/model.ts:315`，且与 `STANDARD_FIELD_CATALOG` 重复——本票可顺手合并单一来源

## 背景

`type` 是 7 个标准字段之一（`packages/kernel/src/frontmatter/model.ts:73-76`，说明文案为「文档类型（如 note、chat）：区分普通笔记与会话页面」），用户可在属性面板自由增删改。产品反馈：**类型跟随当前文档，不是用户可编辑内容**。代码核查确认它已没有任何系统读取点：

- AI 会话不再以 Markdown 页面存在——会话存储已迁移为内部 JSONL（ADR-0007，`.nexnote/sessions/{sha256}.txt`，`packages/main/src/chat/chat-service.ts:10-16` + `chat-format.ts:4`），不存在 `type: chat` 的页面需要识别；
- 文档格式由文件扩展名派生：`formatForPath`（`packages/main/src/document/document-domain.ts:58-65`，用 `path.extname`）；`.md` 实际取自 `.nexnote` sidecar metadata（`native-block` vs `markdown`，`page-tree-store.ts:114-121`），其它扩展名按扩展名。`tab.format` 在 tab-store 与编辑器中流通，不读 frontmatter.type；
- 全仓唯一消费点是右侧只读 `PropertiesPanel` 把 `getString(data, 'type')` 显示在「类型」行（`PropertiesPanel.tsx:54-56`），缺省显示「普通文档」。

即 `type` 现在是一个既可伪造、又不驱动任何行为、还误导用户的字段。

## 期望行为

1. **从标准字段目录移除 `type`**：`STANDARD_FIELD_CATALOG` 删除该项；字段目录（DEV-025 浮层）不再展示它，用户无法再添加。**已添加的存量 `type` 字段**经属性面板编辑保存时自然脱落（见第 4 点）。
2. **序列化顺序单一来源**：`serializeFrontmatterYaml` 内硬编码的标准字段顺序数组（`packages/kernel/src/frontmatter/model.ts:315` 的 `standardOrder`）移除 'type'，**且该数组改为由 `STANDARD_FIELD_CATALOG` 派生**——目前两个数组顺序重复，保留单一一份即可。
3. **展示改为派生值**：右侧 PropertiesPanel「类型」行不再读 frontmatter，改为展示当前文档的真实派生类型（如「块文档」「Markdown 源码」「DOCX」「XLSX」「思维导图」之类）。建议扩展 `formatForPath` / 在 `PropertiesPanel` 的 props 上新增 `format: DocumentFormat` 字段（参考 `tab.format`）。用户可读名映射在 renderer 一处集中维护，便于未来扩展新格式（DEV-074 系列）。
4. **存量处理**：已写入文件的 `type: ...` 不做批量迁移脚本；当用户经属性面板编辑/保存时该键不被重新写回即可（若它仍在原文 YAML 中，遵循 ADR-0004「未编辑不重排」保留原字节；一旦发生 frontmatter 编辑再序列化则自然脱落——本票不强制在无编辑时删除）。
5. 引用 type 的相关测试/断言一并更新（field-catalog、frontmatter 序列化等）。
6. **PropertiesPanel 必须能拿到当前 format**：当前 `PropertiesPanelProps` 只有 markdown/data/filePath/linkCounts/confidence（lines 9-16），没有 format；要么加 props，要么用 tab 上下文（参考 `tab.format` 的流通路径）。

## 关键接口

- kernel `STANDARD_FIELD_CATALOG`：移除 type 项；`isStandardField('type')` 之后返回 false。
- kernel `serializeFrontmatterYaml`：标准顺序数组移除 'type'，并把该数组改为从 `STANDARD_FIELD_CATALOG` 派生（消除两处顺序的双源）。
- renderer `PropertiesPanel`：类型行的数据来源由 frontmatter 改为 tab/文档格式；该面板需能拿到当前 format（经 props 或既有 tab 上下文）。
- 新增映射 `formatLabel(format: DocumentFormat): string`（建议放在 renderer 共用工具模块，集中所有 format → 用户可读名）。

## 验收标准

- [x] 字段目录不再出现 type，无法添加为标准字段
- [x] 右侧属性面板「类型」展示由文档格式派生的只读值（如「块文档」「Markdown」「DOCX」等），而非用户编辑值
- [x] frontmatter 序列化输出不再主动包含 type；无编辑往返字节不变的保真语义不被破坏
- [x] 全仓无对 frontmatter.type 的逻辑读取残留（`getString(data, 'type')` 调用点清零）
- [x] `STANDARD_FIELD_CATALOG` 与序列化顺序数组单一来源（不再两处分别维护）
- [x] 更新后的单测全绿；`pnpm typecheck` / `pnpm lint` / 相关 Vitest 通过

## Out of scope

- 文档格式派生机制本身的改造
- 批量清洗存量文件中的 type 键
- 新文档类型（如 DEV-074 的 xlsx/mindmap）的类型命名体系——只要求映射可扩展