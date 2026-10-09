# DEV-103 官网产品文档上线 + 欢迎页「快速上手」跳转文档

状态：partial（文档站 + 跳转已随 v0.0.30 发布；11 章内容已补齐并全部门禁通过；ADR-0023/0024 双语与 ADR-0025 截图仍待实现）
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

- [ ] ADR-0023 桌面端界面双语：消息目录 + 跨进程错误码化，完成门槛 en-US 全 UI 无中文残留
- [ ] ADR-0024 手机端 Flutter l10n（`flutter_localizations` + `.arb` + iOS `CFBundleLocalizations`）
- [ ] ADR-0025 演示知识库 + macOS 截图上官网；Windows/Linux 截图待环境就绪补拍
- [x] 文档其余章节补齐（2026-10-09 完成：11 章中英双语，`website-docs-render.test.tsx` 目录契约测试锁定）
- [ ] 官网部署到生产 Vercel 后核验深链对外可达（构建通过 ≠ 线上可达）

## Out of scope

- 手机端官网文档章节（ADR-0021 决定：手机端有公开发布渠道前不写官网章节，「有双语界面」不等于「可被安装」）
- 按应用版本分叉的文档快照（living docs，页头标注「适用版本 v0.0.29+」）
- 站内搜索、Blog、Pricing、Changelog、账号系统（沿用 ADR-0010 边界）
