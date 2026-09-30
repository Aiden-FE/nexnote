# MOB-002 git2dart 真机可行性验证（降级闸门）

Ticket: MOB-002 · Milestone: M1 · Branch: dev/MOB-002 · Depends: MOB-001
ADR: docs/adr/0018-mobile-device-side-git-sync.md
Status: open

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
