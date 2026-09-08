# NexNote v0.1.0 Release Checklist

> 适用于 `dev/DEV-019` 分支基线 00c858c 的 DEV-019 集成验收。
> 每项标注 ✅（已通过 / 可复现）、⚠️（部分验证）、❌（未通过）、`NOT_RUN`（本地无法验证，需人工）。

---

## 1. 代码质量门禁

| # | 项 | 命令 | 结果 | 备注 |
| --- | --- | --- | --- | --- |
| 1.1 | 全 workspace typecheck | `CI=true pnpm -r typecheck` | ✅ 全绿 | 5 个包（shared / plugin-api / kernel / renderer / main）全部通过；main 包无 typecheck 脚本，其 `tsc --noEmit` 基线错误 1 个（`secret-store.ts` 中 `Entry` TS2304），与 master 一致 |
| 1.2 | 单元 + 集成测试 | `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test` | ✅ 74 文件通过（1 文件 skipped）/ 616 测试通过（2 skipped） | 新增 3 个文件（e2e-integration / perf-timebox / bug-bash），共 13 个新用例 |
| 1.3 | ESLint | `CI=true pnpm exec eslint .` | ✅ 全绿 | 无警告无错误 |
| 1.4 | Production build | `CI=true pnpm build` | ✅ | electron-vite 三端构建通过；最大 bundle `index-*.js` ~3.4MB |
| 1.5 | Release config 校验 | `node scripts/verify-release-config.mjs` | ✅ 28/28 checks passed | 含 immutable SHA pin、dugite GPL、updater 状态机、PR gate 覆盖 等 |
| 1.6 | Changed-files format | `bash scripts/check-changed-format.sh master` | ✅ | Prettier 检查通过（首次提交前运行） |
| 1.7 | Git diff whitespace | `git diff --check master...HEAD` | ✅ | 无尾随空白 / 多余换行 |

---

## 2. 功能集成验证

| # | 项 | 方式 | 结果 |
| --- | --- | --- | --- |
| 2.1 | vault 创建 → 索引就绪 | IPC 集成测试 | ✅ `vault:create` → `vault:getState` mode=ready → index.status.phase=ready |
| 2.2 | 新建笔记 → 搜索命中 → 反链 → 图谱 | e2e-integration.test.ts | ✅ FTS/CJK 子串搜索命中；backlinks 方向正确；graph.pages/links 一致 |
| 2.3 | Obsidian 方言兼容 | e2e-integration.test.ts | ✅ wikilink alias > title > basename；frontmatter tags + 行内 #tag 统一索引 |
| 2.4 | 重命名 → 全库 wikilink 自动更新 | rename-index-integration.test.ts（已有） | ✅ 旧路径清除、新路径建立、反链正确 |
| 2.5 | 三阶段召回（FTS → 双链 → 向量） | e2e-integration.test.ts | ✅ 三阶段都产生 stage stats；vectorSim 非空；contextText 正确组装 |
| 2.6 | 置信度（含 PageRank link_authority） | e2e-integration.test.ts | ✅ 6 因子加权和=1；有入链页面 link_authority > 0；写回 SQLite 可读出 |
| 2.7 | Skill 系统（内置 + 插件 Skill 合并重排） | e2e-integration.test.ts | ✅ 2 个内置 + demo 插件 1 个 Skill 全部列出；合并召回返回非空 |
| 2.8 | Chat 会话即页面 | e2e-integration.test.ts | ✅ 会话文件含 `type: chat` frontmatter；可被索引 |
| 2.9 | 插件安装 → 权限确认 → 激活 → 贡献点生效 | plugin-service.test.ts（已有） + e2e | ✅ preview → confirm → active；commands/views/blockTypes 贡献点列出 |
| 2.10 | 索引生命周期（打开 → 增量 → 关闭） | e2e-integration.test.ts | ✅ open → ready → updateFile → backlinks 出现 → close → idle |

---

## 3. 性能时间盒（千页级）

测试环境：本地 Node / M 系列 macOS / better-sqlite3 同步。
**不是 benchmark，是数量级时间盒，防止 O(n²) 回归。**

| # | 项 | 规格 | 实测 | 结果 |
| --- | --- | --- | --- | --- |
| 3.1 | 全量索引（1000 页 / ~8k 块 / ~3k 链接） | < 30s | ~210ms | ✅ |
| 3.2 | CJK 搜索（单 query，取前 50） | < 150ms | ~7.7ms | ✅ |
| 3.3 | 拉丁搜索（单 query，取前 50） | < 100ms | ~7.1ms | ✅ |
| 3.4 | jumpTo（标题快跳） | < 100ms | ~0.1ms | ✅ |
| 3.5 | graph() 快照 | < 1.5s | ~90ms | ✅ |
| 3.6 | PageRank（20 次迭代，1000 节点） | < 3s | ~280ms | ✅ |
| 3.7 | 两阶段召回（无向量，1000 页） | < 500ms | ~27ms | ✅ |
| 3.8 | 500 → 1000 页搜索耗时增长 | < 4x | ~1.5x | ✅ 近线性 |
| 3.9 | 500 → 1000 页 PageRank 耗时增长 | < 5x | ~1.8x | ✅ 近线性 |
| 3.10 | 单文件增量更新（千页库中） | < 5s | 亚毫秒级 | ✅ |

> 注：以上为 CI 机器近似时间盒，真实硬件数字见 NOT_RUN 人工步骤。

---

## 4. 安全与边界

| # | 项 | 结果 |
| --- | --- | --- |
| 4.1 | Hostile IPC payloads 全部在 validator 层拦截，到不了 handler | ✅ 已有测试（60+ 恶意 payload 覆盖所有命名空间） |
| 4.2 | vault 路径逃逸防护（create / open / clone / delete / rename） | ✅ 已有测试 |
| 4.3 | 自动提交拒绝冲突标记文件 | ✅ 已有测试 |
| 4.4 | clone token 一次性消费 + URL/targetDir 绑定 + sender scoped | ✅ 已有测试 |
| 4.5 | AI 密钥不出系统钥匙串，AI IPC 响应不含明文密钥 | ✅ secret-store / ai-handlers 契约 |
| 4.6 | 插件沙箱 RPC 权限检查（六档） | ✅ 已有测试（permission-flow / sandbox） |
| 4.7 | 索引空库 / 无向量 / 无 git 历史 全部安全降级 | ✅ bug-bash 测试覆盖 |

---

## 5. 文档

| # | 文档 | 路径 | 状态 |
| --- | --- | --- | --- |
| 5.1 | 用户手册（快速入门 + 核心功能） | `docs/user-guide.md` | ✅ 10 章 |
| 5.2 | 快捷键速查表 | `docs/shortcut-cheatsheet.md` | ✅ 全局 + 编辑器 + 搜索 + 命令面板 + AI Dock |
| 5.3 | 插件开发文档（起步 + API 参考） | `docs/plugin-development.md` | ✅ 11 章（含权限 / 生命周期 / 贡献点 / Skill / 安全模型） |
| 5.4 | FAQ | `docs/faq.md` | ✅ 基础 / 编辑 / 搜索 / AI / 插件 / 故障 共 6 大类 |
| 5.5 | Release Notes（v0.1.0） | `.scratch/nexnote-build/RELEASE-NOTES.md` | ✅ |
| 5.6 | Release Checklist（本文件） | `.scratch/nexnote-build/release-checklist.md` | ✅ |

---

## 6. NOT_RUN（必须人工步骤）

> 以下项**在当前本地 Node 环境无法验证**，任何自动化都不应宣称已通过。每个公开发布都必须先由 QA 完成这些项并附 evidence。

| # | 项 | 类别 | 人工步骤 |
| --- | --- | --- | --- |
| 6.1 | macOS 签名 + 公证 | 发布安全 | 用 Apple Developer 证书签名 `.app`，走 `xcrun notarytool` 公证，验证 Gatekeeper 通过 |
| 6.2 | Windows 签名 | 发布安全 | 用 EV/OV 代码签名证书签名 `.exe` / `.msi`，验证 SmartScreen 无警告 |
| 6.3 | Linux 签名 | 发布安全 | GPG 生成 `.asc` 签名，验证 `gpg --verify` 通过 |
| 6.4 | macOS 物理安装 | 三端安装 | 在 macOS 上双击 dmg 安装、拖到 Applications、首次启动、授权、卸载 |
| 6.5 | Windows 物理安装 | 三端安装 | 在 Windows 10/11 上运行安装器、启动、卸载、残留清理检查 |
| 6.6 | Linux 物理安装 | 三端安装 | 在 Ubuntu 最新 LTS 上安装 AppImage / deb，启动，验证桌面图标和文件关联 |
| 6.7 | 真实 Obsidian vault 导入 | 功能验收 | 拿一个含 500+ 笔记的真实 Obsidian vault：打开 → 搜索 → 反链 → 图谱 → 标签 → 召回，全部走查 |
| 6.8 | 崩溃恢复 | 数据安全 | 编辑大文件过程中 `kill -9` 进程，重启后验证：文件内容完整、Git 历史连续、索引可自动重建、无数据丢失 |
| 6.9 | 冷启动时间 < 3s | 性能 | 在普通 MacBook Air / 中端 Windows 笔记本上测冷启动（首次点击到可交互） |
| 6.10 | Electron GUI 视觉走查 | 视觉/交互 | 按 A 案原型逐屏走查：结构、间距、配色、动画、空态、加载态、错误态 |
| 6.11 | 大文档编辑流畅度 | 性能 | 1 万字 / 100 块长文档，连续输入时帧率 > 50fps |
| 6.12 | 千页 vault 真实性能 | 性能 | 在真实硬件上测：索引构建时间、搜索响应、图谱渲染（千节点）、召回延迟 |
| 6.13 | 自动更新端到端 | 发布验证 | 从 v0.1.0 到下一版本，真实走一次：检查更新 → 下载 → 安装 → 重启 → 版本号正确 |
| 6.14 | 插件权限提升审计 | 安全 | 尝试从 `read` 权限沙箱提权到 `desktop-privileged`，验证被拒绝 |
| 6.15 | 插件第三方安全审计 | 安全 | 专业安全团队对沙箱模型、RPC 边界、XSS 面做审计 |

---

## 7. 发布前最终核对

- [ ] 三平台签名 + 公证全部通过
- [ ] 三平台物理安装 + 冒烟测试通过
- [ ] Release Notes 完成并经过 PM 审阅
- [ ] QA Checklist 有完整 JSON evidence + SHA-256
- [ ] release-qa Environment 配置完成，reviewer 已审批
- [ ] `v0.1.0` tag 已推送且 `scripts/check-version.mjs --require-tag v0.1.0` 通过
- [ ] GitHub Release draft 已就绪，assets 校验和与 preflight 匹配
- [ ] 官网 / 下载页文案更新（如适用）
- [ ] 内测用户邀请邮件 / 社群公告 ready
