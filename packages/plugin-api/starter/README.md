# NexNote 插件 starter

最小可安装插件模板。开发步骤：

1. 复制本目录到任意位置，修改 `manifest.json` 的 `id`（反向域名式）、`name`、`main`。
2. 在 `main.js` 编写沙箱入口（类型参考 [`@nexnote/plugin-api`](../src/index.ts)）。
3. 打开 NexNote 设置 → 插件 → 「从文件夹安装…」选择本目录；确认能力清单后激活。
4. 命令出现在 ⌘K 面板（「插件」分组），视图出现在侧栏页签，块类型可经 ⌘K 插入，
   菜单出现在编辑器右键「插件」分组；声明的检索 Skill 出现在 设置 → 检索 Skill
   与对话面板的 Skill 选择器中。

权限模型：`read` 默认授予；`edit`/`filesystem`/`network`/`external-command`/
`desktop-privileged` 需在权限弹窗中确认（可「始终允许」），并可在设置页逐项 revoke。

约束：插件在 `sandbox="allow-scripts"` 的 iframe 中运行，无法访问宿主 DOM；
能力调用经版本化 RPC（`window.nexnotePlugin`），受能力白名单与审计日志约束。
