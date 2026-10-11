---
status: in_progress
---

# 桌面端界面双语：共享消息目录 + 跨进程错误码化

应用在设置中已有 `appearance.language`（`'zh-CN' | 'en-US'`，默认 `zh-CN`，可持久化），但它是一个**假开关**：唯一消费点是设置 `<html lang>`、AI 翻译的目标语言推断与翻译兜底映射，切到 English 后界面文案零变化。这构成对用户的误导。决定实现真正的桌面端界面双语（简体中文 + 英文）。

规模事实：renderer 98 个文件 1,153 处 / 870 条不同文案，main 48 个文件 610 处 / 503 条，合计约 146 个文件、1,763 处字面量；47–58 个 renderer 测试文件与 10 个 main 测试文件断言中文文案。文案形态规整（绝大多数是命令/设置注册表中的字符串字面量，JSX 内联文本仅 74 行），基础 UI 组件不带文本、文案由调用方 props 传入，因此这是**大型机械变更**而非架构重构；但有三处不可回避的架构决策。

决定采用**自研轻量消息目录**（语义 key + `zh-CN` / `en-US` 两份词典，`zh-CN` 为兜底），不引入 i18next 等运行时框架——与官网和应用既有的轻依赖取向一致，且抽取本身是机械的。三处架构决策：

1. **跨进程错误码化**：主进程当前把中文错误消息直接拼进 `Result.err`，经 IPC 由渲染层 `IpcError` 抛出并原样上屏（`ipc/validation.ts` 一文件即有 79 处）。改为主进程返回**错误码 + 参数**，渲染层查词典成文；主进程自身保留一份词典用于原生菜单、对话框与更新器提示。
2. **主进程持有同一套词典**：原生菜单（`Menu.buildFromTemplate`，自定义 label 全为硬编码中文）、`showOpenDialog` / `showMessageBox` 文案、Git 诊断与更新器消息都需要随语言切换重建或重取。Electron `role` 菜单项由系统本地化，不在范围内。
3. **双语索引**：设置搜索索引（`SEARCH_ENTRIES` 36 条 title 全中文）与命令 keywords 影响可发现性，双语后设定为**按当前界面语言索引 + 保留中英关键词互通**，避免英文界面下搜不到命令。

首次启动按系统语言初始化界面语言（`zh*` → `zh-CN`，其余 → `en-US`），用户可在设置中覆盖并持久化。

## Considered Options

- **i18next / react-i18next**：成熟但引入运行时与两套心智，而本项目的文案形态是可直接静态抽取的注册表；否决，保留轻依赖。
- **继续只在渲染层翻译，主进程维持中文**：会让 en-US 用户在原生菜单、系统对话框与错误提示上继续看到中文，等于保留半个假开关；否决。
- **主进程不上错误码、改为主进程按 locale 拼消息**：主进程需感知运行期语言切换并广播，状态同步复杂度高于错误码化；否决，错误码化让「消息成为数据」。
- **隐藏语言选择器直到双语完成**：不解决缺陷，只是把误导换成功能缺失；否决。

## Consequences

- 交付是分阶段的（① 消息目录与设置真生效 → ② renderer 分模块迁移 → ③ main 错误码化与菜单/对话框 → ④ 测试改为词典断言），但**完成门槛唯一**：切到 en-US 后全 UI（含错误消息、原生菜单、对话框）无中文残留；未达门槛不得声称双语完成。
- 插件 API 允许第三方注册任意 `title` / `keywords`，插件侧文案不由应用统一翻译，属既定边界，需在文档中说明。
- 用户可见文案确定「以词典为唯一真相」后，任何在组件里直接写中文都会被后续门禁视为回归；需要一条可执行的残留检查（例如对渲染文本做 CJK 正则扫描）作为验收手段。
- 这是一次大范围机械变更，`git blame` 会大量指向本轮；评审以「是否只改文案形态、不改行为」为标准。
- AI system prompt 属模型指令而非界面文案，本轮不随界面语言变化，其语言策略是独立议题。

## Progress（2026-10-09）

- 阶段①消息目录：`packages/shared/src/i18n/message-catalog.ts` 提供语义 key +
  `zh-CN` / `en-US` 两份词典（当前各 181 key，逐 key 对齐）与 `translate()`
  （zh-CN 兜底、key 缺失回退 key 本身、`{param}` 占位符替换）；
  renderer 新增 `lib/i18n.ts`（`setLanguage` / `t()` / `useI18n`，
  基于 `useSyncExternalStore`），设置语言变化经 `use-settings-effects` 驱动。
- 首次启动按系统语言：`SettingsService` 按 `app.getPreferredSystemLanguages()`
  推导初始语言（`zh*` → `zh-CN`，其余 → `en-US`），仅在无设置文件时生效；
  既有设置值不被覆盖。
- 阶段②第一批：设置页页面标题、搜索框与结果态、全部设置分区导航标题、
  常规分区的外观/启动/帮助子项与翻译默认语言行迁移到消息目录。
- `NOT_RUN` / 未达门槛：阶段②其余 renderer 模块、阶段③主进程错误码化与
  原生菜单/对话框、阶段④既有测试断言均未完成。按本 ADR 完成门槛
  「切到 en-US 后全 UI 无中文残留」，当前不得声称桌面端双语完成。
- 阶段②第二批：欢迎页、命令面板**骨架**（占位符/空态/提示；命令条目本身仍为中文，未迁移）、
  状态栏（主题/索引）、首启动向导、侧栏框架、Dock 框架（头部/折叠/空态）
  与四个内置侧栏面板的**标题**（面板内部文案仍为中文，未迁移）迁移到消息目录；
  侧栏/dock 注册表新增显式 `titleIsKey`（插件贡献标题保持既定不翻译边界）。
- 可执行残留检查：`desktop-i18n-migrated-modules.test.tsx` 对已迁移模块做**真实渲染**
  （含 store → bootstrap effect、输入事件 → query 更新链路），在 en-US 下对已迁移
  子树做 CJK 扫描；未迁移子树（命令条目、面板内部）显式排除并在票据登记。
- 门禁：`pnpm lint` 0；`pnpm typecheck` 5/5；`pnpm test` 1823 passed / 3 skipped。
- 阶段②第三批：命令面板的**全部命令条目与分类**迁移到消息目录
  （`features/commands/builtin.ts`、`features/search/commands.ts`、`features/ai/index.tsx`
  共 33 个命令 + 9 个分类），命令面板渲染与检索均经 `t()` 成文；检索按
  ADR-0023 架构决策③保留中英关键词互通，英文界面下仍能搜到中文命令名。
  顺带迁移图谱 tab 标题与「检查更新」弹窗文案。
- 阶段②第四批：编辑器与外围高频界面迁移——查找栏、块菜单、补全建议、标题折叠、
  悬浮目录、工具栏溢出菜单、源码模式（保存状态/外部修改冲突/模式切换/加载失败）、
  快捷插入与实时预览错误、链接与图片提示；侧栏四面板内部文案、页面树右键菜单与
  状态区、新建菜单、标签条、引导浮层、克隆向导步骤、二进制与占位页。
- 可执行残留检查（二）：`message-catalog.test.ts` 扫描 renderer 源码中经
  `t()` / `tr()` / `translate()` 引用的 key，断言两份词典均存在——缺 key 时
  `translate()` 会回退成 key 文本（界面上直接显示 key），而 tsc 不会报错。
- 阶段②剩余（已登记，未完成）：编辑器工具栏动作目录
  `EDITOR_ACTION_CATALOG`（跨 shared/kernel/renderer 单一事实源，571 行）、
  标题转换禁用原因、AI 对话面板、Git 面板内容、frontmatter 属性面板。
- 阶段②第六批（2026-10-10）：标题转换禁用原因改为语言中性消息 key，涵盖
  编辑器未就绪、跨复杂结构选区、不安全 Markdown 上下文、列表/引用与只读视图；
  块编辑与源码模式工具栏在交互时按当前语言成文。本批新增 5 个 key，消息目录
  zh/en 各 484 个 key。
- 阶段②第五批（2026-10-10）：`EDITOR_ACTION_CATALOG` 从静态 `name` / `hint`
  迁移到语言无关的 `nameKey` / `hintKey`；快捷插入分组改为 `basic` / `insert` /
  `ai` / `plugin` 语义 key，并用 `quickInsertGroupName()` 成文。shared 现有
  zh/en 各 479 个 key，且两份词典逐 key 对齐；本批新增 97 个 key。
  kernel 块编辑 slash 菜单、renderer 源码 slash 菜单、顶部工具栏动作、AI 写作
  slash 子项、内置 Mermaid/公式项与媒体插入项均按当前语言成文；插件贡献标题 /
  hint 保留原文（`titleText` / `hintText` 边界）。命令式 kernel UI 通过共享
  当前语言单例在语言切换后重建或重渲染时更新。
- 可执行残留检查（三）：`slash-actions.test.ts` 断言 `EDITOR_ACTION_CATALOG`
  全部动作名 / hint key、快捷插入分组 key 在 zh/en 均可见，且 en-US 词典无中文。
- 门禁：shared / kernel / renderer tsc 通过；`pnpm lint` 0；
  `pnpm test` 193 files / 1824 passed / 3 skipped 退出码 0。
- 第六批门禁：shared / kernel / renderer tsc 通过；`pnpm lint` 0；
  `pnpm test` 193 files / 1825 passed / 3 skipped 退出码 0。
- 阶段②第七批（2026-10-10）：AI 写作 diff 浮层（状态、错误、关闭/停止/接受/拒绝）
  与划词工具栏停止控件迁移；写作动作名补充消息目录 key。会话错误与截断提示保持
  上游消息原文边界，本应用按钮/状态成文。新增 16 key，消息目录 zh/en 各 500 key。
  `writing-layer.test.tsx` 新增 en-US 渲染残留检查（服务/模型消息显式除外）；
  门禁 193 files / 1826 passed / 3 skipped。
- 阶段②第八批（2026-10-10）：Git 状态栏、同步进度、时间线、远程设置、
  同步诊断弹窗与恢复预览迁移；冲突 hover 改为按当前语言组装，Agent 结构化
  prompt / chip 文本与主进程诊断文案保留原文边界。新增 68 key，消息目录
  zh/en 各 567 key；`git-status-item.test.tsx` 新增状态栏与时间线 en-US
  残留检查，门禁 193 files / 1827 passed / 3 skipped。
- 阶段②第九批（2026-10-10）：AI 对话面板迁移完成，包括历史、权限、导出、
  空态、插入、发送/停止、会话状态、Agent 审批与执行横幅；上下文 chips、
  召回来源与 Skill 选择器一并迁移。会话错误 / 上下文块 / 会话标题 /
  Skill 名称保留 runtime 或插件内容边界。新增 73 key，消息目录 zh/en 各 640 key。
  `chat-approval.test.tsx` 新增 en-US ChatDock 空态残留检查；门禁
  193 files / 1828 passed / 3 skipped。
- 阶段②第十批（2026-10-10）：frontmatter 属性面板迁移完成，包括右侧 Dock
  空态、属性行、格式标签、置信度空态、字段目录、标准字段说明、字段行、
  值编辑器、表格/YAML 切换与源码锁定提示。字段名 / 字段值 / YAML 解析错误 /
  置信度因子明细保留数据或服务消息边界；kernel `STANDARD_FIELD_CATALOG`
  的中文 description 保留为领域定义，UI 经 `frontmatter.field.<key>.description`
  词典成文。新增 85 key，消息目录 zh/en 各 725 key。
  `properties-confidence` / `field-catalog` / `source-mode-markdown-panel`
  新增 en-US 渲染残留检查；门禁 193 files / 1831 passed / 3 skipped。
- 阶段②第十一批 / 纠偏批（2026-10-10）：复核发现 `settings/index.tsx` 的
  网络、编辑器、Git、快捷键与关于分区仍是中文硬编码；本批补齐。运行时错误
  消息保留 IPC 原文边界。新增 77 key，消息目录 zh/en 各 855 key。
  `settings-ui.test.tsx` 新增 en-US 下五个核心分区渲染残留检查；门禁
  195 files / 1836 passed / 3 skipped。
- 阶段②第十二批（2026-10-10）：全局知识图谱、全文搜索面板、标签搜索结果
  与 Skill 设置页迁移。Skill 名称、描述与 IPC 错误保留内容 / 服务消息边界。
  新增 26 key，消息目录 zh/en 各 881 key；门禁 195 files / 1836 passed / 3 skipped。
- 阶段②第十三批（2026-10-10）：插件设置页与插件权限弹窗迁移；插件名、
  运行时审计明细和 IPC 错误保留服务内容边界。命令分类 `插件` 改为消息 key。
  新增 37 key，消息目录 zh/en 各 918 key。`plugin-host.test.tsx` 新增 en-US
  扩展点分类残留检查；门禁 195 files / 1837 passed / 3 skipped。
- 阶段③第一批（2026-10-10）：主进程接入 shared 当前语言权威；原生菜单四组
  自定义条目、目录/文件选择、二进制保存失败对话框和快捷键导入/导出对话框
  迁移，界面语言切换时重建原生菜单。新增 16 key，消息目录 zh/en 各 741 key。
  新增 `window-menu.test.ts` 锁定 zh/en 菜单模板与菜单动作；门禁
  195 files / 1833 passed / 3 skipped。updater / Git / doctor 消息仍在阶段③
  剩余批次处理。
- 阶段③第二批（2026-10-10）：自动更新状态消息与更新设置界面迁移，包括检查、
  可用、下载、确认、安装、通道切换、开发模式禁用和 Mac 手动下载提示。主进程
  `message` 为应用自有状态文案；adapter / IPC 原始错误保留上游文本边界。
  新增 37 key，消息目录 zh/en 各 778 key。`updater.test.ts` 锁定 en-US 状态
  成文，`settings-ui.test.tsx` 锁定更新界面 en-US 渲染无 CJK 残留；门禁
  195 files / 1835 passed / 3 skipped。
- 阶段②第十四批（2026-10-10）：AI 供应商设置分区与配置向导迁移，覆盖 Profile
  列表、连通状态、导入导出提示、分功能指定、模型候选控件、向导步骤、供应商
  预设、连接字段、连通测试结果和模型参数。Profile 名称、模型名、Base URL 与
  服务端 / IPC 错误保留数据或上游消息边界；`chat` / `streaming` /
  `embeddings` / `tools` 能力徽标改用独立语义 key，不再复用功能标签或显示
  原始枚举；导入跳过列表的分隔符与测试按钮加载态也改用应用自有 key。
  新增 107 key，消息目录 zh/en 各 1025 key。
  新增 `ai-settings-i18n.test.tsx`，在 en-US 下真实渲染设置分区与向导，
  锁定核心文案、能力徽标、加载/导入分隔符并做 CJK 残留检查；门禁
  195 files / 1840 passed / 3 skipped 退出码 0。
- 阶段③第三批（2026-10-10）：Git 同步 doctor 服务状态错误码化成文。已知
  `issue.code` / `GitSyncDoctorError.code` / 修复动作 / 人工指引 / 规则解释
  迁移到 shared 词典，主进程 `tCurrent()` 按当前语言成文；renderer 对稳定
  doctor 错误与 issue code 按词典还原，未知 code 保留服务脱敏原文边界。
  AI 解释 prompt 与模型输出、Profile / 模型 / 路径类数据不翻译。新增 50 key，
  消息目录 zh/en 各 1075 key。`git-sync-doctor` 新增 en-US 语言权威测试，
  `git-status-item` 新增 en-US doctor 对话框词典成文与未知 code 回退测试；
  门禁 195 files / 1842 passed / 3 skipped 退出码 0。
- 阶段③第四批（2026-10-10）：vault 生命周期与 clone 校验服务消息错误码化。
  覆盖新建/打开/克隆路径校验、名称校验、Git 初始化要求、clone 一次性票据、
  取消/未找到操作与无 vault 状态；安全路径校验拒绝原因继续保留绝对路径等
  数据参数，凭据仍经 `sanitizeRemoteText`。新增 `VaultErrorCode`，目录内
  新增 26 key，zh/en 各 1101 key。`vault-manager` / IPC registrar /
  doctor / catalog targeted tests 通过；门禁 195 files / 1842 passed /
  3 skipped 退出码 0。
- 阶段④第十三批（2026-10-11）：内置块 NodeView、翻译超限与对话运行时
  错误文案双语收敛。
  `features/plugins/builtin/node-views.ts` 是框架无关 DOM NodeView，此前完全
  脱离 React，因此「像 i18n」的通知机制对它无效——8 处 Mermaid / LaTeX
  提示语、渲染中占位、错误文案与 title 全部硬编码中文。现改用命令式
  `t()`（NodeView 在用户交互时构造 DOM，每次求值都读取当前语言）。
  翻译 controller 的两处超限错误改走 `translation.overLimitSource`
  （`{count}` 复用 `TRANSLATION_MAX_TEXT_CHARS`，不再写死 "200,000" 字面量）。
  对话运行时的三条上屏文案改走词典：自动保存失败 `chat.error.autoSaveFailed`、
  打开失败会话 `chat.error.lastTurnFailed`，以及空内容首条消息的默认标题——
  最后一处复用了主进程 `chat-service` 早已在用的 `chat.default.title`，
  消除跨进程同一语义的重复硬编码。
  共删除 13 行含 CJK 字面量（12 个唯一字符串，其中翻译超限错误在划词与
  全文两个路径重复出现）；新增 11 key（8 个 `builtinBlock.*` +
  1 个 `translation.overLimitSource` + 2 个 `chat.error.*`），zh/en 各
  1612 key、零差集。
  NodeView 不是 React 组件，且实例会在语言切换后继续存活；两个工厂均
  订阅 `subscribeLanguage`，已挂载块在切语言时立即重算 hint / title /
  loading / error 文案（渲染成功的 SVG / KaTeX 输出不受影响），destroy 时
  反订阅并递增 renderSeq，令已发出的异步渲染失效，不得再写 detached DOM。
  测试：`builtin-nodeviews` 新增 en-US 真实挂载断言（编辑提示、LaTeX
  title、块级 hint 且无 CJK）与「先挂载、后切语言」断言；
  新增 `builtin-nodeviews-i18n-states` 用 mock 渲染库锁定 Mermaid /
  LaTeX 的 loading / error 状态随语言重算、上游错误原文保留、销毁后
  late resolve 不写 DOM；`ephemeral-translation` 新增超限错误 en-US 精确
  断言；`chat-flow` 的 bridge 新增 `failSave` 分支并断言自动保存失败文案。
  三条路径均用「回退三个实现即失败」的变异测试证明断言有效。
  门禁：四套 tsc 通过、`pnpm lint` 0、197 files / 1890 passed /
  3 skipped 退出码 0。
- 阶段④第十四批（2026-10-11）：插件 UI 框架文案、贡献标题契约与心跳超时
  错误码化双语收敛。
  设置页签标题属于应用 UI chrome，不再误用插件或持久化 title 数据：
  `TabStrip` 为 settings 页签统一改读 `tabs.settings`，en-US 真实渲染测试
  锁定 tooltip 无 CJK。插件右键父级菜单由硬编码「插件」改为
  `plugins.menu.title`；插件块插入模板改为 `plugins.blockCommand.title`，
  并新增 `CommandDef.titleParams`、`PluginBlockCommandDef.titleText` 以及
  slash 菜单 `titleParams`，命令面板和富文本 / 源码 slash 菜单都只把插件
  贡献标题作为模板参数，绝不翻译插件内容。
  heartbeat 超时不再把中文句子持久化进插件 `lastError` / 审计 detail；
  `plugins:reportCrash` 新增可选 `error` 字段并在 IPC 校验器中限制为已知
  app code；`PluginSandboxFrame` 为 heartbeat 同时发送带命名空间的 message
  与 `error`，主进程优先持久化 `error`，`PluginsSettingsPage` 展示时映射
  `plugins.error.PLUGIN_HEARTBEAT_TIMEOUT`；第三方崩溃不带 code，原始
  字符串继续保留原文。
  新增 4 key（`tabs.settings`、`plugins.menu.title`、
  `plugins.blockCommand.title`、`plugins.error.PLUGIN_HEARTBEAT_TIMEOUT`），
  zh/en 各 1617 key、零差集。新增 `plugins-settings-page` en-US 真实渲染
  测试：稳定 heartbeat code 在 last error 与审计明细成文，第三方 `boom`
  保持原文；`plugin-host` 用 fake timers 锁定 heartbeat 持久化
  `error=PLUGIN_HEARTBEAT_TIMEOUT`，并单独锁定非 heartbeat 转发串不带 code。
  门禁：四套 tsc 通过、`pnpm lint` 0、204 files /
  1921 passed / 3 skipped 退出码 0。
- 阶段③第五批（2026-10-10）：DOCX 导入/导出服务状态与旧版打开提示迁移。
  DocxService 应用自有校验/写入/导出错误按 code 对应词典成文；底层 ZIP /
  XML / 上游解压细节与路径数据保留原文边界。新增 10 key，zh/en 各 1111 key。
  `open-document` 新增 en-US notice 测试；`docx-service` / catalog targeted
  tests 通过；全量门禁 195 files / 1843 passed / 3 skipped 退出码 0
  （`list-dev069` 曾出现退出进程后的 ProseMirror DOM timer unhandled error，
  单独重跑通过，全量重跑干净退出 0）。
- 阶段③第六批（2026-10-10）：GitService 用户可见操作状态与安全校验错误
  迁移。覆盖初始化、手动提交、rebase/merge 中止与保留、冲突自动收敛、
  远程保存/pull/push/sync 进度与结果、clone / restore / sync guard 校验；
  Git commit message、用户文件路径、远端原始错误与凭据脱敏文本保留边界，
  remote action 只作为稳定词典分段。新增 59 key，zh/en 各 1170 key。
  `git-service` / catalog targeted tests 通过；门禁 195 files /
  1843 passed / 3 skipped 退出码 0。
- 阶段③第七批（2026-10-10）：VaultFsService / page-ops / fs IPC 错误码化成文。
  覆盖沙箱路径校验、读写/目录/重命名/删除失败、新建笔记与 Git 自动提交摘要；
  相对路径、文件名、底层 fs 错误与 Git/commit 摘要参数保留边界。新增 28 key，
  zh/en 各 1198 key。`fs-service` / `page-ops` / IPC registrar /
  rename-index / catalog targeted tests 通过；门禁 195 files /
  1843 passed / 3 skipped 退出码 0。
- 阶段③第八批（2026-10-10）：indexer / index IPC 无 vault 状态与置信度设置
  自动提交摘要成文。服务数据、搜索内容和索引错误保留边界。新增 1 key，
  zh/en 各 1199 key。index / confidence / IPC registrar / catalog targeted
  tests 通过；门禁 195 files / 1843 passed / 3 skipped 退出码 0。
- 阶段③第九批（2026-10-10）：retrieval 向量降级状态迁移；阶段统计 note 按当前
  语言成文，错误原文与召回来源保留边界。新增 1 key，zh/en 各 1200 key。
  retrieval / bug-bash / e2e / catalog targeted tests 通过；全量门禁
  195 files / 1843 passed / 3 skipped 退出码 0。
- 阶段③第十批（2026-10-10）：AI service / OpenAI provider 校验、状态映射、
  流式终止与 embedding 结果错误成文。供应商 HTTP body、模型响应、模型/Profile
  名称和上游网络细节保留边界；只保留状态与静态提示。新增 28 key，
  zh/en 各 1228 key。`ai-service` / `ai-openai-adapter` / local embedding /
  catalog targeted tests 通过；门禁 195 files / 1843 passed / 3 skipped
  退出码 0。
- 阶段③第十一批（2026-10-10）：AI store Profile / assignment 校验错误成文；
  Profile 名、模型名、Base URL 和导入 skipped 名称保留数据边界。新增 5 key，
  zh/en 各 1233 key。`ai-store` / `ai-service` / catalog targeted tests 通过；
  门禁 195 files / 1843 passed / 3 skipped 退出码 0。
- 阶段③第十二批（2026-10-10）：PluginService 安装票据 / 生命周期 / RPC / 授权
  服务错误成文；插件名、贡献标题、manifest 内容、RPC 输入与审计明细保留
  插件数据边界。新增 20 key，zh/en 各 1253 key。`plugin-service` /
  catalog targeted tests 通过；门禁 195 files / 1843 passed / 3 skipped
  退出码 0。
- 阶段③第十三批（2026-10-10）：插件安装预检、安全 ZIP 解析与授权会话错误
  成文。覆盖 manifest / entry / staging / artifact 校验、ZIP 安全限制、
  session nonce / token / challenge 校验；插件 manifest 内容、入口路径、
  上游压缩异常和审计明细保留边界。新增 29 key，zh/en 各 1282 key。
  `plugin-service` 新增 en-US intake / auth 语言测试；门禁 195 files /
  1844 passed / 3 skipped 退出码 0。
- 阶段③第十四批（2026-10-10）：插件 manifest 校验框架文案成文。覆盖必填字段、
  semver、反向域名 ID、相对入口、权限、贡献点、Skill 与宿主兼容性；插件声明
  的权限标识和内容字段保留边界。新增 13 key，zh/en 各 1295 key。
  `plugin-service` 新增 en-US manifest 校验测试；门禁 195 files /
  1845 passed / 3 skipped 退出码 0。
- 阶段③第十五批（2026-10-10）：settings IPC 无 vault 与快捷键导入/导出文件
  IO 错误复用 shared 成文；导入 JSON 结构校验保持无错误文案的宽容降级语义。
  新增 2 key，zh/en 各 1297 key。settings IPC / service / catalog targeted
  tests 通过；门禁 195 files / 1845 passed / 3 skipped 退出码 0。
- 阶段③第十六批（2026-10-10）：Agent gateway 应用自有运行错误与审批摘要
  成文。覆盖 translation payload / Skill service / Skill retrieval / 工具授权、
  会话作用域护栏、对话 / full 权限模式与审批拒绝；AI system prompt、工具
  description、模型输出和 Doctor action 标识保留边界。新增 15 key，
  zh/en 各 1312 key。`agent-gateway-e2e` / `agent-tool-loop` /
  `agent-runtime-blockers` / translation / catalog targeted tests 通过；
  门禁 195 files / 1846 passed / 3 skipped 退出码 0。
- 阶段③第十七批（2026-10-10）：Agent builtin tools / ToolRegistry / Skill IPC
  的用户可读校验与拒绝错误成文；工具 description 仍作为模型指令保留边界。
  覆盖检索、选区编辑、追加、Doctor 动作审批、工具注册/查找/写禁用和 Skill
  服务缺失。新增 13 key，zh/en 各 1325 key。agent runtime / loop / e2e /
  IPC registrar / catalog targeted tests 通过；全量门禁 195 files /
  1846 passed / 3 skipped 退出码 0。
- 阶段③第十八批（2026-10-10）：置信度引擎因子标签、明细解释与 frontmatter
  同步自动提交摘要成文；因子 key、分数、Git 数据和页面内容保留边界。此前
  “factor label/detail 是服务数据边界”的口径已被本批取代。新增 13 key，
  zh/en 各 1338 key。`confidence-service` 新增 en-US 语言权威测试；
  confidence / PropertiesPanel / catalog targeted tests 通过；全量门禁
  195 files / 1847 passed / 3 skipped 退出码 0。
- 阶段③第十九批（2026-10-10）：binary service / binary IPC 服务状态与校验
  错误成文。覆盖 xlsx / mindmap 类型校验、读取失败、导入 base64 / 尺寸校验、
  乐观锁冲突、xmind 数据校验、rebase 保存阻塞、文件对话框过滤名与自动提交
  摘要；二进制文档名 / 路径 / 底层 ZIP-XML 解析错误保留边界。新增 17 key，
  zh/en 各 1355 key。binary xlsx / xmind / create / payload / mindmap IPC /
  catalog targeted tests 通过；全量门禁 195 files / 1847 passed / 3 skipped
  退出码 0。
- 阶段③第二十批（2026-10-10）：Chat session 服务与 Skill service / Skill IPC
  校验错误成文。覆盖会话路径 / id / 损坏校验、默认标题、导出文件名冲突和
  Skill 查找 / 服务缺失；会话标题、用户正文、Skill 名称和插件内容保留边界。
  新增 9 key，zh/en 各 1364 key。chat / chat-format / skill / IPC registrar /
  catalog targeted tests 通过；全量门禁 195 files / 1847 passed /
  3 skipped 退出码 0。
- 阶段③第二十一批（2026-10-10）：preload 桥、IPC registrar 与 document
  service / metadata store 的用户可读契约错误成文。覆盖未知 IPC/event 通道、
  内部错误、重复注册、文档格式直写拒绝、路径越界与 metadata 读取失败；
  通道名、文档路径和 IPC 数据载荷保留边界。新增 8 key，zh/en 各 1372 key。
  document-domain / IPC registrar / catalog targeted tests 通过；类型检查和
  lint 通过；全量门禁 195 files / 1848 passed / 3 skipped 退出码 0。
- 阶段③第二十二批（2026-10-10）：IPC validation 框架与全部 payload 校验
  错误成文。覆盖基础字段类型、对象/未知字段、DOCX/binary/base64、布局、
  Agent chat/writing/translation、chat save、plugin/object 与更新通道校验；
  校验 code 不变，检索关键词数组保持数据边界。新增 67 key，zh/en 各 1439
  key。IPC registrar / translation / agent runtime / mindmap / settings /
  catalog targeted tests（120 passed）通过；全量门禁 195 files /
  1848 passed / 3 skipped 退出码 0。
- 阶段③第二十三批（2026-10-10）：建立主进程残留**棘轮门禁**并收敛漏网错误。
  `main-i18n-residue.test.ts` 剥离行/块注释后扫描 `main/src`，以
  `fixtures/main-i18n-residue.json` 冻结只减不增基线，每条残留必须带保留理由
  （AI prompt / 工具 description / 上游 ZIP-XML 错误 / Git commit message /
  开发日志 / 数据标签 / 插件 manifest / 搜索关键词 / mock fixture / 语言分支）。
  同时迁移 Git doctor 已知 code 的中文 fallback（未知 code 保留脱敏运行时消息）、
  本地 embedding 不支持对话/未知模型、secret store 不可用与 legacy blob、
  binary host ack 超时（消息会进入关窗错误对话框 detail）、retrieval 服务不可用、
  DOCX 对话框过滤名与大小限制、git IPC 无 vault / doctor 未初始化、
  更新通道切换与 Mac 手动下载、vault 绝对路径校验、插件审计明细。
  补齐 xlsx / xmind 解析错误与 docx zip / XML 损坏的稳定 code 成文，
  并把 binary 只读保留区标签由中文文本改为稳定枚举
  （`MACRO` / `CHART` / `PIVOT_TABLE` / `BORDER_OR_RELATION`），由 binary-host
  渲染端按当前语言成文。错误 code 与行为保持不变。新增 35 key，
  zh/en 各 1474 key；基线从 171 条收敛至 134 条（10 类保留边界，逐条带理由）。
  doctor / secret / local-embedding / updater / IPC registrar / docx / binary /
  catalog targeted tests 通过；全量门禁 196 files / 1855 passed /
  3 skipped 退出码 0。
- 阶段③第二十四批（2026-10-10）：完成 binary-host 独立 WebContentsView 宿主双语，
  并修复跨视图语言权威同步。宿主加载页、丢弃本地修改 confirm、保存/冲突/外部修改/
  加载失败状态、思维导图工具栏/抽屉、结构/主题/标记/形状枚举全部走 shared catalog；
  structures / themes / markers / shapes 目录改为语言无关 key（`binary.structure.*`、
  `binary.theme.*`、`binary.icon.*`、`binary.drawer.*`），渲染端用 `useI18n()` 成文。
  因 binary-host 是独立 renderer 进程、不共享主窗口 renderer 内存，`BinaryEditorCommand`
  新增 `language` 命令：host ack 的 pull 响应首命令总是携带主进程当前语言，设置语言变化
  时由 `BinaryEditorHostManager.applyLanguage()` 广播；`session.ts` 收到后调用
  `setCurrentLanguage`。残留门禁扩展为 main/src 棘轮 + binary-host 源码剥离注释后
  CJK 必须为 0。新增 77 key，zh/en 各 1551 key；binary editor host / binary-host session /
  mindmap editor UI / catalog targeted tests 通过；全量门禁 196 files /
  1861 passed / 3 skipped 退出码 0。
- 阶段④第一批（2026-10-11）：修正一处阶段③漏网的标题折叠 aria-live 反馈
  （`use-heading-fold-announcement.ts` 原为硬编码中文），新增
  `heading.foldsExpanded` / `heading.noFoldedHeadings` 词典 key；
  `expand-all` 测试改为 shared 词典断言并补 en-US 反馈分支，`new-note-menu`
  测试补 en-US 渲染断言与 CJK 残留检查。测试断言不再绑定硬编码英文文本，
  而是从 `translate(CATALOGS[language], …)` 取预期。新增 2 key，zh/en 各 1553 key；
  expand-all / new-note-menu / catalog targeted tests 通过；全量门禁 196 files /
  1863 passed / 3 skipped 退出码 0。
- 阶段④第二批（2026-10-11）：OutlinePanel、内置命令注册表与新手引导测试迁移。
  OutlinePanel 空态/展开控件改为词典断言并补 en-US CJK 检查；内置命令测试
  覆盖所有命令的 en-US 标题与分类；GuidedTour 文案契约从仅中文扩展为 zh/en
  双语言，并新增 en-US 真实卡片渲染断言。本批只改测试，不新增消息 key，
  zh/en 保持 1553 key；OutlinePanel / commands-builtin / guided-tour
  targeted tests 通过；全量门禁 196 files / 1866 passed / 3 skipped 退出码 0。
- 阶段④第三批（2026-10-11）：欢迎页、页面树与页内查找栏测试迁移。WelcomePage
  整页 en-US 渲染断言覆盖标题、副标题、按钮、三个能力要点与能力总结行，并检查
  CJK 残留；页面树测试只迁移控件（折叠 aria-label、右键重命名菜单项），中文
  文件/目录名继续作为内容数据，不纳入 UI 文案边界；EditorFindBar 测试覆盖 en-US
  search role、输入标签/占位符、无结果、上一/下一匹配与关闭按钮。本批只改测试，
  不新增消息 key，zh/en 保持 1553 key；welcome-page / page-tree-ui / editor-find
  targeted tests 通过；全量门禁 196 files / 1869 passed / 3 skipped 退出码 0。
- 阶段④第四批（2026-10-11）：DOCX 打开提示与二进制标签关闭失败测试迁移。
  `open-document` 的 en-US 提示断言从硬编码英文改为词典取值并加 CJK 检查；
  `binary-tab-close` 补全 `binary.saveError` / `binary.editorLoading` 的词典
  精确断言，并新增 en-US 的「标签被保留 + 错误成文 + 加载态」完整用例；
  同时在 afterEach 统一卸载 React root，修复用例间残留组件触发的 act 竞态。
  本批只改测试，不新增消息 key，zh/en 保持 1553 key；open-document /
  binary-tab-close targeted tests 通过；全量门禁 196 files /
  1870 passed / 3 skipped 退出码 0。
- 阶段④第五批（2026-10-11）：Git 同步状态机与 Tab 关闭可访问名测试迁移。
  `git-sync-progress` 的 `initialPhaseMessage` / `conflictHoverText` 断言从中文
  片段改为 `git.progress.*` / `git.conflict.*` 词典取值（含 `{count}` 截断后缀），
  并新增 en-US 覆盖四个阶段与三种 hover 形态；`tabstrip-title-tooltip` 的关闭
  按钮 aria-label 改为 `tabs.closeWithTitle` 词典断言，并新增 en-US 用例锁定
  `tabs.tablistLabel` / `tabs.newTab` 与关闭名模板片段——关闭名拼接用户标题，
  属于内容数据，因此只断言 UI 模板片段无 CJK。本批只改测试，不新增消息 key，
  zh/en 保持 1553 key；git-sync-progress / tabstrip-title-tooltip targeted
  tests 通过；全量门禁 196 files / 1872 passed / 3 skipped 退出码 0。
- 阶段④第六批（2026-10-11）：召回透明 UI 与源码快捷插入菜单测试迁移。
  `retrieval-sources` 的来源计数/模型徽标/三阶段名/相似度/置信度/降级徽标断言
  改为词典取值，并新增 en-US 降级渲染断言；来源标题与 snippet 仍作为内容数据。
  `source-slash-menu` 的列表 aria-label 与分组标题改为词典断言，并新增 en-US
  渲染断言（菜单文本无 CJK）。本批只改测试，不新增消息 key，zh/en 保持
  1553 key；retrieval-sources / source-slash-menu targeted tests 通过；
  全量门禁 196 files / 1874 passed / 3 skipped 退出码 0。
- 阶段④第七批（2026-10-11）：编辑器工具栏动作模型与菜单文案测试迁移。
  `editor-toolbar-entries` 的动作标签断言从硬编码中文改为
  `editorActionCatalogEntry().nameKey` / `toolbar.heading.pageTitle` /
  `toolbar.heading.disabled.complexSelection` 词典取值，并新增 en-US 真实渲染
  断言（常驻动作 aria-label、格式菜单项文案、工具栏整体无 CJK）；页面标题与
  文件名继续作为内容数据。本批只改测试，不新增消息 key，zh/en 保持 1553 key；
  editor-toolbar-entries targeted tests 通过；全量门禁 196 files /
  1875 passed / 3 skipped 退出码 0。
- 阶段④第八批（2026-10-11）：反向链接角标 title 测试迁移。
  `backlinks-badge` 的计数角标改为 `sidebar.backlinks.badge` 词典断言，
  并新增 en-US 真实渲染断言（tooltip 无 CJK）；反链来源标题与 snippet 继续
  作为内容数据。本批只改测试，不新增消息 key，zh/en 保持 1553 key；
  backlinks-badge targeted tests 通过；全量门禁 196 files /
  1876 passed / 3 skipped 退出码 0。
- 阶段④第九批（2026-10-11）：划词工具栏与工具栏溢出测试迁移，并修正
  「英文界面仍使用中文全角括号」的真实缺陷。新增 `common.withParenthetical`
  词典模板（zh `{text}（{detail}）` / en `{text} ({detail})`），kernel
  `bubbleTooltipText` / 禁用按钮 aria-label 与 renderer `EditorToolbar`
  Tooltip / 菜单项 aria-label 均改走模板；`source-selection-bubble` 将粗体、
  外链、双链、停止生成等真实产品文案改为词典断言并补 en-US 渲染用例，
  `editor-toolbar-overflow` 的中文测试夹具改为中性英文避免自造文案干扰。
  新增 2 key，zh/en 各 1554 key；source-selection-bubble / editor-toolbar-overflow
  targeted tests 通过；全量门禁 196 files / 1877 passed / 3 skipped 退出码 0。
- 阶段④第十批（2026-10-11）：翻译层与正文目录块整层双语收敛。
  `TranslationLayer` 的状态（draft/streaming/cancelled/error/done）、标题模板、
  目标语言与关闭 aria-label、空态/失败提示、复制/重翻/停止按钮、工作台
  dialog 标签、原文/译文栏、字数余量/超限、提交说明全部改走消息目录；
  kernel 正文目录块的标题与空态改为 `outline.bodyTocTitle` /
  `outline.bodyTocEmpty`。新增 25 key，zh/en 各 1579 key；
  live-preview-mount / ephemeral-translation targeted tests 通过；
  全量门禁 196 files / 1879 passed / 3 skipped 退出码 0。
- 阶段④第十一批（2026-10-11）：应用壳与编辑器保存/冲突路径的真实 UI 漏网修复。
  全 renderer 源码扫描（剥离注释、排除 binary-host 与 smoke）后逐项判定，
  共迁移 16 行含 CJK 的用户可见字面量（16 个唯一串），分布为：
  `App.tsx` 启动占位、`SplitView` 无页面空态、`AiDockPanel` 未配置三句空态、
  `EditorView` 冲突横幅 + 两个操作按钮 + 保存状态三态 + 右键「询问 AI」+
  AI 插入 prompt（标题与默认值）+ 冲突抛错两处 + 暂停自动保存提示。
  新增 7 key（`app.startup.loading`、`workspace.empty.noPage`、
  `ai.dock.welcome`、`ai.dock.description`、`ai.dock.configure`、
  `editor.askAi`、`common.withColon`），复用既有 `source.saveStatus.*` /
  `source.conflict.*` / `source.slash.aiPrompt*`，zh/en 各 1586 key。
  `common.withColon` 与 `common.withParenthetical`（第九批）同型：修复英文
  界面残留中文全角冒号，`EditorView` 与 `SourceModeView` 的保存状态
  aria-label 均改走该模板。
  `EditorView` 保存回调刻意使用命令式 `t()` 而非 `useI18n()`：防抖与 flush
  路径会捕获旧 closure，若把 `uiText` 放进依赖数组会在每次切语言时重建整个
  kernel（丢弃编辑器状态）。`status` useMemo 仍用 `uiText` 并保留依赖，
  因为它只产出渲染值、切语言必须重算。新增 `app-shell-i18n.test.tsx`
  （启动占位/无页面空态/AI 空态三条 zh + en-US 断言）与
  `editor-dirty.test.tsx` 的两条新用例（冲突横幅 + 按钮 + 保存成功态 +
  冲突期间继续输入不得把内部信号上屏、写入失败 → 保存失败态含 aria-label）。
  同批修正一处真实缺陷：冲突期间再次输入会让 `save()` 提前抛出内部信号，
  kernel 转交 `onSaveError` 后把「等待用户选择」写成磁盘错误文案；现在
  `onSaveError` 在 `conflictRef` 已置位时早退，提示交回冲突横幅。
  全量门禁 197 files / 1884 passed / 3 skipped 退出码 0。
- 阶段④第十二批（2026-10-11）：划词 AI 下拉与右键 AI 子菜单整层双语收敛，
  并给内核补上「语言无关 key」能力。
  `BubbleAction` / `ContextMenuItem` 新增可选 `titleKey` / `titleText`，对齐
  斜杠菜单 `QuickInsertItem` 的既有约定：应用自有文案给 key、插件贡献原文给
  `titleText`。二者由新增的 `menu-title.ts` 统一解析（`resolveMenuTitle`）：
  `titleKey` 命中目录时按**当前**界面语言成文；key 缺失时回退 `titleText`
  而不是把裸 key 上屏——这既保住插件贡献标题的 MUST-NOT-translate 边界，
  也避免误配 key 时把 `plugin.foo.bar` 直接暴露给用户。旧 `title` 字段保留
  为 deprecated 过渡别名（块菜单 / 插件菜单等既有调用点尚未迁移），
  新代码不再使用。
  气泡动作的 tooltip、aria-label 与菜单项文案统一走同一个解析函数，保证
  「共享可访问名称」契约在两种语言下都成立；AI 菜单重开时由同一次
  `refreshBubbleButton` 调用同时刷新 aria 与可见文案，两条路径不会分叉。
  AI 下拉的触发器 aria-label、菜单 aria-label、触发器 Tooltip 改走
  `bubble.aiMenu.trigger` / `menuLabel` / `tooltip`；九个动作（六写作 +
  询问 AI + 翻译选区 + 翻译工作台）改为携带 `bubble.aiMenu.<id>` key。
  **语言切换**是本批的关键回归点：内核在工具栏存活期间不会重建，故
  `open()` 重开菜单时按当前语言刷新 chrome 与全部动作文案，切语言后无需
  重新挂载编辑器即可看到新语言。可见 label 节点在构造时缓存进数组，
  不再用 `${className}__label` 拼选择器（className 含空格/冒号会抛
  SyntaxError 并中断整个 open）。
  右键 AI 子菜单标题改走 `ai.contextMenu.title` + `scopeSelection` /
  `scopeBlock`（打开时才 build，用命令式 `t()`）；AI 插入 prompt 复用既有
  `source.slash.aiPrompt*`。共删除 10 行含 CJK 字面量；`WRITING_ACTIONS`
  的中文 `label` 保留为缺 key 回退，不删除既有测试与内容数据。
  新增 15 key，zh/en 各 1601 key、零差集。
  测试：`source-selection-bubble` 新增 en-US 整菜单 CJK 检查与「切语言后
  重开菜单重算」用例；kernel `writing-surfaces` 新增 `titleKey` 成文 +
  **插件误带缺失 key 时回退原文而非裸 key** 的边界用例。三条新路径均用
  变异测试（改回旧实现即失败）证明断言
  有效。门禁：四套 tsc 通过、`pnpm lint` 0、198 files / 1895 passed /
  3 skipped 退出码 0。
