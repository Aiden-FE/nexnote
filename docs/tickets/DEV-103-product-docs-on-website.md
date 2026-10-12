# DEV-103 官网产品文档上线 + 欢迎页「快速上手」跳转文档

状态：partial（文档站 + 跳转已随 v0.0.30 发布并于 2026-10-12 实拍复验 CTA；11 章内容已补齐；ADR-0024 手机端双语已实现；ADR-0023 桌面端双语阶段②③④持续推进；ADR-0025 macOS 欢迎页 + 文档站截图已出，应用内容页截图仍待 GUI 环境稳定）
日期：2026-10-07（grill 四轮确认；2026-10-07 随 v0.0.30 发布已落地的部分见「本轮实际交付」）
关联：ADR-0021、ADR-0022、ADR-0023、ADR-0024、ADR-0025、ADR-0010（Docs 边界已被 ADR-0021 推翻并就地标注）、DEV-074

## 背景

用户要求「健全官网产品使用文档，引导用户正确使用产品，产品欢迎页的快速上手可以直接跳转文档快速上手页」。grill 后确认的事实底座：

- 仓库既有 `docs/user-guide.md`（256 行）与 `docs/faq.md`（244 行）均自称「适用版本 v0.0.1」，与当前 0.0.29 代码存在多处直接矛盾（自动保存默认 500ms 实为 1500ms、⌘T 实为新建标签、本地 Embedding 并非 transformers.js、docx 应用内编辑已于 v0.0.28 移除、首启动向导为三选一而非四选一）。继续把它们当事实源只会加速腐化。
- 官网 `apps/website` 是 React+Vite 纯静态 SPA（ADR-0010 绑定 Vercel），`currentRoute()` 只按第一段判断语言，无 `/docs` 路由、无 docs 入口；`vercel.json` 把所有路径 rewrite 到 `index.html`。
- 应用内此前**没有任何**指向官网或文档的链接；欢迎页「快速上手」只打开 5 步应用内界面聚光灯引导（`setTourOpen(true)`）。
- 应用 `appearance.language`（`'zh-CN' | 'en-US'`）设置存在且可持久化，但**是假开关**——唯一消费点是设置 `<html lang>`、AI 翻译目标语言推断与翻译兜底映射，切到 English 后界面文案零变化。
- 「演示知识库（Demo Vault）」在 CONTEXT.md 与 ADR-0010 中有定义但**实际不存在**；仓库无合规产品截图，`.scratch/nexnote-build/smoke/`（1175 张，244 张被跟踪）为冒烟种子数据（vault 名 `smoke-vault`、页面名「冒烟页面 A」等），ADR-0010 明令禁止用于官网。

## 决策（grill 四轮确认）

1. **文档形态**：官网同域新增 `/docs` 与 `/zh/docs` 路由，每章一页、英文 slug 共享（`/docs/getting-started` 与 `/zh/docs/getting-started`），`/docs` 为文档首页；内容源为拆分成多章的 `docs/user-guide/{zh,en}/<slug>.md`，frontmatter 定义 slug/顺序/标题，官网构建期渲染。**不引入独立文档框架**（ADR-0021 推翻 ADR-0010 的「不建 Docs」边界）。
2. **欢迎页跳转**：「快速上手」改为用**系统默认浏览器**打开文档快速上手页，URL 语言跟随界面语言（zh-CN → `/zh/docs/getting-started`，en-US → `/docs/getting-started`）。复用主进程既有 `setWindowOpenHandler`（`https?` → `shell.openExternal`，新窗口一律 deny），**不新增 IPC**。应用内引导保留：首次开知识库自动弹出、设置页「帮助 → 新手引导 → 重新播放」不变（ADR-0022）。
3. **界面双语**：桌面端与手机端都做 zh-CN + en-US。桌面端为大型机械变更（146 文件 / 1,763 处字面量；含跨进程错误码化），完成门槛是「切到 en-US 后全 UI 含错误消息、原生菜单、对话框无中文残留」；手机端用 Flutter 官方 l10n（167 处真实字符串），**提交摘要不随界面语言本地化**（ADR-0023 / ADR-0024）。
4. **官网截图平台口径**：macOS 今天可拍（本机有可启动 0.0.29 arm64 `.app` + 现成 `capturePage` 自动化）；Windows 本机无任何运行时、Linux 唯一环境是无图形栈的 aarch64 Colima VM 且官方产物为 x86_64，**均不可行**。本次交付 macOS 全套截图，Windows/Linux 文档页复用同一组图并明确标注「截图以 macOS 为准，各平台功能一致」，跨平台截图待环境就绪补拍（ADR-0025）。
5. **交付顺序**：文档优先闭环（演示库 + 截图 + 文档站 + 欢迎页跳转先交付），桌面/手机双语作为后续批次；理由是 i18n 是 146 文件的机械大变更，不该挡住「健全文档」这一原始诉求。

## 本轮实际交付（随 v0.0.30 发布，commit `e30170b` / `98e0a4e`）

- **ADR-0021~0025 + CONTEXT.md 术语**：记录上述五项决策；CONTEXT.md 新增术语「产品文档 / 快速上手页 / 应用内引导 / 界面语言 / 消息目录」。
- **文档站**：仓库 Markdown 成为单一真相源，`docs/user-guide.md` 退役拆为 `docs/user-guide/{zh,en}/`；官网新增 `/docs` 与 `/zh/docs` 路由（文档首页 + 分章页 + 未知路径兜底），逐页 title/description/canonical/hreflang，顶部导航与页脚加文档入口；自研最小 Markdown 渲染器（输出转义、链接仅放行相对路径与 http(s)）；顺带修复既有路由缺陷（页内锚点改为 replaceState 并滚动到目标）。
- **欢迎页跳转**：按决策 2 落地，URL 语言跟随界面语言设置。
- **设置页文档入口**：帮助区提供「产品文档」行，复用同一 URL 构造器按界面语言打开快速上手文档；官网域名以 `package.json homepage` 为单一来源。
- **测试**：新增 `website-docs-render.test.tsx`（文档渲染回归，含「预注入标题会被转义成字面文本」的回归断言）与文档链接语言分支用例；用真实浏览器核验中英索引页/章节页的标题、表格、目录锚点、canonical/hreflang 全部正确。

## 验收（已随 v0.0.30 达成）

- [x] 官网 `/docs`、`/zh/docs` 深链直达返回 200，正确渲染文档首页与快速上手章（中英）
- [x] 逐页 canonical / hreflang（en ↔ zh 配对）正确；页内目录锚点滚动正常
- [x] 欢迎页「快速上手」点击后用系统默认浏览器打开对应语言版本的文档快速上手页
- [x] 设置页「帮助 → 产品文档」入口按界面语言打开对应文档页（2026-10-08 审查补齐）
- [x] 应用内引导保留（首次自动弹出 + 设置页重播）
- [x] `pnpm lint` 零错误零警告；`pnpm typecheck` 5/5；`pnpm test` 1779 passed / 3 skipped 退出码 0；官网与应用构建通过
- [x] 随 v0.0.30 发布（release run `37644828065` 全绿，latest 已指向 v0.0.30）

2026-10-08 复核：当前生产域名的 `/docs`、`/docs/getting-started`、`/zh/docs`、`/zh/docs/getting-started` 四条深链均返回 HTTP 200。

## 第二批（2026-10-09 交付）

- **文档章节补齐**：新增 10 章（中英各一份，共 20 个 Markdown 文件），与原有「快速上手」合计 11 章，覆盖编辑器、双链与知识网络、搜索与 AI 召回、置信度、版本历史与同步、AI 助手与权限模式、插件、表格与思维导图、设置与快捷键、故障排查。
- **内容校对**：章节内容按当前 0.0.34 代码事实撰写（置信度六因子权重取自 `confidence-service.ts`、权限模式取自 `ChatPermissionMode = 'conversation' | 'edit' | 'full'`、Git 诊断分类取自 `GitSyncIssueCategory`），不复用已过期的 v0.0.1 手册表述。
- **章节目录契约测试**：`website-docs-render.test.tsx` 新增用例断言 11 个 slug 的完整目录与顺序（中英一致），并为新增章节各补渲染断言。
- **文档索引**：README 补全 11 章对照表，并记录 `order` / `slug` 两个 frontmatter 字段的约定。
- **门禁**：`pnpm lint` 0、`pnpm typecheck` 5/5、`pnpm test` 190 files / 1801 passed / 3 skipped 退出码 0、官网构建通过。

## 待办（决策已定，实现未开始）

- [ ] ADR-0023 桌面端界面双语：消息目录 + 跨进程错误码化，完成门槛 en-US 全 UI 无中文残留（2026-10-09 阶段①②第一批已落地，见下）
- [x] ADR-0024 手机端 Flutter l10n（2026-10-09 完成：`flutter_localizations` + 各 161 key 的 `.arb` + 错误码化 + iOS `CFBundleLocalizations`/`knownRegions`；证据见下）
- [ ] ADR-0025 演示知识库 + macOS 截图上官网；Windows/Linux 截图待环境就绪补拍
- [x] 文档其余章节补齐（2026-10-09 完成：11 章中英双语，`website-docs-render.test.tsx` 目录契约测试锁定）
- [x] 官网部署到生产 Vercel 后核验深链对外可达（2026-10-09：四条生产深链均 200，且真实 Chrome 渲染核验中英快速上手页内容完整）

### ADR-0023 进展（2026-10-09，阶段①②第一批）

- [x] 消息目录基建：`@nexnote/shared` 语义 key + zh/en 各 382 key 对齐 + `translate()`；renderer `lib/i18n.ts` 的 `t()` / `useI18n`
- [x] 设置真生效：语言切换驱动消息目录；首次启动按系统语言初始化（主进程 `app.getPreferredSystemLanguages()`，无设置文件时）
- [x] 阶段②第一批：设置页标题/搜索态/全分区导航标题/常规分区外观·启动·帮助与翻译默认语言行迁移
- [x] 阶段②第二批（2026-10-10）：欢迎页、命令面板**骨架**、状态栏、首启动向导、侧栏与 Dock 框架 + 四个内置侧栏面板的**标题**（命令条目与面板内部仍中文，见下方未完成项）；`desktop-i18n-migrated-modules.test.tsx` 真实渲染锁定已迁移区域
- [x] 阶段②第三批（2026-10-10）：命令面板全部命令条目与分类（33 命令 / 9 分类）迁移，检索中英关键词互通
- [x] 阶段②第四批（2026-10-10）：编辑器（查找栏/块菜单/补全建议/标题折叠/悬浮目录/工具栏溢出/源码模式保存与冲突/快捷插入与预览错误）与外围（侧栏四面板内部、页面树右键菜单与状态区、新建菜单、标签条、引导浮层、克隆向导、二进制与占位页）迁移；新增「引用 key 必须存在于两份词典」的可执行残留检查
- [x] 阶段②第五批（2026-10-10）：编辑器工具栏动作目录 `EDITOR_ACTION_CATALOG` 迁移完成；动作 / hint / 分组改为语言无关 key，kernel 与 renderer slash 菜单、顶部工具栏、AI 写作项与内置媒体/结构项按语言成文；插件贡献项保留原文边界。消息目录 zh/en 各 479 key 对齐，本批新增 97 key；门禁 193 files / 1824 passed / 3 skipped。
- [x] 阶段②第六批（2026-10-10）：标题转换禁用原因迁移完成；块编辑与源码模式按当前语言成文，新增 5 key，消息目录 zh/en 各 484 key；门禁 193 files / 1825 passed / 3 skipped。
- [x] 阶段②第七批（2026-10-10）：AI 写作浮层与划词停止控件迁移完成；会话错误与截断提示保留上游消息原文边界，本应用 UI 成文。新增 16 key，消息目录 zh/en 各 500 key；门禁 193 files / 1826 passed / 3 skipped。
- [x] 阶段②第八批（2026-10-10）：Git 状态栏/进度/时间线/远程设置/诊断与恢复预览迁移完成；Agent 结构化 prompt 与主进程诊断文案保留原文边界。新增 68 key，消息目录 zh/en 各 567 key；门禁 193 files / 1827 passed / 3 skipped。
- [x] 阶段②第九批（2026-10-10）：AI 对话面板迁移完成；历史/权限/导出/空态/插入/审批与执行横幅、上下文 chips、召回来源和 Skill 选择器成文。会话错误、上下文块、会话标题和 Skill 名称保留 runtime/插件内容边界。新增 73 key，消息目录 zh/en 各 640 key；门禁 193 files / 1828 passed / 3 skipped。
- [x] 阶段②第十批（2026-10-10）：frontmatter 属性面板迁移完成；属性行/格式/字段目录/字段编辑/YAML 切换/源码锁定成文。字段名与值、YAML 解析错误、置信度因子明细保留数据或服务消息边界。新增 85 key，消息目录 zh/en 各 725 key；门禁 193 files / 1831 passed / 3 skipped。
- [x] 阶段②第十一批 / 纠偏批（2026-10-10）：补齐设置核心分区（网络/编辑器/Git/快捷键/关于）的中文硬编码；运行时错误保留 IPC 边界。新增 77 key，消息目录 zh/en 各 855 key；门禁 195 files / 1836 passed / 3 skipped。
- [x] 阶段②第十二批（2026-10-10）：全局图谱、全文搜索、标签搜索与 Skill 设置页迁移；Skill 内容和 IPC 错误保留边界。新增 26 key，消息目录 zh/en 各 881 key；门禁 195 files / 1836 passed / 3 skipped。
- [x] 阶段②第十三批（2026-10-10）：插件设置页与权限弹窗迁移；插件内容、审计明细和 IPC 错误保留边界。新增 37 key，消息目录 zh/en 各 918 key；门禁 195 files / 1837 passed / 3 skipped。
- [x] 阶段②第十四批（2026-10-10）：AI 供应商设置与配置向导迁移；Profile 名、模型名、服务端错误保留数据 / 上游消息边界，能力徽标同步迁移到独立语义 key。新增 107 key，消息目录 zh/en 各 1025 key；门禁 195 files / 1840 passed / 3 skipped。
- [x] 阶段② renderer 模块迁移闭环（仍保留内容/服务消息边界；完整桌面端门槛待阶段③）
- [x] 阶段③第一批（2026-10-10）：主进程语言权威 + 原生菜单四组自定义条目、目录/文件选择、二进制保存失败对话框、快捷键导入/导出对话框迁移；语言切换重建菜单，新增菜单模板测试。新增 16 key，消息目录 zh/en 各 741 key；门禁 195 files / 1833 passed / 3 skipped。
- [x] 阶段③第二批（2026-10-10）：自动更新状态与更新设置界面迁移；本应用状态成文，adapter / IPC 原始错误保留上游文本边界。新增 37 key，消息目录 zh/en 各 778 key；门禁 195 files / 1835 passed / 3 skipped。
- [x] 阶段③第三批（2026-10-10）：Git 同步 doctor 服务状态错误码化成文；未知 code / AI 解释 / 上游错误保留原文边界。新增 50 key，消息目录 zh/en 各 1075 key；门禁 195 files / 1842 passed / 3 skipped。
- [x] 阶段③第四批（2026-10-10）：vault 生命周期与 clone 校验服务消息错误码化；路径数据、上游远端错误和凭据脱敏原文保留边界。新增 26 key，消息目录 zh/en 各 1101 key；门禁 195 files / 1842 passed / 3 skipped。
- [x] 阶段③第五批（2026-10-10）：DOCX 导入/导出服务状态与旧版打开提示成文；底层 ZIP/XML 解析与路径数据保留原文边界。新增 10 key，消息目录 zh/en 各 1111 key；门禁 195 files / 1843 passed / 3 skipped。
- [x] 阶段③第六批（2026-10-10）：GitService 操作状态与安全校验错误成文；commit message、用户路径和上游 Git 错误保留原文边界。新增 59 key，消息目录 zh/en 各 1170 key；门禁 195 files / 1843 passed / 3 skipped。
- [x] 阶段③第七批（2026-10-10）：VaultFsService / page-ops / fs IPC 错误码化成文；路径、文件名、底层 fs 错误和 Git 摘要参数保留边界。新增 28 key，消息目录 zh/en 各 1198 key；门禁 195 files / 1843 passed / 3 skipped。
- [x] 阶段③第八批（2026-10-10）：indexer / index IPC 无 vault 状态与置信度设置自动提交摘要成文；搜索内容和索引数据保留边界。新增 1 key，消息目录 zh/en 各 1199 key；门禁 195 files / 1843 passed / 3 skipped。
- [x] 阶段③第九批（2026-10-10）：retrieval 向量降级状态成文；召回来源与错误原文保留边界。新增 1 key，消息目录 zh/en 各 1200 key；门禁 195 files / 1843 passed / 3 skipped。
- [x] 阶段③第十批（2026-10-10）：AI service / provider 校验与状态错误成文；供应商 body / 模型响应 / 名称数据保留边界。新增 28 key，消息目录 zh/en 各 1228 key；门禁 195 files / 1843 passed / 3 skipped。
- [x] 阶段③第十一批（2026-10-10）：AI store Profile / assignment 校验错误成文；Profile / 模型 / Base URL 数据保留边界。新增 5 key，消息目录 zh/en 各 1233 key；门禁 195 files / 1843 passed / 3 skipped。
- [x] 阶段③第十二批（2026-10-10）：PluginService 安装 / 生命周期 / RPC / 授权服务错误成文；插件内容与 manifest 数据保留边界。新增 20 key，消息目录 zh/en 各 1253 key；门禁 195 files / 1843 passed / 3 skipped。
- [x] 阶段③第十三批（2026-10-10）：插件安装预检 / 安全 ZIP / 授权会话错误成文；manifest 内容与上游数据保留边界。新增 29 key，消息目录 zh/en 各 1282 key；门禁 195 files / 1844 passed / 3 skipped。
- [x] 阶段③第十四批（2026-10-10）：插件 manifest 校验框架文案成文；插件声明值和内容保留边界。新增 13 key，消息目录 zh/en 各 1295 key；门禁 195 files / 1845 passed / 3 skipped。
- [x] 阶段③第十五批（2026-10-10）：settings IPC 无 vault 与快捷键文件 IO 错误成文；导入宽容降级语义保持不变。新增 2 key，消息目录 zh/en 各 1297 key；门禁 195 files / 1845 passed / 3 skipped。
- [x] 阶段③第十六批（2026-10-10）：Agent gateway 运行错误 / 护栏 / 审批摘要成文；AI prompt、工具 description 和模型输出保留边界。新增 15 key，消息目录 zh/en 各 1312 key；门禁 195 files / 1846 passed / 3 skipped。
- [x] 阶段③第十七批（2026-10-10）：Agent builtin tools / ToolRegistry / Skill IPC 校验与拒绝错误成文；工具 description 保留模型指令边界。新增 13 key，消息目录 zh/en 各 1325 key；门禁 195 files / 1846 passed / 3 skipped。
- [x] 阶段③第十八批（2026-10-10）：置信度因子标签 / 明细 / frontmatter 同步摘要成文；因子 key、分数与 Git 数据保留边界。新增 13 key，消息目录 zh/en 各 1338 key；门禁 195 files / 1847 passed / 3 skipped。
- [x] 阶段③第十九批（2026-10-10）：binary / xlsx / mindmap 服务状态与校验错误成文；文档数据、路径和底层解析错误保留边界。新增 17 key，消息目录 zh/en 各 1355 key；门禁 195 files / 1847 passed / 3 skipped。
- [x] 阶段③第二十批（2026-10-10）：Chat session 与 Skill 服务校验错误成文；会话正文 / Skill 名称 / 插件内容保留边界。新增 9 key，消息目录 zh/en 各 1364 key；门禁 195 files / 1847 passed / 3 skipped。
- [x] 阶段③第二十一批（2026-10-10）：preload / IPC registrar / document service / metadata store 契约错误成文；通道名、路径与 IPC 数据保留边界。新增 8 key，消息目录 zh/en 各 1372 key；门禁 195 files / 1848 passed / 3 skipped。
- [x] 阶段③第二十二批（2026-10-10）：IPC validation 框架与 payload 校验错误成文；校验 code 不变，检索关键词保留数据边界。新增 67 key，消息目录 zh/en 各 1439 key；门禁 195 files / 1848 passed / 3 skipped。
- [x] 阶段③第二十三批（2026-10-10）：主进程残留棘轮门禁 + 漏网服务错误收敛。新增 `main-i18n-residue.test.ts`，剥离行/块注释扫描 `main/src` 并以 `fixtures/main-i18n-residue.json` 建立**只减不增**基线（每条残留必须带保留理由）；覆盖 Git doctor 中文 fallback（已知 code 查词典、未知 code 保留脱敏运行时消息）、本地 embedding 不支持对话/未知模型、secret store 不可用与 legacy blob、binary host ack 超时、retrieval 服务不可用、DOCX 对话框/大小、xlsx/xmind 解析错误、docx zip/XML 损坏、git IPC 无 vault / doctor 未初始化、更新通道与 Mac 手动下载、vault 绝对路径、插件审计明细。错误 code 与行为不变。新增 35 key，消息目录 zh/en 各 1474 key；基线从 171 收敛至 134 条（10 类保留边界）；门禁 196 files / 1855 passed / 3 skipped。
- [x] 阶段③第二十四批（2026-10-10）：binary-host 独立编辑器宿主双语 + 跨 WebContentsView 语言同步。宿主加载页、丢弃本地修改确认、保存/冲突/加载状态、思维导图工具栏/抽屉、结构/主题/标记/形状枚举全部改走消息目录；结构/主题/标记/形状目录改为稳定 key，由宿主按当前语言成文；`BinaryEditorCommand` 新增 `language`，ack pull 模型首命令总是返回当前语言，设置变更时 `applyLanguage` 广播；主进程残留门禁扩展为 main 棘轮 + binary-host 源码零 CJK。新增 77 key，消息目录 zh/en 各 1551 key；binary-host 剥离注释后 UI CJK 为 0；门禁 196 files / 1861 passed / 3 skipped。
- [x] 阶段④第一批（2026-10-11）：标题折叠 aria-live 反馈与新建菜单测试迁移。补上 `use-heading-fold-announcement.ts` 漏网中文（新增 `heading.foldsExpanded` / `heading.noFoldedHeadings`），`expand-all` 测试改为词典断言并补 en-US 分支；`new-note-menu` 补 en-US 渲染断言并做 CJK 残留检查。新增 2 key，消息目录 zh/en 各 1553 key；门禁 196 files / 1863 passed / 3 skipped。
- [x] 阶段④第二批（2026-10-11）：OutlinePanel / 内置命令 / 新手引导测试迁移。OutlinePanel 空态与悬浮目录展开控件改为词典断言并补 en-US CJK 检查；内置命令标题与分类补 en-US 全注册表检查；GuidedTour 文案检查扩展到 zh/en 双语言并补 en-US 卡片真实渲染。新增 0 key，消息目录 zh/en 保持 1553 key；门禁 196 files / 1866 passed / 3 skipped。
- [x] 阶段④第三批（2026-10-11）：欢迎页 / 页面树 / 页内查找栏测试迁移。WelcomePage 补整页 en-US 词典内容与 CJK 残留检查；页面树目录折叠 aria-label 与右键重命名菜单改为词典断言，中文路径继续作为内容数据；EditorFindBar 补 en-US search role、输入框、无结果、上一/下一匹配与关闭控件断言。新增 0 key，消息目录 zh/en 保持 1553 key；门禁 196 files / 1869 passed / 3 skipped。
- [x] 阶段④第四批（2026-10-11）：DOCX 打开提示 / 二进制标签关闭失败测试迁移。`open-document` 的英文提示由硬编码英文改为 `translate(CATALOGS, key)` 词典断言并补 CJK 检查，顺带修正 beforeEach 缩进；`binary-tab-close` 改为完整词典断言（`binary.saveError` / `binary.editorLoading`），新增 en-US 恢复与错误路径用例，并在 afterEach 统一卸载 root 消除用例间 React 竞态。新增 0 key，消息目录 zh/en 保持 1553 key；门禁 196 files / 1870 passed / 3 skipped。
- [x] 阶段④第五批（2026-10-11）：Git 同步状态机 / Tab 关闭可访问名测试迁移。`git-sync-progress` 把 `initialPhaseMessage` 与 `conflictHoverText` 的中文片段断言改为 `git.progress.*` / `git.conflict.*` 词典断言（含更多文件数 `{count}` 占位），并新增 en-US 全阶段与 hover 文案 CJK 检查；`tabstrip-title-tooltip` 关闭按钮 aria-label 改为 `tabs.closeWithTitle` 词典断言，新增 en-US 用例锁定 `tabs.tablistLabel` / `tabs.newTab` 与关闭名模板（关闭名含用户标题属内容数据，不做整串 CJK 判断）。新增 0 key，消息目录 zh/en 保持 1553 key；门禁 196 files / 1872 passed / 3 skipped。
- [x] 阶段④第六批（2026-10-11）：召回透明 UI / 源码快捷插入菜单测试迁移。`retrieval-sources` 把标题、向量重排模型、三种阶段名、相似度/置信度与降级徽标断言改为 `retrieval.*` 词典断言，并新增 en-US 降级渲染用例（来源标题/snippet 保持内容数据）；`source-slash-menu` 列表 `aria-label` 与分组标题改为 `source.slash.ariaLabel` / `editorAction.group.*` 词典断言，并新增 en-US 渲染无 CJK 用例。新增 0 key，消息目录 zh/en 保持 1553 key；门禁 196 files / 1874 passed / 3 skipped。
- [x] 阶段④第七批（2026-10-11）：编辑器工具栏动作模型与菜单文案测试迁移。`editor-toolbar-entries` 把「行内代码 / 外链 / 页面标题 H1 / 首个正文 H1 说明 / 跨复杂结构禁用原因」等硬编码中文断言改为 `editorActionCatalogEntry().nameKey`、`toolbar.heading.pageTitle`、`toolbar.heading.disabled.complexSelection` 词典断言，并新增 en-US 真实渲染用例（常驻动作 aria-label、格式菜单项文案与工具栏无 CJK）；页面标题/文件名继续作为内容数据。新增 0 key，消息目录 zh/en 保持 1553 key；门禁 196 files / 1875 passed / 3 skipped。
- [x] 阶段④第八批（2026-10-11）：反向链接角标 title 测试迁移。`backlinks-badge` 的计数与 tooltip 改为 `sidebar.backlinks.badge` 词典断言，并新增 en-US 真实渲染用例（title 无 CJK）；反链来源标题/snippet 继续作为内容数据。新增 0 key，消息目录 zh/en 保持 1553 key；门禁 196 files / 1876 passed / 3 skipped。
- [x] 阶段④第九批（2026-10-11）：划词工具栏与工具栏溢出测试迁移，并修正一处真实 i18n 缺陷。新增 `common.withParenthetical`（zh `{text}（{detail}）` / en `{text} ({detail})`）并把 kernel 划词 Tooltip、禁用 aria-label 与 renderer 工具栏 Tooltip / 菜单项 aria-label 的括号拼接改为词典模板，消除英文界面残留的中文全角括号；`source-selection-bubble` 把真实产品文案（粗体/外链/双链/停止生成）改为词典断言并补 en-US 渲染用例，`editor-toolbar-overflow` 的测试夹具改为中性英文避免自造中文干扰。新增 2 key，消息目录 zh/en 各 1554 key；门禁 196 files / 1877 passed / 3 skipped。
- [x] 阶段④第十批（2026-10-11）：翻译层与正文目录块整层双语收敛。`TranslationLayer` 的状态文案、标题模板、目标语言/关闭 aria-label、空态/失败、复制/重翻/停止按钮、工作台 dialog/字段/字数提示/提交说明全部改走消息目录；kernel 正文目录块的标题与空态改走 `outline.bodyToc*`；`live-preview-mount` / `ephemeral-translation` 改为词典断言并补 en-US 渲染覆盖。新增 25 key，消息目录 zh/en 各 1579 key；门禁 196 files / 1879 passed / 3 skipped。
- [x] 阶段④第十一批（2026-10-11）：应用壳与编辑器保存/冲突路径的真实 UI 漏网修复。全 renderer 源码扫描（剥离注释、排除 binary-host 与 smoke）后逐项判定，共迁移 16 行含 CJK 的用户可见字面量（16 个唯一串）：`App.tsx` 启动占位、`SplitView` 无页面空态、`AiDockPanel` 未配置三句空态、`EditorView` 冲突横幅 + 两个操作按钮 + 保存状态三态 + 右键「询问 AI」+ AI 插入 prompt（标题与默认值）+ 冲突抛错两处 + 暂停自动保存提示。新增 7 key（`app.startup.loading`、`workspace.empty.noPage`、`ai.dock.welcome`、`ai.dock.description`、`ai.dock.configure`、`editor.askAi`、`common.withColon`），复用既有 `source.saveStatus.*` / `source.conflict.*` / `source.slash.aiPrompt*`；消息目录 zh/en 各 1586 key 且逐 key 对齐（0 差集）。`common.withColon` 与第九批 `common.withParenthetical` 同型，修复英文界面残留中文全角冒号：`EditorView` 与 `SourceModeView` 的保存状态 aria-label 均改走该模板。`EditorView` 保存回调刻意使用命令式 `t()` 而非 `useI18n()`：防抖与 flush 路径会捕获旧 closure，把 `uiText` 放进依赖会在每次切语言时重建整个 kernel 并丢弃编辑器状态。同批修复一处真实缺陷：冲突期间再次输入会让 `save()` 提前抛出内部信号，kernel 转交 `onSaveError` 后把「等待用户选择」写成磁盘错误文案；现 `onSaveError` 在 `conflictRef` 已置位时早退，提示交回冲突横幅（已用「移除该守卫即失败」的变异测试证明该断言有效）。新增 `app-shell-i18n.test.tsx`（启动占位/无页面空态/AI 空态各含 zh + en-US 断言），`editor-dirty.test.tsx` 新增两条用例（冲突横幅 + 按钮 + 保存成功态 + 冲突期间继续输入不得把内部信号上屏；写入失败 → 保存失败态含 aria-label）。门禁 197 files / 1884 passed / 3 skipped。
- [x] 阶段④第十二批（2026-10-11）：划词 AI 下拉与右键 AI 子菜单整层双语收敛，并给内核补上「语言无关 key」能力。`BubbleAction` / `ContextMenuItem` 新增可选 `titleKey` / `titleText`，对齐斜杠菜单 `QuickInsertItem` 的既有约定；由新增的 `menu-title.ts`（`resolveMenuTitle`）统一解析：`titleKey` 命中目录时按当前界面语言成文，key 缺失时回退 `titleText` 而非把裸 key 上屏——既保住插件贡献标题的保留原文边界，也避免误配 key 暴露给用户。旧 `title` 保留为 deprecated 过渡别名，既有块菜单 / 插件菜单调用点未迁移，新代码不再使用。AI 下拉触发器 aria-label、菜单 aria-label、触发器 Tooltip 改走 `bubble.aiMenu.*`；九个动作（六写作 + 询问 AI + 翻译选区 + 翻译工作台）改为携带 `bubble.aiMenu.<id>` key。**切语言**是本批关键回归点：内核在工具栏存活期间不重建，故 `open()` 重开菜单时按当前语言刷新 chrome 与全部动作文案，且可见 label 节点在构造时缓存进数组（不再拼 `${className}__label` 选择器，非法 className 会抛 SyntaxError）。右键 AI 子菜单标题改走 `ai.contextMenu.title` + `scopeSelection` / `scopeBlock`；AI 插入 prompt 复用既有 `source.slash.aiPrompt*`。共删除 10 行含 CJK 字面量；`WRITING_ACTIONS` 的中文 `label` 保留为缺 key 回退。新增 15 key，消息目录 zh/en 各 1601 key、零差集。测试：`source-selection-bubble` 新增 en-US 整菜单 CJK 检查与「切语言后重开菜单重算」用例；kernel `writing-surfaces` 新增 `titleKey` 成文 + **插件误带缺失 key 时回退原文而非裸 key** 的边界用例；三条新路径均用变异测试（改回旧实现即失败）证明断言有效。门禁 197 files / 1887 passed / 3 skipped。
- [x] 阶段④第十三批（2026-10-11）：内置块 NodeView、翻译超限与对话运行时错误文案双语收敛。`features/plugins/builtin/node-views.ts` 是框架无关 DOM NodeView、脱离 React，因此 8 处 Mermaid / LaTeX 提示语、渲染中占位、错误文案与 title 全部硬编码中文，现改用命令式 `t()`。NodeView 实例会在语言切换后继续存活，两个工厂均订阅 `subscribeLanguage`，已挂载块切语言时立即重算 hint / title / loading / error 文案；destroy 时反订阅并递增 `renderSeq`，使已发出的异步渲染失效，不再写 detached DOM。翻译 controller 两处超限错误改走 `translation.overLimitSource`（`{count}` 复用 `TRANSLATION_MAX_TEXT_CHARS`，按界面语言格式化而非跟随 OS locale，不再写死 "200,000"）。对话运行时三条上屏文案改走词典：自动保存失败 `chat.error.autoSaveFailed`、打开失败会话 `chat.error.lastTurnFailed`，以及空内容首条消息的默认标题——最后一处复用主进程 `chat-service` 早已在用的 `chat.default.title`，消除跨进程同一语义的重复硬编码。共删除 13 行含 CJK 字面量（12 个唯一字符串，翻译超限错误在两个路径重复出现）；新增 11 key，消息目录 zh/en 各 1612 key、零差集。测试：`builtin-nodeviews` 新增 en-US 真实挂载断言（编辑提示、LaTeX title、块级 hint 且无 CJK）与「先挂载、后切语言」断言；新增 `builtin-nodeviews-i18n-states` 用 mock 渲染库锁定 Mermaid / LaTeX 的 loading / error 状态随语言重算、上游错误原文保留、销毁后 late resolve 不写 DOM；`ephemeral-translation` 新增超限错误 en-US 精确断言；`chat-flow` bridge 新增 `failSave` 分支并断言自动保存失败文案。三条路径均用「回退三个实现即失败」的变异测试证明断言有效。门禁 198 files / 1895 passed / 3 skipped。
- [x] 阶段④第十四批（2026-10-11）：插件 UI 框架文案、贡献标题契约与心跳超时错误码化双语收敛。设置页签标题属于应用 UI chrome，不再误用插件或持久化 title 数据：`TabStrip` 为 settings 页签统一改读 `tabs.settings`，en-US 真实渲染测试锁定 tooltip 无 CJK。插件右键父级菜单由硬编码「插件」改为 `plugins.menu.title`；插件块插入模板改为 `plugins.blockCommand.title`，并新增 `CommandDef.titleParams`、`PluginBlockCommandDef.titleText` 以及 slash 菜单 `titleParams`，命令面板和富文本 / 源码 slash 菜单都只把插件贡献标题作为模板参数，绝不翻译插件内容。heartbeat 超时不再把中文句子持久化进插件 `lastError` / 审计 detail；`plugins:reportCrash` 新增可选 `error` 字段并在 IPC 校验器中限制为已知 app code，`PluginSandboxFrame` 为 heartbeat 发送带命名空间的 message 与 `error`，主进程优先持久化 `error`，`PluginsSettingsPage` 展示时映射 `plugins.error.PLUGIN_HEARTBEAT_TIMEOUT`；第三方崩溃不带 code，原始字符串继续保留原文。新增 4 key（`tabs.settings`、`plugins.menu.title`、`plugins.blockCommand.title`、`plugins.error.PLUGIN_HEARTBEAT_TIMEOUT`），消息目录 zh/en 各 1617 key、零差集。测试：`plugins-settings-page` 新增 en-US 真实渲染断言，稳定 heartbeat code 在 last error 与审计明细按词典成文，第三方 `boom` 保持原文；`plugin-host` 用 fake timers 锁定 heartbeat 持久化 `error=PLUGIN_HEARTBEAT_TIMEOUT`，并单独锁定非 heartbeat 转发串不带 code；`plugin-extensions` 锁定 `titleText` 作为模板参数且不被翻译；`tabstrip-title-tooltip` 补 settings 页签 en-US 断言。门禁：`shared` / `kernel` / `main` / `renderer` 四套 `tsc` 通过、`pnpm lint` 0、`pnpm test` 204 files / 1921 passed / 3 skipped 退出码 0。
- [x] 阶段③第二十五批（2026-10-12）：原生菜单 Edit / View 标签与 Git 自动提交摘要词典化。`window-menu.ts` 的 language 三元分支改走 `app.menu.edit` / `app.menu.view`；`git-service.ts` 三个方法的默认 summary 参数改为 `tCurrent('git.service.autoSummarySavePage')`，「拉取前保存」改用 `git.service.autoSummaryBeforeSync`；`index.ts` 的退出前保存、`ipc/git-handlers.ts` 的 IPC 默认 summary、`ipc/chat-handlers.ts` 的导出会话摘要与 `ipc/docx-handlers.ts` 的导入 / 导出摘要全部改走词典模板。commit message 作为数据不本地化的边界不变：模板成文结果是 commit message 的一部分，仅在生成时读取当前界面语言。新增 7 key，消息目录 zh/en 各 1624 key、零差集。测试：`window-menu` 新增 en-US Edit / View 断言；main 残留棘轮基线从 134 收敛至 125。门禁：四套 tsc 通过、`pnpm lint` 0、`pnpm test` 204 files / 1922 passed / 3 skipped 退出码 0。
- [x] 阶段③第二十六批（2026-10-12）：Git 初始化与 doctor 同步前保存摘要词典化。`INITIAL_MESSAGE` 从模块级常量改为 `git.service.initialMessage` 词典函数，`commitKind` 判定同步改用同一 key，避免重复字面量漂移；doctor 的「同步前保存本地变更」改走 `git.service.doctorPreSyncMessage`。commit message 仍为数据边界：词典只在生成时读取当前语言，落盘文本不回译。新增 2 key，消息目录 zh/en 各 1626 key、零差集；main 残留棘轮基线从 125 收敛至 121（Git 类剩 2 条均为 stable 语义字符串）。门禁：四套 tsc 通过、`pnpm lint` 0、`pnpm test` 204 files / 1922 passed / 3 skipped 退出码 0。
- [x] 阶段③第二十七批（2026-10-12）：Chat 导出标签与注释标记词典化。`chat-service.ts` 的 `renderDocumentBody` 中「> 提问：」与 `<!-- 用户提问` 改走 `chat.export.userQuestion` / `chat.export.userQuestionComment`，导出文档中的标记随界面语言生成；smoke 检查同步改为 `tCurrent()` 断言而非硬编码中文。新增 2 key，消息目录 zh/en 各 1628 key、零差集；main 残留棘轮基线从 121 收敛至 119。门禁：四套 tsc 通过、`pnpm lint` 0、`pnpm test` 204 files / 1922 passed / 3 skipped 退出码 0。
- [x] 阶段④第二十八批（2026-10-12）：标签树与设置入口补 en-US 真实渲染断言。`tags-tree` 新增 en-US 用例，断言标签面板 `textContent` 不含任何 CJK，证明 `sidebar.tags.*` 词典 chrome（副标题 / 来源 / 空态 / 折叠 aria）已成文；`sidebar-settings-navigation` 新增 en-US 用例，切换语言后重新渲染并断言设置入口为 `Settings` 且无 CJK。两个测试均在 `afterEach` 复位 `setCurrentLanguage('zh-CN')`。新增 0 key，消息目录 zh/en 保持 1628 key、零差集。门禁：`pnpm lint` 0、`pnpm test` 204 files / 1924 passed / 3 skipped 退出码 0。
- [x] 阶段④第二十九批（2026-10-12）：预览错误横幅补 en-US 渲染断言。`live-preview-retry` 在 DEV-109 已有的 zh-CN「重试」断言旁补 en-US 用例：断言重试按钮为 `Retry`，且 `preview-stale` 横幅 `textContent` 不含任何 CJK；注入的 `Invalid content for node type listItem` 仍按内核错误原文保留。`afterEach` 复位 `setCurrentLanguage('zh-CN')`。新增 0 key，消息目录 zh/en 保持 1628 key、零差集。门禁：`pnpm lint` 0、`pnpm test` 204 files / 1925 passed / 3 skipped 退出码 0。
- [x] 阶段④第三十批（2026-10-12）：工具栏溢出「更多」入口补 en-US 渲染断言。`editor-toolbar-overflow` 在既有 DEV-035 溢出 DOM 用例旁补 en-US 用例：窄行宽下断言 `toolbar-more` 的 `aria-label` 成文为 `More`，且该节点 `outerHTML` 不含任何 CJK，证明 `toolbar.more` / `toolbar.moreMenu` 的 tooltip 与 aria 已词典化；用例显式注明传入的「已保存」status 属测试数据、不参与 CJK 断言。`afterEach` 复位 `setCurrentLanguage('zh-CN')`。新增 0 key，消息目录 zh/en 保持 1628 key、零差集。门禁：`pnpm lint` 0、`pnpm test` 204 files / 1926 passed / 3 skipped 退出码 0。
- [x] 阶段④第三十一批（2026-10-12）：双链补全与 AI 模型下拉测试词典化 + en-US 断言。`source-wikilink-completion` 把三处硬编码的「创建新页面」断言改为 `tCurrent('suggest.createNewPage')`，并新增 en-US 用例断言红链候选 detail 成文为 `Create new page` 且无 CJK（页面标题 `label` 仍按内容边界保留原文）。`ai-model-candidates` 与 `ai-entry-consolidation` 把 `aria-label="展开模型列表"` 断言改为 `tCurrent('ai.model.expand')`；前者新增 en-US 用例断言展开按钮 aria-label 成文为 `Expand model list`，后者新增 en-US 用例断言 AI dock 未配置入口 chrome 无 CJK。三个测试均在 `afterEach` 复位 `setCurrentLanguage('zh-CN')`。新增 0 key，消息目录 zh/en 保持 1628 key、零差集。门禁：`pnpm lint` 0、`pnpm test` 204 files / 1929 passed / 3 skipped 退出码 0。
- [ ] 阶段③剩余：主进程用户可读状态与校验错误残留继续按棘轮基线收敛；GitService / vault / doctor / DOCX / FS / AI service / plugin manifest / settings IPC / agent gateway/tools / confidence / binary / chat / skill / preload / IPC validation 服务状态已完成
- [~] 阶段④剩余：54 个 happy-dom UI 测试中 40 个已带 en-US 渲染断言（含 CJK 残留检查）；剩余 14 个逐个核查后确认均为纯逻辑 / 几何 / 内容数据断言（DOM 计时、滚动定位、文件名与标题数据），不含词典 chrome，不构成「en-US 全 UI 无中文残留」门槛缺口
- [ ] **NOT_RUN / 未达门槛**：按 ADR「en-US 全 UI 无中文残留」，当前不声称桌面端双语完成

### ADR-0024 验收证据（2026-10-09）

- [x] `flutter_localizations` + `intl` + `l10n.yaml` + `lib/l10n/{app_zh,app_en}.arb`，各 161 key 逐 key 对齐
- [x] 设置页提供界面语言选择（跟随系统 / 简体中文 / English）并持久化（`AppSettings.languageOverride`）
- [x] 跟随系统默认生效；系统语言非 zh/en 时回退 en（`l10n_message_catalog_test.dart`）
- [x] 切到 English 后界面文案无中文残留（`l10n_message_catalog_test.dart` CJK 正则扫描）
- [x] 错误码化：`SyncMessageKind` / `GitErrorCode` / `AiRequestErrorCode` / `SecretVaultErrorCode` / `CaptureErrorCode`，UI 经 `app/message_descriptions.dart` 成文
- [x] 提交摘要、AI 提示词、落盘页面标题不随界面语言变化（ADR-0024 否决项）
- [x] iOS `CFBundleLocalizations` + `knownRegions` zh-Hans
- [x] `flutter analyze` 无问题；`flutter test` 120 例通过
- [ ] **NOT_RUN**：iOS 真机/模拟器系统语言切换与 Keychain 写入（本机无 iOS 运行时，需在 Xcode 环境补验）

### 生产深链可达核验（2026-10-09）

- [x] `https://website-aiden-fes-projects.vercel.app` 的 `/docs`、`/docs/getting-started`、`/zh/docs`、`/zh/docs/getting-started` 均返回 HTTP 200
- [x] 真实 Chrome 渲染核验：`/zh/docs/getting-started` 标题、11 章侧栏目录、7 节正文表格与段落、页内锚点与「下一章」链接全部正确（静态 HTML 仅 SPA 外壳，故以浏览器渲染为准）

### ADR-0025 截图进展（2026-10-09）

- [x] 演示知识库已新建于 `docs/demo-vault/`（本地资产、不入外层仓库）：自带独立 `.git`、中英双语 4 个真实示例页面、双链与标签关系真实存在（ADR-0010/0025 硬约束）
- [ ] macOS 全套截图：**被环境阻塞**——本轮执行时 Mac 进入锁屏，GUI 自动化无法解锁；需在解锁后的图形会话中启动打包应用打开演示库并经 `capturePage` 截图
- [ ] 截图入官网并标注「截图以 macOS 为准，各平台功能一致」
- [ ] Windows/Linux 截图（环境不具备，见 ADR-0025 已登记后续项）

### ADR-0025 截图进展（2026-10-12）

- [x] **欢迎页 CTA 实拍验收**：解锁后的图形会话中启动打包应用 `release/mac-arm64/NexNote.app`（v0.0.34）打开 `docs/demo-vault`，点击欢迎页「快速上手」后系统默认浏览器（Google Chrome）打开 `https://website-aiden-fes-projects.vercel.app/zh/docs/getting-started`，标题为「快速上手 · NexNote 文档」——「用系统默认浏览器打开对应语言文档页」的决定得到实测确认。
- [x] **文档站实拍**：`/zh/docs/getting-started` 完整渲染 11 章侧栏、页内目录、正文表格与版本标注。用户此前报告的「文档无图例」经核查为当前设计边界——文档渲染器（`apps/website/src/docs/markdown.ts`）按 ADR-0010 只支持文本、表格、代码块与双链语法，不解析 `![](...)` 图片语法，文档正文本就是纯文字排版。
- [x] 产出两张 macOS 实拍资产（2000px 宽，落盘 `apps/website/public/screenshots/`）：`macos-welcome-zh.png`（欢迎页 + 页面树 + 快速上手 CTA）、`docs-getting-started-zh.png`（文档快速上手页全貌）。暂未嵌入正文（渲染器不支持图片语法）。
- [ ] macOS 全套**应用内容页**截图（编辑器 / 图谱 / 设置 / 插件）：本次 GUI 自动化中，侧边栏文件树的点击与 Tab 导航焦点在 Electron 渲染进程与浏览器之间反复漂移（前台被其他应用抢占、窗口位置漂移、Tab 焦点跳出到 Chrome），未能在打包应用中稳定打开 `notes/Reading Notes` 等内容页。按 ADR-0025「未实际拍摄不得声称已验收」的边界保持 `NOT_RUN`，不放有瑕疵截图充当证据。
- [ ] en-US 界面重截、Windows/Linux 截图（环境仍不具备，见 ADR-0025）。

## Out of scope

- 手机端官网文档章节（ADR-0021 决定：手机端有公开发布渠道前不写官网章节，「有双语界面」不等于「可被安装」）
- 按应用版本分叉的文档快照（living docs，页头标注「适用版本 v0.0.29+」）
- 站内搜索、Blog、Pricing、Changelog、账号系统（沿用 ADR-0010 边界）
