---
status: accepted
---

# Git 绑定策略：默认捆绑 Git + 系统凭证集成 + 系统 Git 高级回退

ADR 0001（经 03 号票研究）初定「系统 git 优先（≥2.23），不满足时回退 dugite-native 捆绑 git」。产品评审后修订为**默认捆绑**：Git 版本矩阵固定、三平台 QA 可复现、不受用户环境差异影响（VS Code 同模式）；远程授权问题改由「复用系统凭证与 SSH 环境」而非「复用系统 Git 二进制」解决。本 ADR 取代 ADR 0001 中的 Git 绑定条款。

## Decision

1. **默认捆绑**：始终通过 simple-git `.customBinary()` 调用应用内捆绑 Git（dugite-native 资产），不依赖系统 Git。
2. **凭证集成**：读取用户级 `~/.gitconfig`；主进程继承 `HOME` / `SSH_AUTH_SOCK` / 受控 `GIT_SSH_COMMAND`；支持 ssh-agent、macOS Keychain、Windows Git Credential Manager；Renderer 进程不接触任何凭证/token/私钥。
3. **授权预检**：首次绑定远程执行无写入验证（`git ls-remote`）；成功提示「已复用现有授权」，失败给出修复路径（用系统 Git 完成一次授权 / 配置 SSH / GCM 登录 / 指定自定义 Git 路径）。
4. **高级回退**：设置页保留「使用系统 Git」开关（默认关）——企业自定义 CA、硬件安全密钥、特殊 credential helper 的逃生出口。

## Considered Options

- **系统 git 优先 + 捆绑回退**（原 03 号票推荐）：行为矩阵不可控（用户 Git 版本/配置差异直接进入支持负担），授权边缘案例反而更难定位；否决为默认路线。

## Consequences

- 安装包体积增加（各平台压缩 27–45MB）；Git 安全更新节奏与应用发布绑定。
- GPLv2 随附合规义务不变（进程隔离 + 随附许可文本 + source offer）。
- 授权边缘案例（企业自定义 helper、plink/GIT_SSH 包装、代理 CA）经「系统 Git」开关兜底，主路径保持可控。
