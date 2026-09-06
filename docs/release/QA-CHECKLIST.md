# NexNote 跨平台发布 QA 清单

> 每个签名 release 都必须附此清单的**执行记录**，逐项填写【证据】。CI 通过不替代人工安装验证。
> 下述标 🔒 的项是**公开发布 gate**：在 GitHub Actions `release-qa` Environment 审批前必须全部完成、将证据链接粘贴到审批记录，并由该 Environment 的 required reviewers 批准。`publish` 是唯一创建公开 GitHub Release 的 job，必须等待此审批；审批后才上传 release assets 和生成 Release notes。
> **环境配置是必需的：** 仓库管理员必须创建 `release-qa` Environment，配置 required reviewers，并限制其 secrets/branch policy。没有该保护规则不得触发公开发布。
> **事实边界：** 当前 DEV-018 环境未进行有真实证书/私钥的跨平台物理安装、OS 信任 UI 或 N-1 网络升级验证；这些项目绝不应被表述为已验收。自动流水线先完成签名、公证、Linux GPG `.asc`、产物 preflight 和打包 macOS smoke；随后由目标平台 QA 完成本清单、附证据并获得 Environment 审批，才可公开发布。

## Release record and approval evidence

- Version/tag:
- Channel (`stable` / `beta` / `alpha`):
- Commit SHA:
- Candidate workflow URL (build + smoke):
- `release-qa` approval URL, reviewer, and timestamp:
- Completed checklist evidence location (issue/comment/document URL):

## Before `release-qa` approval (all platforms)

- [ ] 版本满足 SemVer，tag 与 `package.json` 完全一致（`vX.Y.Z`）。
  - 证据：`pnpm version:check` 输出 + `git tag`。
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm verify:release-config && pnpm build` 绿色。
  - 证据：各命令退出码与测试计数。
- [ ] PR checks、三平台签名 jobs、打包 smoke 与完整产物 preflight 均通过。
  - 证据：GitHub Actions 运行 URL、job dependency graph 与 artifact checksums。
- [ ] 仅非矩阵 `publish` job 具有 `contents: write`，并且 `needs: [build, smoke]`；矩阵 build 无发布权限且只使用 `--publish never`。
  - 证据：本次 workflow 文件 SHA 与 job dependency graph。
- [ ] 所有 `uses:` action 都由完整 immutable commit SHA pin；Dependabot GitHub Actions 更新 PR 已审查。
  - 证据：workflow diff 和 Dependabot PR URL。
- [ ] 仓库不含 API key、证书、`.env`、`CSC_*` 或 Apple 凭据（含 secret 无泄漏）。
  - 证据：secret scanning 结果与人工检查。

## macOS（arm64 与 x64）

1. [ ] 下载 DMG，拖入 Applications，首次启动无 Gatekeeper 警告。 🔒
   - 证据：安装后 `spctl -a -vv /Applications/NexNote.app` 输出 + 首次启动截图。
2. [ ] `codesign --verify --deep --strict /Applications/NexNote.app` 成功。 🔒
   - 证据：该命令输出包含 `: valid on disk` 与 `satisfies its Designated Requirement`。
3. [ ] Apple notarization ticket 已 stapled。 🔒
   - 证据：`xcrun stapler validate /Applications/NexNote.app` 成功，`spctl -a -vv` 显示 `accepted`；CI `afterSign` 不允许缺少 Apple 凭据时跳过公证。
4. [ ] 打开/新建 vault，编辑保存、Git（init/commit/timeline/rollback）、AI 配置与自动更新检查均正常。 🔒
   - 证据：每项功能操作截图 + 结论。
5. [ ] 从已发布的 N-1 版本检查到候选新版本、下载、重启安装后版本号正确。 🔒
   - 证据：升级前/后 `app:getInfo` 版本号、安装日志。

## Windows 11 x64

1. [ ] NSIS 安装、卸载、portable 版本均可启动。 🔒
   - 证据：安装向导截图、安装后开始菜单/桌面快捷方式、卸载日志。
2. [ ] Authenticode 签名验证通过，SmartScreen 状态如实记录。 🔒
   - 证据：`Get-AuthenticodeSignature NexNote.exe` `Status` 为 `Valid`；文件属性「数字签名」页截图。
3. [ ] WebView、文件对话框、Git 二进制、系统凭据、更新下载/重启安装正常。 🔒
   - 证据：各功能截图 + 更新日志。

## Ubuntu 22.04+ x64

1. [ ] AppImage 与 deb 的 detached armored GPG 签名验证成功。 🔒
   - 证据：`gpg --verify <artifact>.asc <artifact>` 输出与签名 key fingerprint。
2. [ ] AppImage（`chmod +x`）与 deb 安装均可启动。 🔒
   - 证据：AppImage 启动截图与 `dpkg -i` 日志。
3. [ ] `.desktop` 项、图标、Markdown 关联与 `nexnote://` URL scheme 可用。 🔒
   - 证据：桌面菜单项、`xdg-mime query default text/markdown`、URL 打开截图。
4. [ ] libsecret/keyring 可用时 AI key 加密；不可用时应用提示而非明文落盘。 🔒
   - 证据：`~/.config/NexNote/*.json` 中无 `plain:`/明文 key；备选环境提示截图。
5. [ ] Git、更新检查、卸载（deb）正常。 🔒
   - 证据：各操作日志。

## 回滚与渠道（跨平台）

- [ ] stable/beta/alpha 只读取对应 `latest*.yml`，不得跨渠道降级。 🔒
  - 证据：设置页切换通道后的更新源 URL 日志。
- [ ] 设置中选择的更新通道在完全退出并重启后仍保持，主进程 updater 启动时恢复该持久化值。 🔒
  - 证据：重启前后设置页与 updater 状态事件的 channel。
- [ ] 更新失败显示可重试错误，不破坏现有应用。 🔒
  - 证据：断网/错误源触发的错误提示截图 + 重试恢复日志。
- [ ] 回滚/恢复程序已经演练或为本候选版本明确记录。 🔒
  - 证据：步骤、操作者、结果与恢复日志。

## After public publication (monitoring, not a publication gate)

- [ ] 发布后 24 小时监控 GitHub Release assets、下载失败率与崩溃报告。
  - 证据：发布后 Dash/哨兵统计截图。

## Current validation limitation

macOS Developer ID/公证、Windows Authenticode/SmartScreen、Windows/Linux 实体安装，以及从公开 N-1 Release 的真实网络升级，在当前环境均**未验证**。这些项目必须在 `release-qa` Environment 审批前由目标系统 QA 以本清单的证据闭环；若无法完成，则不得批准或运行 `publish`，也不得在 Release notes 中声称已验收。

## Related files

- 实施记录：`.scratch/nexnote-build/worklogs/DEV-018.md`
- 打包配置：`electron-builder.yml`
- 更新策略实现：`packages/main/src/updater.ts`
- 更新设置 UI：`packages/renderer/src/features/settings/update-section.tsx`
- CI：`.github/workflows/release.yml`、`pr-check.yml`、`nightly.yml`
