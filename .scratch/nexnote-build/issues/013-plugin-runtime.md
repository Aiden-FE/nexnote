# DEV-013 · 插件系统基础：沙箱运行时与能力 RPC

Type: dev
Module: plugins
Status: closed
Blocked by: DEV-001, DEV-002
Depends: DEV-001, DEV-002
Effort: XL
Priority: P1

## Scope

搭建插件系统基础架构：沙箱运行时、capability RPC、manifest 与加载机制、权限模型。这是插件系统的核心骨架，后续插件扩展点（块/视图/命令/菜单）和 Skill 系统都基于此。

### 交付内容
1. **插件运行时架构**
   - sandbox iframe 作为 UI 沙箱（渲染层隔离）
   - MessageChannel 建立 capability RPC 通道
   - QuickJS / WASM logic worker（V1 MVP 先做 iframe UI 沙箱 + main-thread logic，QuickJS worker 放 stretch）
   - 插件生命周期：加载 → 初始化 → 激活 → 停用 → 卸载
   - 每个插件一个独立 iframe / 运行上下文，互不干扰

2. **Capability RPC 系统**
   - 五层 API 面（manifest/安装 → 声明层 → capability 层 → UI/lifecycle 层 → 数据/编辑层）
   - 版本化 DTO（shared 包中定义，插件 API semver）
   - `transact(intent, expectedRevision)` 编辑事务接口（预留并发控制）
   - RPC 调用审计日志（调试用）

3. **Manifest 与加载**
   - manifest.json 格式：id, name, version, minAppVersion, main(入口), contributions(贡献点), capabilities(能力清单), permissions(权限)
   - 加载方式：本地文件夹 / zip 包
   - 加载流程：解析 manifest → 校验签名（可选，MVP 先做校验框架 + 跳过签名）→ 分配能力 → 注入 API 对象 → 初始化
   - 插件 ID 命名空间（反向域名式）

4. **权限模型**
   - 安装时能力清单 diff 确认（升级新增能力需重新确认）
   - 运行时首次调用敏感能力（网络/文件系统/外部命令）二次弹窗，可「始终允许」
   - 设置页能力审计：查看每个插件的权限 + 逐项 revoke
   - 权限等级：只读（默认）/ 编辑 / 文件系统 / 网络 / 外部命令 / desktop-privileged

5. **插件设置页**
   - 已安装插件列表（名称、版本、启用/禁用开关、权限摘要）
   - 插件详情页：描述、版本、权限明细、启用/禁用、卸载
   - 本地安装入口：选择文件夹 / zip
   - 升级：检测新版本（本地手动，不做自动更新）

6. **扩展点注册机制（基础）**
   - 贡献点注册表：commands, menus, views, blockTypes
   - 插件可通过 API 注册贡献点
   - 宿主侧提供统一分发：命令面板、菜单、视图容器从注册表读取
   - 本票实现注册机制 + 简单 demo（一个测试插件注册一个命令）

7. **安全基线**
   - iframe sandbox 属性（allow-scripts, 最小权限）
   - CSP 限制
   - 能力白名单：插件只能调用已授权的 capability
   - 资源限制：iframe 内存 / 执行超时（基础版）

## 关联决策
- 插件系统运行时与 API 分层：[plugin-system.md](../../nexnote-mvp/docs/research/plugin-system.md)
- 插件 API semver + minAppVersion：[nexnote-mvp#10](../../nexnote-mvp/issues/10-plugin-skill-architecture.md)
- 权限模型（安装 diff + 运行时首用确认 + 逐项 revoke）：[nexnote-mvp#10](../../nexnote-mvp/issues/10-plugin-skill-architecture.md)
- 安装格式（文件夹/zip + ECDSA 签名）：[nexnote-mvp#10](../../nexnote-mvp/issues/10-plugin-skill-architecture.md)

## 关联原型区域
- 设置页插件管理、检索 Skill 抽屉 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（设置页 + Skill 抽屉）

## 验收标准
- 可加载一个测试插件（文件夹方式），插件可注册一个命令
- 插件在 iframe 中运行，无法直接访问宿主 DOM
- 安装时显示能力清单，用户确认后才激活
- 插件调用未授权的能力会被拒绝，并触发权限请求弹窗
- 设置页可查看插件详情、启用/禁用、revoke 权限
- 卸载插件后，其贡献的命令/菜单/视图全部移除
- 插件崩溃（JS 异常）不影响主应用
