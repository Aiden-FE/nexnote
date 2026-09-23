# DEV-077 created/updated 字段由应用维护：created 可改、updated 只读

- 状态：ready-for-agent
- 分类：enhancement
- 优先级：P1
- 工作量：M
- 范围：packages/kernel、packages/main、packages/renderer
- Depends: DEV-025（字段目录与属性面板）、DEV-079（先放宽标准字段删除）；与 DEV-078（展示）/080（移除 type）同改 FieldEditor，合并时注意 rebase
- 来源：用户反馈 2026-09-22
- 重审：triage 2026-09-22 —— 经核实现存写入路径，原稿「fs 写入服务层实现还是保存编排层实现」二选一定错了，必须显式禁止 fs-service 层加刷新（理由见关键接口 §4）

## 背景

`created` / `updated` 已列入 7 个标准字段（`STANDARD_FIELD_CATALOG`，`packages/kernel/src/frontmatter/model.ts:46-82`），字段目录可添加。但两者添加后就是普通可编辑字段：

- `updated` 不会随内容修改自动刷新，用户改与不改都很快过期，本质是假数据；
- 属性面板允许把 `updated` 随手改坏，而它本应是应用维护的「最近修改时间」；
- 用户也没有办法维护自己认可的 `created`（比如导入旧笔记时修正初始时间的场景）。

产品语义按用户反馈明确：**这两个字段添加后归 NexNote 维护；`updated` 用户不可修改；`created` 允许用户变更（修正初始值）但同样不由用户随意创造**。

## 当前已核实的写入路径

- **唯一 fs 写入 IPC**：`fs:writeTextFile` → handler `packages/main/src/ipc/fs-handlers.ts:26-28` → `services.fs.writeTextFile`（`packages/main/src/fs/fs-service.ts`，记录进 AppWriteTracker）。
- **编辑器入口（用户编辑）**：`packages/renderer/src/editor/source/page-source-io.ts:51` 的 `saveSourceText` —— 块编辑器（`EditorView.tsx:462-475`）和源码编辑器（`SourceModeView.tsx:133-141, 322`）共用这一编排；防抖调度器 `packages/kernel/src/save.ts`（默认 500ms）。做字节不变语义保护（`sameVersion` 检查）与 H1 改名重命名。
- **属性面板编辑路径**：`FrontmatterPanel`（`packages/renderer/src/features/frontmatter/FrontmatterPanel.tsx`）的 `onChange` / `onYamlChange`（300ms 防抖，lines 104-120）→ 调用方把新 frontmatter 拼进 markdown body → 仍走 `saveSourceText` → `fs:writeTextFile`。所以属性面板对 frontmatter 的编辑同样会经过 `saveSourceText`，**这条链路的内容变化也应当刷新 `updated`**。
- **`fs:writeTextFile` 还被非编辑器写调用**：`packages/renderer/src/features/editor/create-page.ts:7-25`（新建空文档）、`page-ops.ts:162`（renameWithLinks 改双链）。在这些路径上不应刷新 `updated` —— 见关键接口 §4。
- **page-ops 内的 frontmatter 原语**：当前只有 `setFrontmatterNumber`（`packages/main/src/fs/page-ops.ts:244-261`）。`packages/main/src/confidence/confidence-service.ts:239-241` 是它唯一的调用方，绕过 fs-service 直接 `fsp.writeFile`。
- **renderer-side YAML 头部替换工具**：`replaceFrontmatterYaml`（`packages/renderer/src/features/frontmatter/frontmatter-utils.ts:63-79`）做 byte-precise 的 frontmatter 头部替换；如需要在 renderer 端先更新 frontmatter 再交给 `saveSourceText`，可作为复用点。
- **新文档创建**：三个路径（`NewNoteMenu` → `createNoteIn` → `fs:createNote` → `createNote` page-ops.ts:60-86；command palette → `createPage` create-page.ts；`EditorView` lazy-create）目前**都不写 frontmatter**；本票要求新建自动写入 `created`。

## 期望行为

1. **updated 自动维护（写路径）**：文档经 `saveSourceText`（即用户编辑经由任一编辑器或属性面板修改并触发保存）的保存路径统一把 `updated` 刷新为当前时间；**仅当 markdown 正文或 frontmatter 内容确有变化时**才刷（字节不变语义保护，纯打开→未编辑→保存往返不触碰 `updated`，与 ADR-0004 一致）。无新增 IPC；刷新属于 `saveSourceText` 内部编排，不再散落到各调用方。
2. **updated 编辑锁定（读路径）**：属性面板/字段目录 UI 中 `updated` 行呈现为只读（禁用输入、不提供类型切换），带说明文案「由 NexNote 自动维护」。YAML 源码模式仍可看到原文——用户绕过 UI 直接改 YAML 属超纲行为，不做解析层阻止，但 UI 明确表达不可编辑。
3. **created 可变更**：`created` 保留日期编辑器（现有 datetime-local/date 输入），用户可修正；本票只定义 created/updated 的值可编辑性，字段删除统一遵循 DEV-079 的通用规则（即两者添加后也允许删除；删除 `updated` 后应用不再维护该字段——`saveSourceText` 在内容变化时刷新 `updated` 之前应检查文档是否仍有该键）。
4. **新文档初始化**：经应用新建文档时自动写入 `created`（当前时间）；`updated` 不随建随写（新建后首次实质编辑才刷，避免「创建即改」）。覆盖三个新建入口。
5. **兼容**：已存在 `updated` 为字符串/非 ISO 值的旧文档，首次经应用保存（且内容变化）时以应用时间覆盖（不做迁移脚本）。

## 关键接口

1. **kernel `STANDARD_FIELD_CATALOG`**：为每项引入 per-field 能力位（建议 `readonly: boolean`），替换现有 `standard ? 禁删` 的单一布尔逻辑；至少 `updated` 标 `readonly: true`。渲染层的 `FieldEditor` 据此禁用输入、隐藏类型切换按钮。`STANDARD_FIELD_CATALOG` 的字段顺序与序列化顺序数组同步更新（与 DEV-080 共改）。
2. **renderer `saveSourceText`（page-source-io.ts）扩展**：在写盘前判定内容变化（已有 `sameVersion` + baseText 比较的现成可复用模式可参考 `classifyExternalChange`），仅在有变化时把 markdown body 中的 frontmatter 头 `updated` 改为当前 ISO 时间，复用 `replaceFrontmatterYaml` + `serializeField`/解析-改-序列化三步走（也可借 `setFrontmatterNumber` 思路做个 `setFrontmatterDate`）。需在 `saveSourceText` 内部新增一个轻量 helper（建议名 `stampUpdated`），被 `saveSourceText` 调用一次；写入前 baseVersion 保护与 H1 改名逻辑不变。**
3. **属性面板的字段锁定渲染**：`FieldEditor` 接收 `STANDARD_FIELD_CATALOG` 的 per-field 能力位，对 `readonly: true` 字段渲染只读视图（值 + 文案），不进入编辑态；双击重命名仍按 DEV-079 规则（标准字段不可重命名）。
4. **`fs-service.writeTextFile` 与 `fs:writeTextFile` IPC 层禁止挂 `updated` 刷新**——它们也被 `create-page`、`renameWithLinks` 调用，在那里刷新会把"创建新页"、"重命名链接重写"也算成"用户编辑"，污染语义。如确实需要在 main 侧有 frontmatter 时间戳能力，应另起一个只走 `saveSourceText` 链路的 helper，不复用 `fs:writeTextFile`。**这是硬约束。**
5. **新建文档入口**：在 `createNote`（page-ops.ts:60-86）和 `createPage`（create-page.ts:7-25）两处写入文件后，调用 `replaceFrontmatterYaml` 把 `created` 时间戳注入（仅 `created`，不写 `updated`）。`EditorView` 的 lazy-create 走 `createPage` 路径，同样复用。
6. **ADR-0004 修订记录**：append 一条 revision 笔记，明示 updated 自动维护与字节不变语义的边界——frontmatter 头会因 `updated` 变化而重写，正文不变 + frontmatter 头不变 仍保持字节不变；content 与 frontmatter 任一变化都触发 `updated` 刷新。

## 验收标准

- [ ] 编辑器（块 / 源码）正文改字、保存 → YAML 中 `updated` 刷新为保存时间；`created` 不被改动
- [ ] 属性面板里改任意 frontmatter 字段（value / type / rename / add / remove），保存 → `updated` 同样刷新
- [ ] 打开文档不做任何编辑 → 关闭/保存，文件字节不变（含 `updated`）；基于 `replaceFrontmatterYaml` + 当前 ISO 时间的来回序列化在无 frontmatter 变化时是 noop
- [ ] 属性面板中 `updated` 行只读且有「由 NexNote 维护」类说明；`created` 可正常编辑；删除 `updated` 后，下次编辑保存不再尝试刷新该键
- [ ] 新建文档三个入口都自动带 `created`（ISO 时间），不带 `updated`
- [ ] `fs-service.writeTextFile` / `fs:writeTextFile` IPC 链路不被任何 `updated` 刷新逻辑污染（非编辑器写路径文件字节不变）
- [ ] 单元测试覆盖：内容变化刷新、无变化不刷、`updated` 缺失不抛错、属性面板编辑同样刷新、新建只写 `created`、重命名链接重写不动 `updated`
- [ ] `pnpm typecheck` / `pnpm lint` / 全量 Vitest / `pnpm build` 全绿

## Out of scope

- 文件系统 mtime 读取/回填历史文档
- `type` 字段的移除（归 DEV-080）
- 字段删除能力放开（归 DEV-079，但本票依赖它先落地）
- created/updated 的可读展示（归 DEV-078）
- 非 frontmatter 场景（docx sidecar 元数据）