# DEV-022 · 页签拖拽排序与切换快捷键

Type: dev
Module: shell
Status: closed
Blocked by: 无（可立即开始）
Depends: 无
Effort: M
Priority: P1

## Scope

落实验收反馈「页签无法自由拖动排序」。TabStrip 现状仅点击/右键菜单/中键关闭，无拖拽、无 tab 间切换快捷键。本票一次交付两个互补交互：**栈内拖拽排序**与 **Ctrl+Tab / Ctrl+Shift+Tab 循环切换**。

### 交付内容

#### 1. 拖拽排序

- HTML5 原生 drag & drop 实现（`draggable` + `dataTransfer`，参考页面树与图谱节点已有拖拽模式），**不引入新依赖**。
- 仅支持同一 tab 栈内重排；拖拽悬停时给出插入位置反馈；drop 后立即生效。
- tab-store 新增 reorder action（按 id 移动到目标下标）；重排后的顺序进入现有布局持久化，在已有 tab 栈的知识库重开/布局恢复路径中保留。应用当前不跨重启恢复 tab 会话；`tabOrder` 为后续 tab 会话恢复能力预留，不在本票扩张会话持久化范围。
- 与既有交互不冲突：拖拽不得破坏单击激活、中键关闭、右键菜单、`+` 新建；溢出滚动场景下拖拽仍可用。

#### 2. 切换快捷键

- `Ctrl+Tab` / `Ctrl+Shift+Tab`（macOS 同键位）在 tab 栈内循环切换激活页签。
- 在 shared 默认快捷键表登记，进入快捷键设置分区展示，沿用现有可自定义快捷键体系。
- 焦点在输入框/编辑器内时快捷键仍然生效（tab 切换属全局级快捷键语义）。

## 安全不变量（继承全局约束）

- renderer 不直访 Node `fs`，所有文件读写经既有 IPC 通道。
- secrets 不进日志与产物。
- 未真实运行的 GUI / 三平台 / 真实网络验收必须标 `NOT_RUN`，不得用单测或构建成功冒充。

## 验收标准

功能：

1. 拖动任一页签到新位置，顺序立即更新；关闭并重新打开同一知识库且已有 tab 栈时，持久化 `tabOrder` 可正确重排现有页签。应用当前不跨重启恢复 tab 会话，跨应用重启的 tab 集合与顺序不作为本票验收项。
2. `Ctrl+Tab` / `Ctrl+Shift+Tab` 正反向循环切换；到达末尾回绕。
3. 拖拽与单击激活、中键关闭、右键菜单、`+` 新建互不干扰。
4. 页签溢出出现滚动时，拖拽到视野外目标位置可完成（自动滚动或等价能力）。
5. 快捷键设置分区展示新绑定且可改键；改键后新绑定生效。

门禁（全部在候选 SHA 上执行并留证）：

6. `pnpm -r typecheck`
7. `env -u GIT_EDITOR -u GIT_SEQUENCE_EDITOR -u EDITOR CI=true pnpm test`（**单元测试全绿**；新增 tab-store reorder 单测）
8. `pnpm lint`
9. `pnpm build`
10. `node scripts/verify-release-config.mjs`
11. `bash scripts/check-changed-format.sh master`
12. `git diff --check master...HEAD`
13. **Electron smoke e2e 全绿**，且新增覆盖：拖拽重排后顺序持久化、快捷键循环切换。

流程：

14. 在 `.wt/DEV-022` / `dev/DEV-022` 隔离实现，`master` 不直接编码。
15. 固定候选 SHA 上通过全新 Standards 与 Spec 双轴审查（无 blocker / major）后才 `git merge --no-ff`。
16. 合并后在 `master` 复跑门禁与 Electron smoke，并更新 README 与 checkpoint 登记。

## 关联决策

- 交互模式参考：页面树拖拽（DEV-003）、图谱节点拖拽（既有实现）
