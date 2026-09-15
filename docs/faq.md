# NexNote FAQ

> 适用版本：v0.0.1。

---

## 基础使用

**Q: NexNote 需要联网吗？账号呢？**

不需要。NexNote 是本地优先（local-first）的桌面应用：所有数据（笔记、索引、插件设置）都保存在本地 vault 目录和用户配置目录里。不需要注册账号，没有云端同步（v0.0.1 只支持 Git 远程）。

唯一需要联网的场景：
- 使用基于云端的 AI 模型（如 OpenAI 兼容 API）
- 从 Git 远程 clone / push / pull
- 自动更新检查和下载

---

**Q: vault 是什么？**

vault 是一个普通文件夹，里面是 markdown 文件和一个 `.nexnote/` 子目录（放索引 SQLite 等派生数据），v0.0.1 起还必须有 `.git/` 目录（自动版本化）。你可以用任何文件管理器、其他笔记软件直接打开这个文件夹。

---

**Q: 我能把 Obsidian vault 导入 NexNote 吗？**

可以。NexNote 的 markdown 方言与 Obsidian 高度兼容：Wikilink `[[page|alias]]`、frontmatter `aliases`/`tags`、内联 `#tag`、Callout `> [!note]`、块锚点 `^id` 都支持。

在首启动向导选「打开已有文件夹」，选中含 `.obsidian/` 的目录即可；首次打开会自动初始化 Git 和索引，不会修改你的笔记内容（除非你在 NexNote 中编辑）。

---

**Q: 数据安全吗？卸载会丢数据吗？**

你的笔记内容只存在于 vault 文件夹里。卸载应用不会删除 vault；删除 `~/.config/nexnote/` 等配置目录也不会碰 vault 里的任何内容。

索引、AI 配置、插件等存在用户配置目录（与 vault 分开），丢失也能从 vault 重建（索引下次打开自动重建）。

---

**Q: Git 自动提交会不会把我的历史搞乱？**

不会。自动提交使用 `nexnote-auto` 前缀的提交信息（如 `auto: 保存 a.md, 重命名 b → c`），和你的手动提交（`manual:` 前缀）清晰区分。你可以：

- 在 Git 面板看完整时间线
- 对单个文件做「恢复到指定版本」
- 禁用自动提交（设置 → Git → 自动提交防抖设为关闭）

---

## 编辑与双链

**Q: 块编辑器和普通 markdown 编辑器有什么不同？**

块编辑器把每个段落/标题/列表/代码块视为独立可操作的单元。好处：

- 拖拽排序
- 折叠/展开标题树
- 每个块有稳定 ID（`^block-id`），双链可以精确跳到块
- 插件可以自定义块渲染（如 Mermaid、KaTeX）

导出时仍保存为标准 markdown，不丢失兼容性。

---

**Q: 重命名一个页面，所有引用它的 wikilink 会自动更新吗？**

会。使用页面树的「重命名」（即 `fs:renameLinked`），NexNote 会：
1. 重命名文件；
2. 在全库所有引用它的 wikilink 中改写目标名（保留显示文本/锚点）；
3. 触发索引刷新，反链面板立刻更新。

---

**Q: 「红链」（未解析的 wikilink）怎么办？**

当 `[[目标]]` 找不到匹配的 alias/title/basename 时，就是红链（目标不解析）。点击红链会提示「新建」或选择已有页面。

有歧义时也会留红链（比如两个不同目录的文件同名，`[[同名单]]` 不确定指向哪个）——这是有意的设计，避免误链接。

---

## 搜索与召回

**Q: 搜索支持中文吗？**

支持。底层是 SQLite FTS5，对中文做了 unigram + bigram 索引，子串也能命中（比如搜「基准」能命中「搜索基准」）。拉丁词走前缀匹配（`nex` → `nexnote`）。

---

**Q: AI 召回的三阶段是什么意思？**

1. **FTS 粗筛**：全文搜索拿候选页（默认 20 页）。快，毫秒级。
2. **双链扩展**：把候选页的 1 跳邻居页面也加进来，防止漏检（相关但关键词不同的页面）。
3. **向量重排**：在候选集上做余弦相似度精排，按语义相关度排序。可选关闭（更快）。

结果附带来源页路径、块锚点、向量相似度、置信度分数，可点击跳转回原文。

---

**Q: 置信度是什么？有什么用？**

置信度是 0–100 的分数，综合衡量一页内容的「可信度 / 重要程度」。因子包括：

- 内容稳定性（最近改动越少越高）
- 修订次数
- 作者数量
- 文档年龄
- 链接权威度（简化 PageRank + 入链数）
- 手动加权（frontmatter `confidence_boost`）

它默认影响 AI 召回排序的 30% 权重（可在召回 Skill 参数里调）。

---

## AI 与隐私

**Q: AI 密钥存在哪里？安全吗？**

密钥只写入**系统钥匙串**：
- macOS：Keychain
- Windows：Credential Manager
- Linux：Secret Service / keyring

不会存在 vault 里、不会存在设置文件里、不会同步到任何远端。你可以在系统钥匙串里直接删除。

---

**Q: 本地 embedding 是什么？不联网也能做语义召回吗？**

可以。NexNote 内置了本地 embedding（基于 transformers.js），不联网也能做语义向量召回。质量比云端模型差，但隐私安全、零延迟、零成本。

在设置 → AI → 添加 Profile → 选「本地 Embedding」即可。

---

**Q: AI 对话会被上传到云端吗？**

取决于你配置的 AI provider：
- 用 OpenAI 兼容 API：对话内容会发给你配置的 API 端点。
- 本地模型：完全在本地跑。

NexNote 本身不收集任何数据、没有自己的后端。

---

## 插件

**Q: 插件安全吗？**

NexNote 的插件运行在严格的**沙箱（iframe）**里：

- 默认只有 `read` + `edit` 权限；
- 更高权限（网络、文件系统、外部命令）必须逐项确认；
- 所有能力调用都经过权限检查和审计日志；
- 插件不直接访问 DOM，只能通过「编辑事务」描述意图，由宿主 apply。

你可以在「设置 → 插件」随时查看权限、撤销授权、禁用或卸载。

---

**Q: 我能自己写插件吗？**

可以。参见 [插件开发文档](./plugin-development.md)。插件是带 `manifest.json` + `main.js` 的目录或 zip 包，JavaScript 即可，也可以用 TypeScript 打包。

---

## 发布、安装与更新

**Q: macOS 安装包是签名或公证的吗？**

当前发布计划提供 macOS Intel（x64）和 Apple Silicon（arm64）的 Ad hoc 签名包，**未公证**。首次启动可能被 macOS 隔离；确认下载来源和校验和后，将应用拖入 Applications，并按安装说明清除 quarantine 属性：

```sh
xattr -d com.apple.quarantine /Applications/NexNote.app
```

这不是 Developer ID 分发，也不代表 Gatekeeper 会无警告放行。每个 release 的真实签名、安装与首次启动结果以 [QA 清单](./release/QA-CHECKLIST.md) 中的 evidence 为准；未执行的项目保持 `NOT_RUN`。

**Q: macOS 为什么没有自动安装更新？**

Ad hoc、未公证的 macOS 包不能依赖应用内自动安装。若应用内检查到更新但无法自动安装，请按提示前往 [GitHub Releases](https://github.com/Aiden-FE/nexnote/releases)，选择与 Intel 或 Apple Silicon 对应的 DMG/ZIP，手动安装新版。没有公开 N-1 到当前版本的真实网络升级 evidence 时，不把更新写成“已验证”。

**Q: Windows 和 Ubuntu 应该下载哪种格式来自动更新？**

Windows 以 NSIS installer 为自动更新主路径；`portable` 是额外的手动运行格式。Ubuntu 以 AppImage 为自动更新主路径；`deb` 是额外的手动安装格式，不能把 deb 的手动安装结果当成自动更新验证。具体版本、channel 和 asset 以 GitHub Release 为准。

**Q: 更新失败或版本有问题怎么办？**

先记录错误和当前版本，使用“重试”再次检查/下载；不要删除 vault。若 feed 暂停或自动更新仍不可用，从 GitHub Releases 选择已知可用的旧版，核对架构、tag 和 SHA-256 后手动安装。维护者会优先通过同一 channel 发布前滚修复版本；每个版本的处理记录见发布 QA evidence。

---

## 故障排查

**Q: 搜索结果不准 / 找不到应该存在的内容？**

索引是从文件派生的缓存，损坏可以重建：

1. 退出 NexNote；
2. 删除 vault 目录下的 `.nexnote/index.db`；
3. 重新打开 vault，索引会自动从头构建。

千页级 vault 通常几秒到几十秒内完成重建。

---

**Q: 打开 vault 后搜索/反链是空的？**

可能索引还在构建中。看状态栏左下角的索引进度指示。如果一直停在 `scanning`，可能是 vault 里有异常文件；可以打开开发者工具看控制台错误。

---

**Q: 自动提交没生效？**

检查：
1. 设置 → Git → 自动提交防抖是否被设得很大或关闭；
2. 文件是否真的被修改（外部程序修改可能没触发 watcher）；
3. 工作区有没有冲突标记文件（`<<<<<<< HEAD` 等），冲突存在时自动提交被拒绝。

---

**Q: 插件安装失败？**

常见原因：
- `manifest.json` 缺少必填字段（`id` / `name` / `version` / `main` / `permissions` / `capabilities`）；
- `minAppVersion` 高于当前 NexNote 版本；
- 入口文件 `main` 路径不对；
- 插件目录被修改（staging hash 校验失败，是安全防护，不是 bug）。

---

**Q: 怎么恢复误删的页面？**

有两种方式：
1. **撤销**：编辑器内 `Cmd/Ctrl + Z` 撤销删除块或内容（仅当前会话）。
2. **Git 恢复**：在文件右键菜单 → 提交历史 → 选择一个历史版本 → 恢复。恢复会生成新的提交，不会覆盖历史。

---

**Q: 三端（macOS / Windows / Linux）都支持吗？**

代码层面都支持，CI 也构建三平台产物。v0.0.1 是 MVP 内测版；macOS 当前为 Ad hoc、未公证，Windows/Linux 的真实签名、平台安装和 N-1 网络升级是否完成必须以 [QA 清单](./release/QA-CHECKLIST.md) 的 evidence 为准。发布格式与已知边界见 [Release Notes](../.scratch/nexnote-build/RELEASE-NOTES.md)。
