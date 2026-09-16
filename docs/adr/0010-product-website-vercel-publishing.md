---
status: accepted
---

# 产品官网：monorepo 静态站与 Vercel 发布绑定

为支撑 GitHub 传播与产品叙事，决定在 monorepo 内新建 `apps/website`（React + Vite + TypeScript 纯静态站），经 Vercel 发布至 `*.vercel.app` 子域，作为产品的公开主页。官网无账号、无后台、零追踪：不启用 Vercel Analytics，不接入任何第三方统计或营销脚本，不设置营销 Cookie；下载 CTA 统一指向 GitHub Releases latest，官网不托管安装包（GPL 分发义务因此不落在官网）。语言策略为 `/` 英文 + `/zh` 简体中文双版本，页头显式切换，不按 IP 或浏览器语言自动跳转，hreflang、标题与 OG 元数据分语言本地化，语言选择只在浏览器本地记忆。

正式实现前先产出 4 个**整案原型**（Editorial Knowledge、Local-first Workbench、Graph Intelligence、Quiet Precision）：共享同一真实产品内容、页面结构与响应式断点，仅视觉与叙事方向不同，经本地 Prototype Gallery 评审选定一案，其余原型不进入生产站。原型阶段允许以现有截图占位但必须标记；正式站产品截图一律来自专用**演示知识库**重截，禁用含冒烟种子数据或 mock 调试数据的图。品牌沿用 NexNote 名称与现有靛蓝 `#312E81` 起点，本轮只制作最小资产集：文字 wordmark、由现有 "N" 方块衍生的简化 mark、favicon 全套与 OG 模板；不做完整品牌体系。

## Considered Options

- **Next.js / Astro 等站点框架**：SSR、内容层与图片优化对单页营销站收益有限，且引入第二套框架心智；否决，维持与应用一致的 React + Vite + TS。
- **GitHub Pages**：与要求指定的 Vercel 不符，预览与域名流程弱；否决。
- **GitHub Git 集成自动部署**：发布时机不受控，并与 GitHub 网络可用性耦合（本仓库发布流程曾多次受其影响）；改为 Vercel CLI 本地手动部署。
- **按浏览器语言自动跳转**：不可预测且不利双语言 SEO；改为显式切换。
- **接入匿名统计**：与「本地优先、零追踪」产品叙事冲突，首版无需承担合规面；否决。

## Consequences

- pnpm workspace 扩展为 `apps/*` + `packages/*`；`apps/website` 纳入现有 PR 门禁（lint / typecheck / build）；`.gitignore` 新增 `.vercel/`（默认不忽略，存在误提交 project.json 风险）。
- 仓库元数据绑定：GitHub About 的 Website 填生产 URL；根 `package.json` 新增 `homepage` = 生产 URL，`keywords` 与 GitHub Topics 对齐（markdown、note-taking、knowledge-base、local-first、git、electron、tiptap、wikilinks、knowledge-graph、ai、desktop-app、open-source）；`repository.url` 保持指向 GitHub 源仓库——npm 语义上它描述源码位置而非产品主页，官网入口由 homepage 与 About Website 承载。
- 新建英文主 README 与 `README.zh-CN.md`，官网、下载与文档链接绑定实际发布地址；生产 URL 以部署时实际可用的 vercel.app 子域为准（优先 `nexnote`，冲突退 `nexnote-app`），确认后一次性回填，不预写占位 URL。
- 官网宣称不超出已验证事实：平台仅写 macOS（Apple Silicon / Intel）、Windows x64、Linux x64，不写无记载的最低 OS 版本；不宣称签名、公证或 SmartScreen 通过（QA 状态 NOT_RUN），macOS Gatekeeper 放行说明链接 FAQ。
- 部署步骤与生产 URL 写入 release checklist，与版本发布同节奏更新；vercel.app 子域归属 Vercel，未来切自定义域名需同步回填 README、homepage 与 About Website。

## 实施边界

- 信息架构：Hero（定位 + 下载/GitHub 双 CTA）、核心差异（Local-first / Markdown / Git / 可控 AI）、产品实景、工作方式、隐私与控制、平台下载、GitHub 入口、FAQ 与 Footer；不建 Docs、Blog、Pricing、Changelog 与账号系统。
- 转化目标：下载为主 CTA、GitHub 为次 CTA；不做邮件订阅与等待名单。
- 受众优先级：开发者与本地优先知识管理用户为主，普通知识工作者为次。
