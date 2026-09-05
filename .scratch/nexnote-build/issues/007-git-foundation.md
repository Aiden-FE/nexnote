# DEV-007 · Git 底座：自动提交与版本时间线

Type: dev
Module: git
Status: open
Blocked by: DEV-001
Depends: DEV-001
Effort: L
Priority: P0
Parallel-with: DEV-002

## Scope

搭建 Git 底座：vault 初始化 git 仓库、自动提交引擎、版本时间线 UI、远程同步（pull/push + 授权）、单篇回滚。基于 simple-git + 默认捆绑 dugite-native Git。

### 交付内容
1. **Git 基础架构**
   - simple-git 封装（主进程侧），底层使用 dugite-native 捆绑的 git
   - vault 初始化：新建 vault 自动 `git init` + 初始提交；打开文件夹检测 git 仓库，无则询问是否初始化
   - .gitignore 默认规则：`.nexnote/`（除配置外？需决策：索引不提交，配置可提交）
   - 系统 Git 回退开关：设置页「使用系统 Git」（默认关，依据 ADR 0002）

2. **自动提交引擎**
   - 防抖策略：编辑停止后 N 秒提交（默认 30s，可配）
   - 提交消息格式：机器可读前缀（供置信度解析，见 DEV-008）+ 人类可读摘要
   - 手动提交：⌘S 保存 + 可选手动提交（带消息输入）
   - 空闲批量：应用 idle 时合并微提交（减少噪声，可选）
   - 提交节流：最短间隔保护

3. **远程同步**
   - 克隆远程仓库（首启动向导的第三选项）
   - 添加/编辑远程地址
   - Pull / Push 操作（状态栏按钮 + 确认）
   - 授权预检：首次绑定远程执行 `git ls-remote` 验证连通性
   - 凭证集成：复用系统环境（~/.gitconfig、SSH_AUTH_SOCK、macOS Keychain、Windows GCM）
   - 授权失败修复引导：提示检查 SSH key / HTTPS 凭证 / 网络
   - 冲突处理 MVP：提示手动解决（状态栏标红 + 打开仓库目录），自动合并不做

4. **版本时间线 UI**
   - 抽屉或面板：左侧/底部时间线视图
   - 提交列表：提交消息、时间、作者、hash 缩写
   - 自动提交折叠分组（按时间段折叠，展开看详情）
   - 手动提交高亮标注
   - 当前 HEAD 指示
   - 单篇时间线：仅当前页面的提交历史（过滤涉及该文件的提交）

5. **单篇回滚**
   - 文件级回滚：将当前页面恢复到某个提交版本（diff 预览 + 确认）
   - Hunk 级回滚：在 diff 视图中可逐块接受回滚（MVP 先做文件级，hunk 级放 stretch）
   - 回滚 = 生成新的恢复提交（不修改历史）

6. **状态栏集成**
   - 当前分支名
   - 待提交变更数
   - 上游 ahead/behind 数
   - Pull / Push 快捷按钮
   - 点击分支名 → 切换分支 / 新建分支（MVP 可能简化）

## 关联决策
- Git 底座选型与自动提交：[git-integration.md](../../nexnote-mvp/docs/research/git-integration.md)
- 默认捆绑 Git（dugite-native）：[ADR 0002](../../nexnote-mvp/docs/adr/0002-bundled-git-by-default.md)
- 凭证 / SSH 环境集成策略：[nexnote-mvp#08](../../nexnote-mvp/issues/08-tech-architecture.md) 修订记录
- Git 产品面（状态栏 / 时间线 / 设置）：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)

## 关联原型区域
- 状态栏（分支/变更/提交/pull-push）、时间线抽屉 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（底部状态栏 + 时间线）

## 验收标准
- 新建 vault 自动完成 git init + 初始提交
- 编辑后防抖自动提交，提交消息可读
- 可添加远程仓库并完成首次授权预检
- Pull / Push 正常（至少测试 HTTPS 公共仓库 + SSH 私有仓库各一个场景）
- 版本时间线正确显示提交历史
- 单篇文件级回滚正常，生成新的恢复提交
- 状态栏实时反映分支 / 变更 / ahead-behind 状态
