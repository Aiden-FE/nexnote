# NexNote 跨平台发布 QA 清单

> 每个签名 release 都必须附此清单的**执行记录**，逐项填写【证据】。CI 通过不替代人工安装验证。
> 下述标 🔒 的项是**公开发布 gate**：signed build、packaged smoke、完整 metadata/artifact preflight 和 machine-readable evidence validation 必须先在无 Environment 权限的 `preflight` dependency job 全部通过；之后 `publish` 才进入 GitHub Actions `release-qa` Environment 等待 required reviewers 审批。审批后才获取 durable publication lease、上传 assets 并创建 Release。
> **环境配置是实际的、阻断性发布 gate：** 仓库管理员必须在 GitHub repository settings 创建 `release-qa` Environment，配置 required reviewers，并限制其 secrets/branch policy。该环境不存在、未设 reviewers、或 reviewers 未批准时，**不得启动/批准 `publish`，不得公开发布**。自动 tag-push 使用 repository variables `RELEASE_QA_EVIDENCE_URL` / `RELEASE_QA_EVIDENCE_SHA256`（受控 dispatch 使用对应 inputs）；preflight fetch/hash 并把 evidence 与本次 run/tag/commit/channel 绑定为 `release-qa-evidence-<run-id>` artifact 后，publish 才能进入 approval/lease。
> **事实边界：** 当前 DEV-018 环境未进行有真实证书/私钥的跨平台物理安装、OS 信任 UI 或 N-1 网络升级验证；这些项目绝不应被表述为已验收。自动流水线先完成签名、公证、Linux GPG `.asc`、产物 preflight 和打包 macOS smoke；随后由目标平台 QA 完成本清单、将不可变 JSON evidence 提交到 canonical repository，并获得 Environment 审批，才可公开发布。真实平台证据与 required-reviewer approval 均是不可绕过的 operational gate。

## Release record and approval evidence

- Version/tag:
- Channel (`stable` / `beta` / `alpha`):
- Immutable existing release tag (`vX.Y.Z`, exactly matching `package.json`):
- Tag commit SHA:
- Candidate workflow URL (build + smoke):
- `release-qa` approval URL, reviewer, and timestamp:
- Immutable completed QA JSON URL: `https://raw.githubusercontent.com/Aiden-FE/nexnote/<40-char-commit>/path/to/qa.json`:
- Evidence document SHA-256 (64 lowercase hex):
- `qa-all-required-checks-passed=true` attestation recorded:

## Before `release-qa` approval (all platforms)

- [ ] 推送远端 immutable `vX.Y.Z` tag 会自动触发候选流水线；tag 与 `package.json` 完全一致，且 build/smoke/publish 均 checkout 该 tag commit（不是触发分支/SHA）。受控 dispatch 只允许从同一 tag ref 重跑。
  - 证据：tag-push workflow URL、`node scripts/check-version.mjs --require-tag vX.Y.Z` 输出和 tag commit SHA。
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm verify:release-config && pnpm build` 绿色。
  - 证据：各命令退出码与测试计数。
- [ ] PR checks、三平台签名 jobs、打包 smoke 与 `preflight` dependency job 均通过，然后才允许 `release-qa` Environment 审批。
  - 证据：GitHub Actions 运行 URL、`build → smoke → preflight → publish(environment)` dependency graph 与 artifact checksums。
- [ ] preflight 包含当前 channel 对应的 `latest*.yml` / `beta*.yml` / `alpha*.yml`、至少一个 `.blockmap`，以及每个 Linux AppImage/deb 的 `.asc`。
  - 证据：preflight log 与 artifact manifest。
- [ ] `release-qa-evidence-<run-id>` artifact 已生成并验证：preflight 仅以无 redirect 的 HTTPS 请求 fetch canonical `raw.githubusercontent.com/Aiden-FE/nexnote/<40-char-commit>/...` JSON，限制 256 KiB/10 秒，计算 SHA-256 并匹配 dispatch digest；fetched JSON 的 repository/tag/commit/channel/attestation 与本次 immutable release 绑定。
  - 证据：artifact URL、immutable evidence URL/commit 和 `release-evidence.mjs validate` 输出。
- [ ] publication job 使用 fixed remote-ref lease；没有 GitHub Actions `concurrency` pending-run replacement。若 lease 超时，run 明确失败且可重跑，不会静默丢弃。
  - 证据：lease acquire/release job log。
- [ ] 仅非矩阵 `publish` job 具有 `contents: write`，并且 `needs: [prepare, preflight]`；`preflight` 等待 signed build + smoke，无 Environment gate；矩阵 build 无发布权限且只使用 `--publish never`。
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
