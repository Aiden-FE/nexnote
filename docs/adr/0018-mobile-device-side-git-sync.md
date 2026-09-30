# ADR-0018 手机端设备端 Git 同步（窄口径）

- 状态：accepted
- 日期：2026-09-30
- 关联：ADR-0017

## 背景

ADR-0017 选定手机端为 Flutter 独立客户端后，「手机端是否承担 Git 运算」成为悬置问题。桌面 Git 层（`packages/main/src/git`）依赖 `simple-git` spawn 真实 git CLI 与 `dugite` 捆绑二进制，移动端无法平移；`docs/research/git-integration.md` 已否决 isomorphic-git 作主引擎（无 SSH、无协议 v2、无 rebase merge、大库内存受限，Obsidian Mobile 实测 very unstable）。

## Decision

手机端通过 git2dart（libgit2 的 Dart FFI 绑定）直接对 Git 远程执行设备端同步，一致性口径收窄为：

- 本地：init / commit / log / status
- 同步：fetch / push，pull 由 rebase 编排；ahead/behind 自建
- 凭证：iOS Keychain + HTTPS token 为首选；SSH 用内存 keypair + 显式 host key 校验
- 冲突：检测到 conflict 或 rebase-in-progress 即禁写，并提示回桌面端处理
- 不做：桌面端的 doctor 修复、`format-patch` 备份、隔离索引提交与 sync guard 细节

## Considered Options

- **桌面伴生模式（手机端不持有 Git 仓库）**：要求桌面端常在线，与手机端「完全独立」的定位冲突，否决。
- **isomorphic-git**：纯 JS，无 SSH / 无协议 v2 / 无 rebase merge，Obsidian Mobile 实测严重受限，否决。
- **完整平移桌面同步流水线**：libgit2 无 `git format-patch` / `git am` 等价原语，doctor 修复语义无法等价，成本过高，否决。
- **Capacitor / Web 方案**：见 ADR-0017。

## Consequences

- 手机端不与桌面端通信，因此不需要为移动端新增 HTTP/WS API；桌面端零改动，跨端复用收敛为行为语义而非代码。
- 风险集中在 git2dart 生态薄（无生产级第三方先例，仅官方 demo），需先以真机垂直切片验证 clone / commit / push 再推进其余能力。
- 桌面 `preserve-local-and-abort` 的实现（仅 `format-patch` 备份 + abort）与 ADR-0016 描述的 `format-patch → am 回放` 不一致，需另行对齐，属移动端范围外的跟进项。
