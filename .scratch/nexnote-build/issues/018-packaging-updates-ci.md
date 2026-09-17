# DEV-018 · 打包、自动更新与发布流程

Type: dev
Module: foundation
Status: closed
Blocked by: DEV-001
Depends: DEV-001
Effort: M
Priority: P2
Parallel-with: 多个模块票

## Scope

完成应用打包、自动更新、签名与发布流程的工程化。本票可与功能开发并行推进。

### 交付内容
1. **electron-builder 配置**
   - macOS：dmg + zip（arm64 + x64 双架构）
   - Windows：nsis installer + portable（x64）
   - Linux：AppImage + deb（x64）
   - 应用图标、安装包图标
   - 捆绑 dugite-native Git（三端对应版本）
   - 打包体积优化（asar + 依赖裁剪）

2. **代码签名**
   - macOS：Apple Developer ID 签名 + 公证（notarization）
   - Windows：EV 代码签名证书（或 OV + SmartScreen 积累）
   - Linux：AppImage 签名
   - CI 中签名流程（密钥安全存储）

3. **自动更新**
   - electron-updater 集成
   - 更新通道：stable / beta / alpha
   - 更新策略：自动下载 + 提示安装 / 手动检查
   - 更新 UI：设置页检查更新、下载进度、安装提示
   - 更新服务器：GitHub Releases（或自建简单静态服务器）

4. **CI/CD 流水线**
   - GitHub Actions（或同类）：PR 检查（lint + test + typecheck）
   - Release 流水线：打 tag → 三端打包 → 签名 → 上传 Release → 生成 latest.yml
   - 夜间构建（可选）

5. **发布质量检查**
   - Smoke test 脚本：启动应用、打开 vault、基本操作自动化测试
   - 跨平台 QA 检查清单
   - 版本号管理（semver）

## 关联决策
- 对外产品标准（安装包、自动更新）：[map.md Destination](../../nexnote-mvp/map.md)
- 默认捆绑 Git（dugite-native）：[ADR 0002](../../nexnote-mvp/docs/adr/0002-bundled-git-by-default.md)

## 验收标准
- 三端安装包均可正常构建
- macOS 包签名 + 公证通过，无 Gatekeeper 警告
- 自动更新：从旧版本可检测并安装新版本
- CI 流水线 PR 检查通过后可合并
- 打 tag 后自动触发 Release 流水线
