# DEV-021 · 用户文案统一「知识库」并删除文件浏览占位页

Type: dev
Module: shell
Status: closed
Blocked by: 无（可立即开始）
Depends: 无
Effort: M
Priority: P1

## Scope

落实两条验收反馈：①「Vault 文件」术语用户不可读；②文件浏览页残留 DEV-001 演示文案。依据 [CONTEXT.md](../../../CONTEXT.md) 术语「知识库（Vault）」：**用户可见文案统一「知识库」，不直接使用英文 vault**；代码层标识符（IPC channel 名、store 字段、类型名、testid）保留 Vault 不动。

### 交付内容

#### 1. 术语清理（用户可见文案零 vault）

- 「Vault 文件」相关 5 处（文件浏览页标题、欢迎页按钮与 tab 标题、⌘K「打开 Vault 文件浏览」命令）随占位页删除（见下）。
- 小写 vault 混排中文约 14 处，逐面清理：
  - 设置页：「恢复上次 vault / 打开特定 vault」选项、Git 分区「每 vault 可单独设置」、空态「未打开 vault…」、默认分支名「新建 vault 时使用」、数据说明「保存在本地 vault 目录中」。
  - 首启向导：「创建一个空的本地 vault」「选择已有文件夹作为 vault」「检测到 Obsidian vault」——Obsidian 作为产品专有名词可保留，但应表述为「Obsidian 知识库（.obsidian 目录）」。
  - Git：版本时间线「vault 内相对文件路径」、同步诊断「尚未打开任何 vault」。
  - 主进程 VaultError 错误消息（经向导错误框展示给用户）：「vault 路径必须是绝对路径」等。
- 原则：面向用户的字符串输出（含错误消息、诊断解释、空态、tab 标题、toast）一律「知识库」；`.obsidian` / `.nexnote` 等目录名与技术名词保留。

#### 2. 删除文件浏览占位页

- FilesPage（DEV-001 占位页，含「数据来自主进程 fs:listDir（IPC）」「页面树、右键菜单、新建/重命名/删除/移动等完整文件操作在 DEV-003 实现；本页仅验证 IPC 文件链路与沙箱」演示文案）整体删除。
- 删除 `'files'` TabKind：tab-store 类型与 openWorkspaceTab 分支、SplitView 渲染分支、⌘K `tab.files` 命令、欢迎页「浏览 Vault 文件」按钮（**不加替代按钮**，页面树常驻侧栏）。
- 布局持久化兼容：旧配置残留 `kind: 'files'` 的 tab 在恢复时安全丢弃，不报错、不产生空白 tab。
- smoke 断言更新：以「Vault 文件」tab 为锚的既有用例改锚页面树或其他入口。

## 安全不变量（继承全局约束）

- renderer 不直访 Node `fs`，所有文件读写经既有 IPC 通道。
- secrets 不进日志与产物。
- 未真实运行的 GUI / 三平台 / 真实网络验收必须标 `NOT_RUN`，不得用单测或构建成功冒充。

## 验收标准

功能：

1. 用户可见文案（renderer 全部 JSX 文案、toast、空态、tab 标题、命令面板条目，及经 UI 展示的主进程错误/诊断消息）不含 vault / Vault 字样；代码标识符（IPC channel、store 字段、类型名、testid、注释）不要求改动。
2. 同一界面不再出现「知识库 / vault」双叫法。
3. 代码库无 FilesPage、`'files'` TabKind、`tab.files` 命令残留。
4. 欢迎页无「浏览 Vault 文件」按钮，⌘K 无对应命令；侧栏页面树的文件浏览不受影响。
5. 含 `kind: 'files'` 旧 tab 的布局恢复不崩溃，该 tab 被静默丢弃。

门禁（全部在候选 SHA 上执行并留证）：

6. `pnpm -r typecheck`
7. `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`（**单元测试全绿**）
8. `pnpm lint`
9. `pnpm build`
10. `node scripts/verify-release-config.mjs`
11. `bash scripts/check-changed-format.sh master`
12. `git diff --check master...HEAD`
13. **Electron smoke e2e 全绿**，且更新后用例覆盖：欢迎页无占位按钮、⌘K 无该命令、旧布局含 files tab 的恢复路径。

流程：

14. 在 `.wt/DEV-021` / `dev/DEV-021` 隔离实现，`master` 不直接编码。
15. 固定候选 SHA 上通过全新 Standards 与 Spec 双轴审查（无 blocker / major）后才 `git merge --no-ff`。
16. 合并后在 `master` 复跑门禁与 Electron smoke，并更新 README 与 checkpoint 登记。

## 关联决策

- 术语定义：[CONTEXT.md](../../../CONTEXT.md)「知识库（Vault）」（avoid 含「vault（用户可见文案中直接使用英文）」）
- 占位页的替代者：DEV-003 页面树（已合并）
