# NexNote 手机端

NexNote 的 iOS 优先移动客户端：本地优先知识库的阅读、基础编辑与设备端 Git 同步。

形态与边界见 [对齐地图](../.scratch/nexnote-mobile/map.md) 与
[ADR-0017/0018/0019](../docs/adr/)：Flutter 独立实现，设备端 Git（git2dart/libgit2）窄口径直连同一远程，
数据与能力全部本地化（AI 密钥进 iOS Keychain，本地 FTS5 索引复刻桌面分词）。

## 环境要求

- Flutter 3.47.3（stable）
- Xcode 27（iOS 26.5+ 模拟器或真机）
- Node 22 / pnpm 10（仅仓库级门禁需要，本工程本身不依赖 Node）

## 常用命令

```sh
flutter pub get                 # 依赖
flutter analyze                 # 静态检查（零告警为门禁）
flutter test                    # 单元 + widget 测试
flutter build ios --simulator   # 模拟器构建
flutter build ios --device      # 真机构建（需签名配置）
```

### 集成测试（iOS 运行时真实执行）

```sh
flutter test integration_test/git_spike_test.dart      -d <simulator-udid>   # MOB-002/004 Git 全链路
flutter test integration_test/search_spike_test.dart    -d <simulator-udid>   # MOB-006 中文分词
flutter test integration_test/keychain_spike_test.dart  -d <simulator-udid>   # MOB-010 Keychain
flutter test integration_test/app_journey_test.dart    -d <simulator-udid>   # 真实应用端到端旅程
```

端到端旅程会在每个阶段向应用 Documents 写入 `shot-*.ready` 标记并留出等待窗口，
便于宿主机用 `xcrun simctl io <udid> screenshot` 采集验收截图。

## Xcode 验收

```sh
open ios/Runner.xcworkspace
```

在 Xcode 中选择 iOS 模拟器或真机后运行（⌘R）。

**注意事项**：如果先跑过 `flutter test`，`ios/Flutter/flutter_export_environment.sh` 里的
`FLUTTER_TARGET` 可能仍指向测试临时文件，此时在 Xcode 里直接构建会失败。
先执行一次 `flutter build ios --simulator`（或任意一次 `flutter run`）刷新该文件即可。

## 真机签名

当前使用免费个人团队签名（7 天有效期）。重签步骤：

1. Xcode 打开 `ios/Runner.xcworkspace`，选中 `Runner` target → `Signing & Capabilities`
2. 勾选 `Automatically manage signing`，`Team` 选择个人 Apple ID
3. 填入 `Bundle Identifier`（默认 `com.nexnote.nexnoteMobile`）
4. 换机或满 7 天后重复第 1～3 步，然后在真机「设置 → 通用 → VPN 与设备管理」信任该开发者
