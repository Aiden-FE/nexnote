# DEV-046 · 产品官网原型、MIT 许可与仓库元数据

Type: dev
Module: website
Status: closed
Blocked by: 无（可立即开始；与 DEV-045 无依赖）
Depends: 无
Effort: L
Priority: P1

## Scope

按 ADR-0010/0011 建立产品官网与发布绑定：monorepo 内 `apps/website` 静态站，已从四个整案原型收敛为正式 **Editorial Knowledge** 单页方案，保留双语结构、品牌最小资产集与零追踪；同时落地 MIT 许可与仓库元数据/README。

### 交付内容

1. **脚手架**：`apps/website`（React + Vite + TypeScript 纯静态，无 SSR/无运行时后台）；`pnpm-workspace.yaml` 扩为 `apps/* + packages/*`；复用仓库 prettier/eslint 规则；构建产物纯静态可托管。
2. **正式 Editorial 方案**：评审已选定 Editorial Knowledge；正式站保留其阅读室式 hero、产品实景、功能、FAQ 与下载 CTA。Local-first Workbench、Graph Intelligence、Quiet Precision 已移除，不进入生产构建。
3. **品牌最小集**：文字 wordmark、由现有靛蓝 `#312E81` "N" 方块衍生的简化 mark、favicon 全套（.ico + PNG/SVG）、OG 模板；不做完整品牌体系，不重命名产品。
4. **双语与零追踪**：`/` 英文 + `/zh` 简体中文，页头显式切换，不自动跳转；hreflang/标题/OG 分语言；不启用任何统计、营销脚本与 Cookie。
5. **下载 CTA 与宣称边界**：下载指向 `https://github.com/Aiden-FE/nexnote/releases/latest`；平台仅 macOS（Apple Silicon/Intel）、Windows x64、Linux x64；不写最低 OS 版本、不称签名/公证；Gatekeeper 说明链 FAQ。
6. **MIT 许可**：根 LICENSE（版权行 Aiden-FE and NexNote contributors）；根 package.json `license: MIT`（`private: true` 保留防误发 npm）；SOURCE_OFFER 占位邮箱换真实联系方式需用户确认后另行处理（本票不改邮箱）。
7. **README 与元数据**：新建英文主 `README.md` + `README.zh-CN.md`（定位、功能、平台、下载、本地开发、架构、贡献、License；顶部中文入口）；根 package.json 增 `keywords`（12 个，与 GitHub Topics 对齐）；`homepage` 与 GitHub About Website 待生产 URL 确认后回填（不预写占位 URL）。
8. **发布准备**：`.gitignore` 增加 `.vercel/`；website 纳入 PR 门禁（lint/typecheck/build）；部署步骤与 URL 回填项写入 release checklist；Vercel CLI 手动部署（不用 GitHub 自动集成），部署与 Topics/About Website 更新在用户参与下执行。

## 安全不变量（继承全局约束）

- 官网零第三方脚本、零 Cookie、零账号；下载不 hosted on Vercel（无 GPL 分发义务落在站点）。
- 宣称不超出已验证事实（无签名/公证/最低版本/协作/移动端/云同步宣称）。
- 原型页面不得使用含冒烟种子数据或 mock 调试数据的截图且未标记。

## 验收标准

1. `pnpm --filter website build`（或等价）产出静态 dist；Editorial 正式页可本地预览，双语路由与响应式断点一致。
2. 双语路由 `/` 与 `/zh` 内容对齐，语言切换不跳转、无自动重定向；页面无任何外发请求（构建产物 grep 无 analytics/pixel 域名）。
3. 品牌最小集四件齐全（wordmark/mark/favicon/OG）并实际用于原型。
4. LICENSE 落地且 package.json license=MIT；`pnpm lint`、typecheck 对 website 生效；主仓既有门禁不回归。
5. README 双语结构齐全，无占位官网 URL；keywords 12 个就位。
6. 未真实执行的 GUI/部署验收标 `NOT_RUN`（Vercel 部署、About Website、Topics 设置为用户参与步骤）。

流程：

7. 在 `.wt/DEV-046` / `dev/DEV-046` 隔离实现，双轴审查通过后 `git merge --no-ff`；合并后复跑门禁并更新 README 与 checkpoint。

## 关联决策

- [ADR-0010](../../../docs/adr/0010-product-website-vercel-publishing.md)、[ADR-0011](../../../docs/adr/0011-mit-license.md)
- 术语：[CONTEXT.md](../../../CONTEXT.md) 整案原型 / 演示知识库
