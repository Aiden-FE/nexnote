# DEV-124 Tauri updater、签名、发布与 QA

- 状态：todo
- 分类：release / architecture
- 优先级：P1
- 工作量：XL
- 日期：2026-10-14
- 关联：DEV-ARCH-002、DEV-116、ADR-0010、ADR-0011

## 背景

现有发布链路基于 electron-builder / electron-updater，已有 DMG/ZIP/NSIS/AppImage/deb、blockmap、SHA256SUMS、更新 manifest、QA evidence 绑定与匿名下载验证。Tauri 迁移需要重建这些证据，而不是只验证 `cargo tauri build` 成功。

## 方案

1. 建立 Tauri bundle 策略：产物命名、版本、渠道（stable/beta/alpha）、目标平台、架构与最小系统版本。
2. 建立 updater 策略：
   - updater 私钥生成、托管、轮换与丢失预案；
   - 静态 endpoint 与 GitHub Releases 的选择；
   - 签名校验不可关闭；
   - 增量/全量下载、断点、代理与失败恢复。
3. 建立签名与平台信任：
   - macOS Developer ID / notarization 或明确 Ad hoc 手动放行边界；
   - Windows Authenticode / SmartMark 策略；
   - Linux AppImage/deb 签名或校验策略。
4. 发布 QA：
   - 产物完整集合与 SHA；
   - 三平台安装、启动、升级、卸载、数据保留；
   - 匿名下载与 Release evidence 绑定；
   - 更新私钥/签名 secret 不入仓。

## 验收标准

- [ ] Tauri bundle 产物集合、命名、版本、SHA 与 manifest 有机器校验。
- [ ] macOS 签名/公证或明确无公证边界经过真实包验证。
- [ ] Windows Authenticode / SmartScreen、Linux 安装与更新：**NOT_RUN（当前无实测环境）**。
- [ ] 更新从 N-1 到当前版本真实成功，且下载失败可恢复。
- [ ] GitHub Release 匿名下载与 checksum 全部验证。
- [ ] 未完成三平台发布 QA 前，不切换默认下载通道。

## Out of scope

- 生成或提交任何签名私钥到仓库。
- 停用现有 Electron release workflow。
