# MOB-002 git2dart 真机可行性验证（降级闸门）

Ticket: MOB-002 · Milestone: M1 · Branch: dev/MOB-002 · Depends: MOB-001
ADR: docs/adr/0018-mobile-device-side-git-sync.md
Status: go —— 已于 iOS 模拟器（iPhone 17 Pro / iOS 26.5）验证通过 2026-09-30

## 目标

用最小切片证伪或证实「手机端可独立完成 Git 同步」。本票是全案的降级闸门：结论必须显式写回地图。

## 行为

1. 接入 git2dart（记录 `pubspec` 锁定版本，当前候选 0.5.6 与对应 `git2dart_binaries`），在应用启动路径调用 `PlatformSpecific.initialize()`。
2. 在 app 私有目录内完成：`clone` 一份脱敏 vault 副本 → 修改一个页面 → 本地 `commit`（消息带 `nexnote:manual:` 前缀）→ `push` 到测试远端。
3. 记录凭证注入方式与实际结果：HTTPS token（从 iOS Keychain 读取后注入 `Callbacks.credentials`）优先；SSH（内存 keypair + `certificateCheck`）作为对照项，二者各自记录成功或失败。
4. 在真机上记录实测数据：clone 耗时与内存占用、commit/push 耗时、失败模式（网络中断、凭证错误、host key 校验失败）。
5. 产出 go / no-go 结论并写回 `map.md`：go 则继续 MOB-003/004；no-go 则触发降级闸门（半独立）。

## 边界

- 不复刻桌面端同步流水线（不含 autoSync、rebase 编排、doctor）。
- 不使用用户真实 vault 本体写操作；只用脱敏副本与测试远端。

## 验收

- 真机上 clone / 本地 commit / push 全链路成功，桌面端 `git log` 能看到该提交（附提交 SHA）。
- `PlatformSpecific.initialize()` 的位置与被 iOS 生命周期调用的证据（日志）。
- 记录「不可用项清单」：SSH 与 HTTPS 各自的实测结果，以及任何 libgit2 语义差异。
- 若指出 0.5.6 存在阻塞缺陷，必须给出可复现步骤与原始日志。

## 结论（go）

`flutter test integration_test/git_spike_test.dart -d <sim>` 全绿（2/2），在 iOS 运行时真实执行：

- `PlatformSpecific.initialize()` 正常，iOS 侧 libgit2 符号可用
- `clone` 本机 bare 远端成功；clone 后工作区干净、分支为 `main`
- 本地 `commit` 成功，时间线 `kind` 正确解析为 `manual`，`nexnote:manual:` 前缀与桌面端一致
- `push` 后本地 `ahead` 归零，且**远端 `refs/heads/main` 的 sha 与本地 HEAD 一致**
- 第二客户端写入并推送后，本客户端 `fetch` 后 `behind=1`；再制造本地分叉（`ahead=1, behind=1`），
  `sync()` 的 rebase 编排成功收敛到 `ahead=0, behind=0`，工作区干净，历史同时含双方提交
- 同步护栏生效：`.DS_Store` 与 `.nexnote/index.db` 未进入远端树

### 过程中发现并修复的真实缺陷

1. **libgit2 聚合 `status` 不含未跟踪文件**：iOS 上新建页面后 `repo.status` 返回空，
   导致 `commitAll` 无变更可提交。修复见 `DeviceGitService.changedPaths`——改为遍历
   `VaultStore.listTrackableFiles()` 并用 `repo.statusFile()` 逐文件判定（该接口可正确报 `wtNew`）。
2. `VaultStore` 新增 `listTrackableFiles()`：提交面覆盖非 Markdown 文件（图片等），仅排除 `.git/`、`.nexnote/` 与 OS 垃圾。

### 已知约束（非缺陷）

- `git2dart_binaries` 尚不支持 Swift Package Manager，Flutter 会提示"未来版本将报错"并自动回退 CocoaPods。
  迁移到纯 SPM 需上游发布 SPM 支持；当前每版 Flutter 都在提示中确认过回退路径可用。
- 验收在模拟器完成（`file://` 远端）。真机需 https/ssh 远端 + 签名，属 MOB-003/MOB-010 范围。
