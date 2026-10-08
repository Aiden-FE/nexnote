# DEV-105 官网 Vercel Git 集成部署失败（No Output Directory named "dist"）

状态：done（2026-10-08；build pipeline fixed `bf69969`，生产域名统一到 `website-aiden-fes-projects.vercel.app`）
分类：bug（发布基础设施）
优先级：P1
范围：仓库根 `vercel.json`
关联：ADR-0010、ADR-0021、DEV-103
来源：用户反馈 2026-10-08（release v0.0.33 后 Vercel CI 持续红叉）

## 现象

- Vercel Git 集成在每次 push 后报错：`No Output Directory named "dist" found after the Build completed. Configure the Output Directory in your Project Settings. Alternatively, configure vercel.json#outputDirectory.`
- 最近 100 次 GitHub Deployment 记录里，vercel[bot] 触发的 Production/Preview 部署 **85 次失败、0 次成功**（仅有的 3 次 success 是 release 工作流的 `release-qa` 环境，与 Vercel 无关）。

## 根因

Vercel 项目按**仓库根**构建（未把 Root Directory 配到 `apps/website`），于是默认 build 走根 `package.json` 的 `pnpm build` = `electron-vite build`，产物在 `out/`；而 Vite 预设期望 `dist/`。仓库根此前没有 `vercel.json` 告诉它该构建哪个子包、产物在哪。`apps/website/vercel.json` 只对以 `apps/website` 为根的部署（本地 CLI 路径）生效，对 Git 集成无效。

## 修复（bf69969）

仓库根新增 [vercel.json](../../vercel.json)：

- `installCommand: pnpm install --filter website... --frozen-lockfile`（monorepo 过滤安装，官方推荐写法；不拉 electron 等桌面端依赖）
- `buildCommand: pnpm --filter website build`
- `outputDirectory: apps/website/dist`
- SPA rewrites（与 `apps/website/vercel.json` 一致，深链回退 `index.html`）

## 验证

- [x] 干净 `git clone` 中原样执行 installCommand + buildCommand：产物 `apps/website/dist/index.html` 与 assets 齐全
- [x] push `bf69969` 后 Vercel Git 集成部署**首次成功**（deployment `website-k9j8ljweu`，GitHub 状态 success）
- [x] 项目生产域名 `website-aiden-fes-projects.vercel.app` 已切到新构建：引用 `assets/index-CP4C-V9K.js`（与本地构建同 hash），bundle 含 `getting-started` 文档内容，`/docs/getting-started` 深链 200
- [x] **生产域名统一**：旧域名 `nexnote-app.vercel.app` 仍指向无文档的旧部署（bundle `index--e-_qXEP.js`，不含 `getting-started`），而实际承载文档的是 team `aiden-fes-projects` 的 `website` 项目（bundle `index-CP4C-V9K.js`，含文档）。Vercel 控制台无法迁移动的域名，故统一改用实际可用的 `https://website-aiden-fes-projects.vercel.app`：`package.json#homepage`（ADR-0022 的文档 URL 唯一来源）、`apps/website/index.html#canonical`、README/README.zh-CN、renderer 引导链接测试断言全部对齐。核验：`nexnote-app.vercel.app` bundle 含 `getting-started` 0 处，`website-aiden-fes-projects.vercel.app` 含 3 处。

## 备注

ADR-0010 曾决策「CLI 手动部署、否决 Git 集成自动部署」，但 team 项目 `website` 实际上一直开着 Git 集成（85 次失败即证据）。本次修复让已开启的自动部署真正可用；若最终想回到纯手动，应在 Vercel 控制台断开 Git 集成，而不是让构建持续失败。
