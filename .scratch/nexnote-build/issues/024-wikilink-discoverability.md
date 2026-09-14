# DEV-024 · 双链可发现性：Markdown 源码 `[[` 补全与反向链接角标

Type: dev
Module: editor
Status: open
Blocked by: 无（可立即开始）
Depends: DEV-020（源码模式）
Effort: M
Priority: P1

## Scope

落实验收反馈「块文档、md 文档的双链功能隐藏较深无法感知」。现状：插入双链仅块编辑模式有 `[[` 补全；Markdown 源码模式打 `[[` 无补全（只能在实时预览里点击已有链接）；反向链接面板是侧栏第 3 个标签页，需手动点开才知道有没有。本票交付两个发现性入口，**不做**打开文档时自动切换面板（避免打断用户对页面树的占用）。

### 交付内容

#### 1. Markdown 源码模式 `[[` 自动补全

- CodeMirror 中输入 `[[` 触发页面名补全，候选来自 Link Index（与块编辑 `[[` 补全同一数据源），支持模糊过滤、键盘上下选择、回车确认、Esc 关闭。
- 支持未创建页面的「红链」候选，回车后创建页面（复用块编辑红链创建路径，落盘并出现在页面树）。
- 补全语法与块编辑一致：`[[页面名]]`、`[[页面名|别名]]`；实时预览中插入的双链可点击导航（既有能力，不回归）。

#### 2. 反向链接面板计数角标

- 侧栏「反向链接」面板标签图标显示当前激活文档的反链计数角标；计数为 0 时不显示角标。
- 数据随激活 tab 切换实时更新（复用 `index:backlinks` 既有数据流）；角标数字与面板列表条目数一致。
- 不改变面板默认选择（页面树仍为默认面板）。

## 安全不变量（继承全局约束）

- renderer 不直访 Node `fs`，所有文件读写经既有 IPC 通道。
- secrets 不进日志与产物。
- 未真实运行的 GUI / 三平台 / 真实网络验收必须标 `NOT_RUN`，不得用单测或构建成功冒充。

## 验收标准

功能：

1. `.md` 文档源码模式输入 `[[` 弹出页面名候选；选择已存在页面插入正确双链；选择红链回车创建页面并在页面树出现。
2. `|别名` 语法在补全确认后生成正确。
3. 块编辑模式 `[[` 补全不回归。
4. 打开有反链的文档，「反向链接」面板图标出现计数角标且与面板列表一致；无反链文档不显示角标；切换 tab 角标跟随更新。
5. 侧栏默认面板仍为页面树，无自动切换行为。

门禁（全部在候选 SHA 上执行并留证）：

6. `pnpm -r typecheck`
7. `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`（**单元测试全绿**；新增补全源与角标数据流单测）
8. `pnpm lint`
9. `pnpm build`
10. `node scripts/verify-release-config.mjs`
11. `bash scripts/check-changed-format.sh master`
12. `git diff --check master...HEAD`
13. **Electron smoke e2e 全绿**，且新增覆盖：md 源码 `[[` 补全与红链创建、反链角标显示与切换。

流程：

14. 在 `.wt/DEV-024` / `dev/DEV-024` 隔离实现，`master` 不直接编码。
15. 固定候选 SHA 上通过全新 Standards 与 Spec 双轴审查（无 blocker / major）后才 `git merge --no-ff`。
16. 合并后在 `master` 复跑门禁与 Electron smoke，并更新 README 与 checkpoint 登记。

## 关联决策

- 术语定义：[CONTEXT.md](../../../CONTEXT.md) 双链 / 反向链接面板 / 关系索引
- 相邻改动：DEV-023（源码 bubble 双链按钮可触发本票补全，但两票无硬阻塞依赖）
