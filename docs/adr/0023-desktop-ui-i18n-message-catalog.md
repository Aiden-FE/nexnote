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
