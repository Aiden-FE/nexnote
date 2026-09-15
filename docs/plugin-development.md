# NexNote 插件开发文档

> 适用版本：v0.0.1，Plugin API v1.0.0。
> 所有功能均基于真实代码实现编写；不存在的能力未列出。

---

## 1. 快速开始

### 1.1 插件结构

一个 NexNote 插件是一个包含 `manifest.json`（清单）和入口脚本（默认 `main.js`）的目录（或 zip 包）。

```
my-plugin/
├── manifest.json     # 插件清单（id、版本、权限、贡献点）
└── main.js           # 沙箱入口（运行在 iframe 沙箱中）
```

最小可用 `manifest.json`：

```json
{
  "id": "com.example.hello",
  "name": "Hello World",
  "version": "0.0.1",
  "minAppVersion": "0.0.1",
  "main": "main.js",
  "description": "第一个 NexNote 插件",
  "capabilities": ["read"],
  "permissions": ["read"]
}
```

`main.js`：

```js
/* global window */
window.addEventListener('nexnote-plugin-ready', () => {
  window.nexnotePlugin.registerCommand('greet', 'Hello: 打招呼', ['hello', 'hi']);
});
```

### 1.2 安装与调试

1. 在 NexNote 中：设置 → 插件 → 「从目录安装」，选择插件文件夹。
2. 系统会：
   - 校验 `manifest.json` 结构、semver、权限白名单；
   - 将插件目录复制到 staging 临时目录做 hash，再固化为只读快照；
   - 逐项展示权限请求；用户确认后插件激活。
3. 调试：插件运行在独立 iframe 沙箱中，可打开 DevTools 查看 `nexnote-plugin-*` 事件。

---

## 2. 生命周期

插件在沙箱中经历以下状态，均通过 `window` 事件通知：

| 事件 | 触发时机 |
| --- | --- |
| `nexnote-plugin-initialize` | 沙箱 iframe 加载完毕，`window.nexnotePlugin` 已注入（但不可用） |
| `nexnote-plugin-ready` | 会话鉴权通过，`nexnotePlugin` API 可用，可以注册命令/提交事务 |
| `nexnote-plugin-activate` | 插件从禁用变为启用（或首次安装并确认） |
| `nexnote-plugin-deactivate` | 插件被禁用 |
| `nexnote-plugin-unload` | 插件即将卸载（卸载前最后一次回调） |

```js
window.addEventListener('nexnote-plugin-activate', () => {
  console.log('插件已激活');
});
```

---

## 3. 权限系统（最小授权）

插件必须在 `permissions` 和 `capabilities` 中同时声明所需权限；实际授权以用户确认为准。

| 权限 | 说明 | 默认授权 |
| --- | --- | --- |
| `read` | 读取 vault 文件、查询索引、搜索 | ✅ 默认 |
| `edit` | 通过编辑事务写入 vault 内容 | ✅ 默认 |
| `filesystem` | 读写 vault 外任意文件（系统文件） | ❌ 需确认 |
| `network` | 发起网络请求（fetch） | ❌ 需确认 |
| `external-command` | 执行外部命令/子进程 | ❌ 需确认 |
| `desktop-privileged` | 桌面级特权（窗口、通知等） | ❌ 最高，需显式确认 |

运行时可随时申请权限：

```js
const result = await window.nexnotePlugin.requestPermission('network');
console.log(result.granted, result.alwaysAllow);
```

---

## 4. API 参考

`window.nexnotePlugin` 是注入到沙箱的全局 API 对象，类型为 `NexnotePluginApi`（见 `@nexnote/plugin-api`）。

### 4.1 `apiVersion`

```ts
readonly apiVersion: '1.0.0';
```

当前插件 API 主版本。

### 4.2 `registerCommand`

```ts
registerCommand(id: string, title: string, keywords?: string[]): Promise<unknown>;
```

注册一个运行时命令，出现在 ⌘K 命令面板的「插件」分组中。用户执行命令时，插件沙箱会收到 `command:run` 通知（具体事件由沙箱 RPC 派发）。

### 4.3 `transact`

```ts
transact(
  intent: { type: string; payload: unknown },
  expectedRevision: number
): Promise<unknown>;
```

发送一个编辑事务。`expectedRevision` 用于乐观并发控制，防止插件基于过期状态写入。仅在拥有 `edit` 权限时可用。

### 4.4 `requestPermission`

```ts
requestPermission(permission: PluginPermission): Promise<{
  granted: boolean;
  alwaysAllow: boolean;
}>;
```

申请某项权限。若用户已授权且「总是允许」，直接返回 `{granted:true, alwaysAllow:true}`；否则弹出宿主权限对话框。

### 4.5 `callCapability`

```ts
callCapability(
  permission: PluginPermission,
  operation: string,
  payload?: unknown
): Promise<unknown>;
```

调用受权限保护的能力（如 `network` / `filesystem` / `external-command`）。具体 `operation` 由运行时能力表决定。

---

## 5. 贡献点（Contributions）

插件可以在 `manifest.json` 的 `contributions` 字段声明静态贡献点，这些贡献点在用户安装确认后即生效，无需等待沙箱启动。

```json
{
  "contributions": {
    "commands": [
      { "id": "hello", "title": "Demo: Hello", "keywords": ["demo", "hello"] }
    ],
    "menus": [
      { "id": "tools", "title": "Demo tools", "anchor": "editor/context" }
    ],
    "views": [
      { "id": "panel", "title": "Demo panel", "placement": "sidebar" }
    ],
    "blockTypes": [
      { "id": "widget", "title": "Demo widget" }
    ]
  }
}
```

### 5.1 commands

命令面板中的命令项。`id` 是插件内唯一 id；在宿主中表示为 `<plugin-id>:<command-id>`（scopedId）。

### 5.2 menus

上下文菜单分组。`anchor` 可选：
- `editor/context` — 编辑器右键菜单
- `block/handle` — 块手柄菜单
- `app` — 应用级菜单

### 5.3 views

侧边栏 / 主区域 / 设置面板中的自定义视图。`placement` 可选：`sidebar` / `main` / `settings`。

### 5.4 blockTypes

自定义块类型。会写入 `plugin_block` 节点，通过插件沙箱渲染（iframe 或 webview）。

---

## 6. 召回 Skill 贡献（`skills`）

插件可以声明一个或多个**受约束的检索 Skill**（DEV-014）。宿主会用插件声明的参数调用宿主的三阶段检索器，**插件不接触文件内容**，只影响检索策略。

```json
{
  "skills": [
    {
      "id": "quick",
      "name": "Demo 快速检索",
      "description": "关闭向量的关键词召回",
      "params": { "disableVector": true, "topK": 5 }
    }
  ]
}
```

可用参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `topK` | number | 返回的来源块数 |
| `budgetChars` | number | 上下文正文总字符预算 |
| `confidenceWeight` | number | 置信度权重（0–1，默认 0.3） |
| `disableVector` | boolean | 关闭向量重排（更快） |

在设置 → 召回 Skill 中，用户可以启停/排序/改写这些参数。

---

## 7. 内置插件

NexNote 内置两个 UI 级插件，可禁用但不可卸载：

| 插件 id | 功能 |
| --- | --- |
| `com.nexnote.builtin.mermaid` | Mermaid 流程图/时序图/甘特图等 |
| `com.nexnote.builtin.katex` | KaTeX 数学公式（行内 `$...$` 与块级 `$$...$$`） |

---

## 8. 打包与分发

- **目录插件**：开发用，从「设置 → 插件 → 从目录安装」加载。
- **Zip 包**：分发用。支持标准 ZIP（deflate）。安装时先解压到 staging，做 hash，确认时固化为只读快照。
- 包内必须有 `manifest.json` 和 `main` 字段指向的入口文件。
- 插件源码不得超过 1 MB（`MAX_PLUGIN_SOURCE_BYTES`）。

---

## 9. 安全模型

1. **沙箱**：插件运行在独立 iframe，与主渲染进程隔离；所有能力调用走 RPC，必须经权限检查。
2. **一次性安装票据**：预览 → 用户确认 → 固化 staging 目录；确认后若 staging 被篡改，安装失败。
3. **最小授权**：默认只有 `read` / `edit`；更高权限需用户逐次确认，且可在设置中随时撤销。
4. **审计日志**：所有能力调用都有审计记录，可在「设置 → 插件」中查看。
5. **无 DOM 直接访问**：插件通过 RPC 描述编辑意图（事务），宿主负责 apply 到编辑器。

---

## 10. 类型包

插件开发可以安装 `@nexnote/plugin-api` 类型包获得 TypeScript 支持（类型与运行时注入的全局对象一致）：

```bash
npm install --save-dev @nexnote/plugin-api
```

在代码中：

```ts
/// <reference types="@nexnote/plugin-api" />
window.addEventListener('nexnote-plugin-ready', () => {
  window.nexnotePlugin!.registerCommand('hello', 'Hello');
});
```

---

## 11. 版本兼容

- `minAppVersion` 指定最低宿主版本（semver）；低于此版本的 NexNote 会拒绝安装。
- 破坏性变更必须提升 `PLUGIN_API_VERSION` 主版本号（当前 `1.0.0`）。
- 插件打包时宿主版本号自动传入，插件可通过 `callCapability` 查询宿主详细版本。
