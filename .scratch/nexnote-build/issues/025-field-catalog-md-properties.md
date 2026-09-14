# DEV-025 · 文档属性感知：字段目录与 Markdown 属性面板

Type: dev
Module: editor
Status: open
Blocked by: 无（可立即开始）
Depends: DEV-020（源码模式）
Effort: L
Priority: P1

## Scope

落实验收反馈「系统内置的文档字段没有适当体现，无法感知与使用」。已确认的两个缺口：①「添加字段」是自由文本输入框，7 个标准字段（title、tags、aliases、created、updated、type、confidence）不可见、无说明，用户填起来茫然；②`.md` 文档没有任何属性面板，只能手写 YAML 头。术语依据 [CONTEXT.md](../../../CONTEXT.md)「标准字段（Standard Field）」「文档属性（Document Properties）」「元数据头（Frontmatter）」。

### 交付内容

#### 1. 字段目录选择器

- 「添加字段」从自由文本输入改为弹出**字段目录**浮层：
  - 列出 7 个标准字段，各带类型徽标与一句话说明（如 confidence：「由 Git 提交历史计算的可信分数 · 数字」）。
  - 已存在的标准字段禁用并标「已添加」。
  - 浮层底部保留「自定义字段」自由命名入口。
- 字段行 hover 显示说明 tooltip（仅标准字段；说明文案集中一处定义，不做散落字符串）。
- 块编辑与 Markdown 文档共用该目录（同一 FieldEditor）。

#### 2. Markdown 文档属性面板

- 块文档与 format=markdown 文档统一在编辑器顶部状态栏提供轻量「属性」入口；面板默认关闭，点击后以顶部锚定、内部可滚动的 Popover 展开，不占据正文或 Markdown 实时预览的默认布局空间。
- Popover 内挂载 FrontmatterPanel（表格 / YAML 双模式，复用现有组件），提供与两种编辑模式一致的属性编辑体验；支持属性按钮再次点击、Escape 与点击外部关闭，关闭不撤销已进入现有防抖保存链的编辑。
- **YAML 头从 CodeMirror 正文中抽离**：无论 Popover 是否打开，Markdown 编辑框只含正文，YAML 由属性 Popover 承载；无 YAML 头的 `.md` 可经 Popover 新增字段并写回文件头。
- 面板未编辑时不得重排已有 YAML（**无编辑的打开 → 保存往返字节不变**，沿用 ADR-0004 保真语义；序列化仅发生在经面板实际编辑之后）。
- YAML 解析失败时锁定源码模式并保留原文（复用 FrontmatterPanel 既有 locked 行为）。
- 补一条 ADR-0004 修订记录：markdown 格式文档常驻属性面板、YAML 头抽离出源码编辑框（区别于块文档源码模式的临时原文查看语义）。

## 安全不变量（继承全局约束）

- renderer 不直访 Node `fs`，所有文件读写经既有 IPC 通道。
- secrets 不进日志与产物。
- 未真实运行的 GUI / 三平台 / 真实网络验收必须标 `NOT_RUN`，不得用单测或构建成功冒充。

## 验收标准

功能：

1. 「添加字段」打开字段目录：7 个标准字段全部可见、带类型与说明；已添加的禁用标「已添加」；底部可进自定义字段命名。
2. 字段行 hover 出现说明 tooltip，内容与目录一致。
3. 块文档与 `.md` 文档打开后默认只显示顶部状态栏「属性」入口，编辑区与实时预览使用完整可用空间；点击入口后出现顶部锚定、内部可滚动的属性 Popover，正文/预览布局尺寸不重排。
4. Popover 内可编辑标准字段与自定义字段并写回文件 YAML 头；无论 Popover 开关状态，CodeMirror 正文不显示 YAML 头。
5. 无 YAML 头的 `.md` 经 Popover 添加首个字段后，文件头正确生成。
6. 经 Popover 编辑 YAML 后切 YAML 源码模式、或解析失败锁定行为，与块文档一致；坏 YAML/无 YAML 仍可打开入口并遵循既有锁定/生成语义。
7. 块编辑文档与 Markdown 文档均使用统一「属性」命名和入口，右侧只读属性 dock 行为不回归。

保真：

7. 未编辑属性的面板下，`.md` 文档打开 → 保存往返文件字节不变（含 YAML 缩进、引号风格、CRLF/LF）。
8. 面板编辑仅重排被编辑字段所在的 YAML 头，不影响正文字节。

门禁（全部在候选 SHA 上执行并留证）：

9. `pnpm -r typecheck`
10. `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`（**单元测试全绿**；新增字段目录与 YAML 抽离/写回单测）
11. `pnpm lint`
12. `pnpm build`
13. `node scripts/verify-release-config.mjs`
14. `bash scripts/check-changed-format.sh master`
15. `git diff --check master...HEAD`
16. **Electron smoke e2e 全绿**，且新增覆盖：字段目录添加标准字段、`.md` 属性面板编辑写回、YAML 抽离后的正文视图、无编辑往返字节不变。

流程：

17. 在 `.wt/DEV-025` / `dev/DEV-025` 隔离实现，`master` 不直接编码。
18. 固定候选 SHA 上通过全新 Standards 与 Spec 双轴审查（无 blocker / major）后才 `git merge --no-ff`。
19. 合并后在 `master` 复跑门禁与 Electron smoke，并更新 README 与 checkpoint 登记。

## 关联决策

- [ADR-0004](../../../docs/adr/0004-source-mode-replaces-split-pane.md)（本票追加 markdown 文档属性面板修订）
- 术语定义：[CONTEXT.md](../../../CONTEXT.md) 标准字段 / 文档属性 / 元数据头（Frontmatter）/ 置信度
