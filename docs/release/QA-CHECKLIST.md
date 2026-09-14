# NexNote 跨平台发布 QA 清单

> 每个候选 release 都必须附此清单的执行记录，逐项填写【证据】。CI、打包 smoke 或单元测试通过不替代真实平台安装和升级验证。
> `NOT_RUN` 必须保留到对应证据可复现为止；没有签名、真实平台安装或 N-1 网络升级证据，不得声称发布 QA 已完成，也不得在 Release notes 中写成“已验证”。
> 本清单只描述发布操作和验收边界，不改变 `.github/workflows/release.yml`、updater 或产物命名。

## 事实边界与分发策略

- 当前 macOS 发布包是 **Ad hoc 签名、未公证**；它不是 Developer ID 分发包。Gatekeeper 隔离、首次启动需要清除 quarantine 属性，属于用户可见的安装步骤，不得写成“无警告”或“已公证”。
- macOS 同时提供 Intel（x64）和 Apple Silicon（arm64）包。下载和安装前必须核对机器架构；不要用一个架构的包替代另一个架构的包。
- macOS Ad hoc 包不能依赖应用内自动安装更新。应用内更新入口无法自动安装时，主路径是打开 GitHub Releases，用户手动下载对应架构的 DMG/ZIP 并安装。
- Windows 的主自动更新路径是 **NSIS installer**；Ubuntu 的主自动更新路径是 **AppImage**。Windows `portable` 和 Ubuntu `deb` 是额外的手动分发格式，不是自动更新主路径。
- “构建成功”“metadata 存在”“smoke 通过”只能证明机器可检查的部分。无真实签名、真实平台安装或从公开 N-1 版本的网络升级证据时，必须写 `NOT_RUN`。

## Release record and approval evidence

- Version/tag:
- Channel (`stable` / `beta` / `alpha`):
- Immutable release tag (`vX.Y.Z`, exactly matching `package.json`):
- Tag commit SHA:
- Candidate workflow URL:
- `release-qa` approval URL, reviewer, and timestamp:
- Immutable completed QA JSON URL:
- Evidence document SHA-256:
- `qa-all-required-checks-passed=true` attestation:
- 当前未验证项及责任人/计划完成时间:

## Before `release-qa` approval（所有平台）

- [ ] `vX.Y.Z` tag 与 `package.json` 完全一致；候选构建、smoke、preflight 和 publish 均绑定同一个 immutable commit。
  - 证据：workflow URL、`node scripts/check-version.mjs --require-tag vX.Y.Z` 输出、tag commit SHA。
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm verify:release-config && pnpm build` 绿色。
  - 证据：命令退出码、测试计数和构建日志。不能以这些结果替代平台安装/升级证据。
- [ ] PR checks、候选构建、打包 smoke、artifact/metadata preflight dependency job 均通过；这些 machine-checkable gate 全部通过后，才进入 `release-qa` Environment 审批。
  - 证据：Actions dependency graph、artifact manifest 和校验和。
- [ ] 当前 channel 的更新清单、`.blockmap`、macOS 双架构包、Windows NSIS 包、Ubuntu AppImage 均存在且与 tag/version 对应；portable/deb 作为额外手动格式单独记录。
  - 证据：Release asset 列表和 SHA-256 manifest。
- [ ] QA evidence 是 immutable、可复现的 JSON，并绑定本次 tag、commit、channel 和所有必需检查的 attestation。
  - 证据：evidence URL、digest、validator 输出。
- [ ] 任何签名、安装或 N-1 升级项目若不能在目标平台真实执行，均标 `NOT_RUN`，不得审批为“全部完成”。

## macOS（Intel x64 与 Apple Silicon arm64）

1. [ ] 下载与机器架构匹配的 DMG/ZIP，并记录 `x86_64` 或 `arm64`。 🔒
   - 证据：Release asset 名称、`uname -m`、下载 SHA-256。
2. [ ] 使用 DMG 拖入 Applications；首次启动时如 macOS 提示应用来自未知开发者/被隔离，按内部安装说明执行：
   `xattr -d com.apple.quarantine /Applications/NexNote.app`，再启动并记录结果。 🔒
   - 证据：首次启动前后的终端输出/截图。没有真实 macOS 安装记录则为 `NOT_RUN`。
3. [ ] 明确记录本候选为 **Ad hoc、未公证**。不得使用 `spctl accepted`、“Gatekeeper 无警告”或“Apple notarization 已完成”等措辞；如需验证签名，仅记录实际 `codesign` 结果。 🔒
   - 证据：签名模式、构建日志和安装观察；没有签名材料或目标平台证据则为 `NOT_RUN`。
4. [ ] 打开/新建 vault，编辑保存、Git（init/commit/timeline/rollback）、AI 配置和更新检查正常。 🔒
   - 证据：按架构分别记录操作结果。
5. [ ] 从公开 N-1 版本发起真实网络升级；若应用内不能自动安装，确认按钮/提示会转到 GitHub Releases，手动下载正确架构包并完成安装。 🔒
   - 证据：N-1 与候选版本、网络 feed、下载、重启/手动安装日志。无公开 N-1 或未执行时标 `NOT_RUN`。

## Windows 11 x64

1. [ ] 以 **NSIS installer** 作为主路径完成安装、启动、卸载和重装。 🔒
   - 证据：安装向导、开始菜单/桌面快捷方式、卸载日志。`portable` 仅作为额外手动格式记录，不替代 NSIS 验收。
2. [ ] 从公开 N-1 版本检查更新、下载、重启安装，确认版本号正确。 🔒
   - 证据：更新前后版本号、NSIS 安装日志和真实网络记录；未执行则为 `NOT_RUN`。
3. [ ] 记录 Authenticode/SmartScreen 实际结果；没有签名证据不得声称“已签名”或“无 SmartScreen 警告”。 🔒
   - 证据：`Get-AuthenticodeSignature` 输出和文件属性截图。
4. [ ] WebView、文件对话框、Git、系统凭据和更新失败后的重试正常。 🔒
   - 证据：功能操作和失败/重试日志。

## Ubuntu 22.04+ x64

1. [ ] 以 **AppImage** 作为主路径：`chmod +x` 后启动、退出和再次启动正常。 🔒
   - 证据：启动截图/日志。AppImage 是自动更新主路径。
2. [ ] 从公开 N-1 版本经真实网络检查、下载、重启并完成 AppImage 自动更新，确认版本号正确。 🔒
   - 证据：N-1/候选版本、feed、下载和重启日志；未执行则为 `NOT_RUN`。
3. [ ] `deb` 安装作为额外手动格式验证（`dpkg -i`、启动、卸载）；不得把 deb 手动安装结果写成自动更新已验证。 🔒
   - 证据：`dpkg -i` 日志和启动截图。
4. [ ] `.desktop` 项、图标、Markdown 关联、`nexnote://` URL scheme、Git 和 keyring 行为正常。 🔒
   - 证据：桌面菜单、`xdg-mime`、URL 和 keyring 日志。
5. [ ] 如发布要求 Linux 签名，记录实际 `.asc` 验证；没有 GPG 证据不得声称 Linux 产物已签名。 🔒
   - 证据：`gpg --verify <artifact>.asc <artifact>` 和 key fingerprint。

## 失败处理、回滚与渠道 runbook

- [ ] **失败重试**：记录失败阶段、错误信息和原始 asset/feed URL；先保持当前安装可用，修复网络或配置后重试检查/下载，不重复覆盖已下载但未确认的更新。
- [ ] **暂停 feed**：确认问题版本不再作为对应 channel 的可下载候选；暂停或撤下该 channel feed/Release asset 前记录操作者、时间、受影响 channel 和恢复条件。暂停 feed 不等于删除 Release 或篡改 immutable tag。
- [ ] **前滚修复**：优先构建并发布修复版本，更新同一 channel 的 metadata；记录修复版本、校验和、影响范围，以及从受影响版本到修复版本的验证结果。
- [ ] **人工旧版恢复**：当自动更新不可用或版本有问题时，从 GitHub Releases 选择已知可用旧版，核对架构、tag 和 SHA-256，手动安装并确认 vault 未被破坏；记录恢复前后版本和操作者。
- [ ] stable/beta/alpha 只使用对应 channel 的 feed，不跨 channel 降级；切换 channel 后完全退出并重启，确认设置仍保持。
- [ ] 更新失败显示可重试错误且不破坏现有应用；若 macOS 无法自动安装，必须提供 GitHub Releases 手动下载路径。
  - 证据：断网/错误源、重试成功或人工恢复日志。

## After public publication (monitoring, not a publication gate)

- [ ] 发布后至少 24 小时观察 GitHub Release asset 是否齐全、下载失败/HTTP 错误、更新 feed 可用性和崩溃报告。
- [ ] 每个异常记录发现时间、asset/平台/channel、影响范围、处置（暂停 feed、前滚修复或人工旧版恢复）和关闭时间。
  - 证据：Release asset 检查、下载统计、崩溃监控/工单链接。

## Current validation limitation

当前工作环境未进行 macOS 真实 Ad hoc 安装与首次 `xattr`，也未进行 Windows/Ubuntu 跨平台物理安装；可用签名材料验证和从公开 N-1 Release 的真实网络升级同样未完成。因此这些项目保持 `NOT_RUN`；现有构建、单测和 smoke 证据不得替代它们。没有补齐证据前，不得声称无签名/真实平台安装/N-1 网络升级已完成，也不得在 Release notes 中声称已验收。

## Related files

- Release notes：`.scratch/nexnote-build/RELEASE-NOTES.md`
- 历史验收记录：`.scratch/nexnote-build/release-checklist.md`
- 实施记录：`.scratch/nexnote-build/worklogs/DEV-018.md`
- 打包配置：`electron-builder.yml`
- 更新策略实现：`packages/main/src/updater.ts`
- CI：`.github/workflows/release.yml`
