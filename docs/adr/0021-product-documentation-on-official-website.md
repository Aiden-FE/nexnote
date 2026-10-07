---
status: accepted
supersedes-in-part: ADR-0010
---

# 产品文档上官网：仓库 Markdown 为单一源，官网构建期渲染

产品需要一套健全的使用文档来引导用户正确使用 NexNote，而仓库现有的 `docs/user-guide.md` 与 `docs/faq.md` 自称「适用版本 v0.0.1」，与当前 0.0.29 代码存在多处直接矛盾（自动保存默认 500ms 实为 1500ms、⌘T 实为新建标签页、本地 Embedding 并非 transformers.js、docx 应用内编辑已于 v0.0.28 移除、首启动向导为三选一而非四选一），继续把它们当事实源只会加速腐化。因此决定把产品文档做成**官网站内页面**，并以仓库 Markdown 为唯一真相源。

官网在 `/docs` 与 `/zh/docs` 下新增文档路由，每章一页、英文 slug 共享（`/docs/getting-started` 与 `/zh/docs/getting-started`），`/docs` 为文档首页；内容源为拆分成多章的 `docs/user-guide/{zh,en}/<slug>.md`，frontmatter 定义 slug、顺序与标题，官网在构建期渲染为静态 HTML，保留 ADR-0010 的 React + Vite + TypeScript 纯静态站与 Vercel 发布绑定，**不引入独立文档框架**。文档始终为 living docs，页头标注「适用版本 v0.0.29+」，不按应用版本分叉快照。官方文档覆盖桌面端使用；手机端在具备公开发布渠道前不写官网章节。桌面与手机界面双语是 ADR-0023 / ADR-0024 的独立交付目标，「有双语界面」也不等于「可被安装」。

## Considered Options

- **独立文档框架（VitePress / Docusaurus）**：与 ADR-0010 绑定的 React + Vite 站并列引入第二套框架心智，内容管线更重；否决，维持单一框架。
- **手写 TSX 文档组件**：与现有 `main.tsx` 风格一致，但 10+ 章 × 双语的内容无法维护，且内容与代码混杂；否决，改用 Markdown 源 + 构建期渲染。
- **不建站内文档，外链到 GitHub 渲染仓库 Markdown**：零站点改动，但用户体验割裂、无导航、无语言切换，且 GitHub 渲染不适合结构化使用文档；否决。
- **按应用版本分叉文档快照**（`/docs/v0.0.29/...`）：在没有版本支持承诺的现阶段是维护地狱；否决。
- **官网单页 + 锚点分章**：不可分享、难被搜索引擎收录；否决，每章一页。

## Consequences

- 修订 ADR-0010 的「实施边界」：其中「不建 Docs」按用户决定被本 ADR 推翻；官网信息架构在原条目后追加 Docs 与 Hero 次级 CTA，页脚同步文档链接，顶部导航新增「文档 / Docs」。
- `docs/user-guide.md` 退役：内容校正后拆分为多章文件，原单文件不再作为事实源；`docs/faq.md` 同步校正并按同样方式处理。GitHub 读者与官网读者看到同一份 Markdown。
- 官网需要可识别的多段路由（`/zh` 语言前缀 + `/docs` 段落 + slug）并据此更新 `document.title`、description、`canonical`、`og:*` 与逐页 `hreflang`；现有手写路由只按第一段判断语言，必须扩展。
- 文档内容必须对齐 CONTEXT.md 术语表；纠错项以代码为准，不以旧手册为准。
- 官网继续遵守 ADR-0010 的零追踪约束：文档页不引入统计脚本，图片走站内静态资源。

## 验收边界

- 未实际部署到生产 Vercel 的深链（如 `/zh/docs/getting-started` 直达）不得声称已验证；构建产物存在不等于线上可达。
- 文档内容「正确」以当前 master 代码为准；任何未实际执行的 UI 或平台行为标记为 `NOT_RUN`。
