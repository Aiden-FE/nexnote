# DEV-016 · 设置系统与首启动向导完善

Type: dev
Module: foundation
Status: closed
Blocked by: DEV-001
Depends: DEV-001
Effort: M
Priority: P1
Parallel-with: DEV-002

## Scope

完善设置系统与首启动向导：统一设置页面框架、各模块设置项接入、首启动三选一向导完善。

### 交付内容
1. **设置页面框架**
   - 左侧分类 + 右侧内容的标准设置页
   - 分类：通用、编辑器、AI、Git、插件、检索 Skill、快捷键、关于
   - 设置持久化：全局设置（系统级）+ vault 设置（每个 vault 独立）
   - 设置变更实时生效（或标注重启生效）
   - 搜索：设置项可搜索

2. **通用设置**
   - 主题：亮/暗/跟随系统
   - 语言：简体中文 / English（MVP 先做中文，框架预留）
   - 字体：编辑器字体、UI 字体、字号
   - 自动更新：检查更新 / 自动下载 / 更新通道
   - 启动行为：恢复上次会话 / 显示欢迎页 / 打开特定 vault

3. **编辑器设置**
   - 自动保存间隔
   - 默认新页面模板
   - 文件名与标题联动开关
   - 编辑器 vim 模式（MVP 可能先不做，仅留位）
   - 代码块主题

4. **AI 设置（接 DEV-009）**
   - Profile 管理
   - 分功能模型指定（写作/对话/embedding）
   - 默认 temperature 等参数

5. **Git 设置（接 DEV-007）**
   - 自动提交开关 + 间隔
   - 提交消息模板
   - 使用系统 Git 开关（默认关）
   - 默认分支名

6. **插件设置（接 DEV-013/014）**
   - 已安装插件列表
   - 插件详情
   - 权限审计

7. **检索 Skill 设置（接 DEV-014）**
   - 已安装 Skill 列表
   - 启用/禁用/排序
   - 各 Skill 参数配置

8. **快捷键设置**
   - 快捷键列表 + 搜索
   - 可自定义（修改快捷键绑定）
   - 导入/导出快捷键配置

9. **首启动向导完善**
   - 三选一：新建空 vault / 打开本地文件夹 / 克隆远程仓库
   - 新建：选择位置 + 输入 vault 名 → 自动 git init + 初始提交
   - 打开：选择文件夹 → 检测 git → 提示初始化（如无）→ 检测 Obsidian vault（识别 .obsidian 目录）
   - 克隆：输入 URL → 授权预检 → 选择本地位置 → 克隆
   - 向导完成后进入主界面 + 欢迎页（含快速入门）

## 关联决策
- 首启动向导三选一：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)
- 设置页管理范围：[nexnote-mvp#07](../../nexnote-mvp/issues/07-product-architecture.md)

## 关联原型区域
- 设置页各分类、首启动向导 → [A 案原型](../../nexnote-mvp/docs/research/prototypes/a-block-first.html)（设置页 + 首启动）

## 验收标准
- 设置页各分类均可访问，设置变更正确持久化
- 重启应用后设置保持
- 首启动向导三条路径均可完成 vault 创建/打开/克隆
- 设置项可搜索
- 快捷键可自定义
