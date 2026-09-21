# DEV-072 应用网络设置（默认跟随系统）

- 状态：已实现并发布 0.0.22（2026-09-21），遗留清零
- 0.0.21：schema、设置页「网络」section、AI 经 undici ProxyAgent 注入（动态 import，未装 undici 时回退全局 fetch）、Git 经 env（HTTP_PROXY/HTTPS_PROXY）+ `git -c http.proxy=` 双通道注入。
- 0.0.22 补齐：`mode=system` 主进程主动探测 OS 代理（macOS `scutil --proxy` / Windows `reg query` / Linux env+gsettings，30s TTL 缓存），探测结果注入 AI 与 Git；派生逻辑抽到 `packages/main/src/settings/network-proxy.ts`（纯函数可测）。
- 测试：`system-proxy.test.ts`（解析器 10 例 + 缓存）、`network-proxy.test.ts`（派生 12 例）。
- 范围：packages/shared, packages/main, packages/renderer
- 来源：用户反馈 2026-09-21（同步链路需正确识别网络环境）

## 背景
应用目前没有任何代理/网络配置。两类网络出口：
- **AI 请求**：`packages/main/src/ai/provider/openai.ts:97` 默认走 Node 全局 fetch（undici），不读取 macOS 系统代理。
- **Git 操作**：`packages/main/src/git/git-service.ts:90-111` 调用捆绑 Git CLI，未注入 `http.proxy`/`https.proxy`；`GIT_PROXY_COMMAND` 在净化 env 时被主动剥离。

导致在企业代理/SS 环境下 AI 与同步都不可用。Chromium 会话默认会跟随系统代理（`packages/main/src/window.ts:63-81` 不创建独立 partition），但 AI/Git 路径不受益。

## 方案
1. `packages/shared/src/types/settings.ts` 新增 `GlobalSettings.network` 块：
   - `mode: 'system' | 'http' | 'https' | 'socks5' | 'off'`（默认 `system`）
   - `host?: string`, `port?: number`, `username?: string`, `password?: string`, `bypass?: string[]`
   - `applyToAi: boolean`（默认 true），`applyToGit: boolean`（默认 true）
2. `packages/renderer/src/features/settings/` 注册 `network` section（order 15，位于「常规」与「编辑器」之间）；提供三段 UI：
   - **模式**：跟随系统 / 自定义 / 关闭（默认「跟随系统」）
   - **地址**：主机/端口/账号/绕过列表（自定义时展开）
   - **生效范围**：AI / Git 勾选（默认都勾）
3. `system` 模式实现：主进程读 OS 代理（macOS `scutil --proxy` / Windows 注册表 `ProxyEnable` / Linux `gsettings`），失败则降级为 env 变量并记录日志。
4. **AI 注入**：`packages/main/src/ai/provider/openai.ts` 注入 `undici` `ProxyAgent` 作为全局 `dispatcher`（取代当前直接用 `globalThis.fetch`）。
5. **Git 注入**：`packages/main/src/git/git-service.ts` 根据 `network` 设置：
   - `system` 模式：通过 env 把 `http_proxy`/`https_proxy`/`GIT_PROXY_COMMAND` 注入到子进程 env；
   - 自定义模式：使用 `git -c http.proxy=... -c https.proxy=...` 命令前缀（避免污染仓库 `~/.gitconfig`）。
6. `network` 模式/凭证变更时持久化到 `userData/nexnote-settings.json`（已有 `settings-service.ts` 流程，新增 entry + 校验）。

## 行为保持
- 默认 `mode=system`：开箱即用，且不破坏直连用户。
- 凭证仅保存在本机 `userData`（无云同步），与现有 `git` 块一致。
- 不动 Chromium 会话默认行为。

## 验收
- [ ] 跟随系统模式下，企业代理环境下 AI 流式响应 200 OK（直连用户无差异）
- [ ] 跟随系统模式下，`git ls-remote` / `fetch` / `pull` / `push` 经系统代理成功
- [ ] 自定义模式下，AI 与 Git 各自能用不同代理
- [ ] 关闭模式下，AI 与 Git 不走任何代理
- [ ] 凭证以受控字段写入 settings 文件，不出现在日志/IPC 错误信息
- [ ] 单元测试覆盖：解析 OS 代理、env 注入、git -c 前缀构建
- [ ] `pnpm typecheck` 0 errors；`pnpm lint` 0 errors
