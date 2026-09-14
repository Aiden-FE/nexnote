# NexNote v0.1.0 Release Checklist

> 适用于 `dev/DEV-019` 分支基线 00c858c 的 DEV-019 集成验收。每项标注 ✅（已通过 / 可复现）、⚠️（部分验证）、❌（未通过）、`NOT_RUN`（当前环境无法验证，必须人工完成）。
> 本文件保留历史集成验收证据；公开发布时以 [`docs/release/QA-CHECKLIST.md`](../../docs/release/QA-CHECKLIST.md) 的当前 gate 和 evidence 要求为准。

---

## 1. 代码质量门禁

| # | 项 | 命令 | 结果 | 备注 |
| --- | --- | --- | --- | --- |
| 1.1 | 全 workspace typecheck | `CI=true pnpm -r typecheck` | ✅ 全绿 | 5 个包（shared / plugin-api / kernel / renderer / main）全部通过；main 包无 typecheck 脚本，其 `tsc --noEmit` 基线错误 1 个（`secret-store.ts` 中 `Entry` TS2304），与 master 一致 |
| 1.2 | 单元 + 集成测试 | `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test` | ✅ 74 文件通过（1 文件 skipped）/ 616 测试通过（2 skipped） | 新增 3 个文件（e2e-integration / perf-timebox / bug-bash），共 13 个新用例 |
| 1.3 | ESLint | `CI=true pnpm exec eslint .` | ✅ 全绿 | 无警告无错误 |
| 1.4 | Production build | `CI=true pnpm build` | ✅ | electron-vite 三端构建通过；最大 bundle `index-*.js` ~3.4MB |
| 1.5 | Release config 校验 | `node scripts/verify-release-config.mjs` | ✅ 28/28 checks passed | 含 immutable SHA pin、dugite GPL、updater 状态机、PR gate 覆盖等 |
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

测试环境：本地 Node / M 系列 macOS / better-sqlite3 同步。**不是 benchmark，是数量级时间盒，防止 O(n²) 回归。**

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

> 注：以上为 CI 机器近似时间盒，不是跨平台安装、签名或网络升级证据；真实硬件数字和发布 gate 见 `NOT_RUN` 与当前 QA 清单。

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
| 4.7 | 索引空库 / 无向量 / 无 git 历史全部安全降级 | ✅ bug-bash 测试覆盖 |

---

## 5. 文档

| # | 文档 | 路径 | 状态 |
| --- | --- | --- | --- |
| 5.1 | 用户手册（快速入门 + 核心功能） | `docs/user-guide.md` | ✅ 10 章 |
| 5.2 | 快捷键速查表 | `docs/shortcut-cheatsheet.md` | ✅ 全局 + 编辑器 + 搜索 + 命令面板 + AI Dock |
| 5.3 | 插件开发文档（起步 + API 参考） | `docs/plugin-development.md` | ✅ 11 章（含权限 / 生命周期 / 贡献点 / Skill / 安全模型） |
| 5.4 | FAQ | `docs/faq.md` | ✅ 基础 / 编辑 / 搜索 / AI / 插件 / 发布安装更新 / 故障 |
| 5.5 | Release Notes（v0.1.0） | `.scratch/nexnote-build/RELEASE-NOTES.md` | ✅ 已补齐分发边界与 NOT_RUN |
| 5.6 | Release Checklist（本文件） | `.scratch/nexnote-build/release-checklist.md` | ✅ 保留历史证据并链接当前 QA gate |

---

## 6. NOT_RUN（必须人工步骤）

> 以下项**在当前本地 Node 环境无法验证**，任何自动化都不应宣称已通过。没有签名、真实平台安装或 N-1 网络升级 evidence，不得批准公开发布。

| # | 项 | 类别 | 人工步骤 |
| --- | --- | --- | --- |
| 6.1 | macOS Ad hoc 签名与首次安装 | 发布/安装 | 在 Intel 与 Apple Silicon macOS 上分别安装对应 DMG/ZIP，记录签名模式、首次启动、Gatekeeper 隔离和首次 `xattr -d com.apple.quarantine` 结果 |
| 6.2 | macOS 公证/Gatekeeper | 分发边界 | 当前包明确未公证；不得声称 notarization 或 Gatekeeper 无警告。若策略改变，另行完成公证和 OS 信任验证 |
| 6.3 | Windows NSIS 安装与签名 | 发布安全 | 在 Windows 11 x64 上运行 NSIS、启动、卸载、重装，并记录 Authenticode/SmartScreen；portable 仅额外手动格式 |
| 6.4 | Ubuntu AppImage/deb 安装与签名 | 发布安全 | 以 AppImage 作为自动更新主路径，另行验证 deb 手动安装和实际 `.asc`；不得把 deb 结果写成自动更新通过 |
| 6.5 | N-1 真实网络升级 | 发布验证 | 从公开 N-1 版本验证 Windows NSIS、Ubuntu AppImage 自动更新；macOS 验证失败时是否转 GitHub Releases 手动下载 |
| 6.6 | 失败重试/暂停 feed/前滚修复/人工旧版恢复 | 恢复演练 | 按 `docs/release/QA-CHECKLIST.md` runbook 演练，记录错误、操作者、asset/feed、恢复版本和结果 |
| 6.7 | 真实 Obsidian vault 导入 | 功能验收 | 拿一个含 500+ 笔记的真实 Obsidian vault：打开 → 搜索 → 反链 → 图谱 → 标签 → 召回，全部走查 |
| 6.8 | 崩溃恢复 | 数据安全 | 编辑大文件过程中 `kill -9` 进程，重启后验证：文件内容完整、Git 历史连续、索引可自动重建、无数据丢失 |
| 6.9 | 冷启动时间 < 3s | 性能 | 在普通 MacBook Air / 中端 Windows 笔记本上测冷启动（首次点击到可交互） |
| 6.10 | Electron GUI 视觉走查 | 视觉/交互 | 按 A 案原型逐屏走查：结构、间距、配色、动画、空态、加载态、错误态 |
| 6.11 | 大文档编辑流畅度 | 性能 | 1 万字 / 100 块长文档，连续输入时帧率 > 50fps |
| 6.12 | 千页 vault 真实性能 | 性能 | 在真实硬件上测：索引构建时间、搜索响应、图谱渲染（千节点）、召回延迟 |
| 6.13 | 自动更新端到端 | 发布验证 | 按当前平台主路径真实走一次：Windows NSIS、Ubuntu AppImage 自动更新；macOS 记录 Ad hoc 手动 GitHub Releases 路径 |
| 6.14 | 插件权限提升审计 | 安全 | 尝试从 `read` 权限沙箱提权到 `desktop-privileged`，验证被拒绝 |
| 6.15 | 插件第三方安全审计 | 安全 | 专业安全团队对沙箱模型、RPC 边界、XSS 面做审计 |

---

## 7. 发布后观察（不是发布 gate）

- [ ] 发布后至少 24 小时观察 GitHub Release assets 是否齐全、下载失败、feed 可用性和崩溃报告。
- [ ] 异常按当前 QA 清单记录，并选择暂停 feed、前滚修复或人工旧版恢复；不删除 immutable tag 作为临时回滚手段。

## 8. 发布前最终核对

- [ ] macOS Ad hoc / 未公证、Windows/Ubuntu 签名状态和所有 `NOT_RUN` 项均在 Release notes 中如实标注
- [ ] macOS Intel/arm64、Windows NSIS、Ubuntu AppImage 主路径 evidence 齐全；portable/deb 作为额外手动格式单独记录
- [ ] QA Checklist 有完整 JSON evidence + SHA-256
- [ ] release-qa Environment 配置完成，reviewer 已审批
- [ ] `v0.1.0` tag 已推送且 `scripts/check-version.mjs --require-tag v0.1.0` 通过
- [ ] GitHub Release assets 校验和与 preflight 匹配
- [ ] 官网 / 下载页文案更新（如适用）
- [ ] 内测用户邀请邮件 / 社群公告 ready
