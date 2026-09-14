# NexNote

本地优先的知识库桌面应用：块编辑文档 × 双链知识网络 × Git 版本底座 × 原生 AI 层。

## Language

**知识库（Vault）**:
NexNote 的根工作区，绑定一个 Git 仓库，容纳全部页面、元数据与配置。
_Avoid_: 工作区、仓库（泛指）、workspace、vault（用户可见文案中直接使用英文）

**页面（Page）**:
知识库中的文档单位，由块组成，可嵌套其他页面。
_Avoid_: 文档（泛指）、笔记

**块（Block）**:
页面内的最小结构单位（段落、标题、列表、引用、代码块、表格、媒体等），可拖拽、嵌套、复制移动。
_Avoid_: 节点

**双链（Wikilink / Backlink）**:
`[[页面名]]` 形式的内部链接，及其自动生成的反向回链关系。
_Avoid_: 内链、超链接（指外部链接时）

**别名（Alias）**:
页面的替代名称；双链可经别名指向同一页面。

**元数据头（Frontmatter）**:
页面源文件顶部的 YAML 头，承载标签、别名与自定义属性，参与关系计算。
_Avoid_: 属性面板

**标准字段（Standard Field）**:
系统预定义的 7 个文档属性键：title、tags、aliases、created、updated、type、confidence；不可删除、不可重命名，与用户自建的自定义字段相对。
_Avoid_: 内置字段、系统字段

**关系索引（Link Index）**:
全局双链与元数据的实时索引库，服务图谱、回链查询与 AI 召回。
_Avoid_: 数据库（泛指）

**置信度（Confidence）**:
由 Git 提交历史算出的文档可信分数（修改频次、更新时间、最近修订），作为元数据展示并参与 AI 召回权重。

**检索 Skill（Retrieval Skill）**:
可安装、可组合的知识检索单元，为 AI 执行渐进式召回。
_Avoid_: 技能（泛指）、技能系统

**插件（Plugin）**:
第三方扩展，可新增块类型、视图、菜单与命令。

**AI 供应商适配器（Provider Adapter）**:
兼容 OpenAI 协议的模型服务接入层，用户自定义 base-url、API key、模型名与参数。

**渐进式召回（Progressive Recall）**:
粗筛（关键词/标签/元数据）→ 双链关系扩展 → 向量重排的三阶段召回管道。

**整案原型（Full-Stack Prototype）**:
产品形态 + UI 交互 + 技术栈组合的一体化可点击 HTML 方案；评审后仅保留一案。
_Avoid_: demo、mockup（泛指）

### 产品信息架构

**命令面板（Command Palette）**:
⌘K 模糊入口，聚合页面跳转、命令与 AI 动作。
_Avoid_: 快速打开、launcher

**块编辑模式（Block Editing Mode）**:
页面的默认编辑模式，以所见即所得的结构化块呈现 Markdown，不显示大部分源语法。
_Avoid_: 预览模式、富文本文件

**源码模式（Source Mode）**:
页面 tab 的临时编辑模式；左侧编辑完整 Markdown 原文，右侧显示同一页面的只读实时预览，关闭 tab 后恢复块编辑模式。
_Avoid_: 分屏、Split Pane、双编辑器

**实时预览（Live Preview）**:
源码模式中对当前 Markdown 原文的只读富渲染视图，完整呈现 NexNote 支持的块、公式、图表和链接。
_Avoid_: 右侧 Pane、第二编辑器

**文档属性（Document Properties）**:
编辑器顶部展示与编辑页面元数据的面板，表格 / YAML 双模式；标准字段与自定义字段在此添加和修改，添加时提供带说明的字段目录。
_Avoid_: 属性编辑器

**反向链接面板（Linked Mentions）**:
侧栏中列出引用当前页面（含经别名）的位置。
_Avoid_: 回链区、底部引用

**对话 dock（Chat Dock）**:
右侧可折叠的 AI 会话面板，内含上下文注入选择与召回参考来源。
_Avoid_: AI 侧窗、聊天窗口

**上下文注入（Context Injection）**:
AI 请求组装时选取当前文档、选区、关联双链文档等作为上下文的行为。

**版本时间线（Version Timeline）**:
单篇文档的提交历史视图；自动提交折叠分组、手动提交标注。

**参考来源（Cited Sources）**:
对话回答中展示的召回命中文档及其阶段标注；可展开。
_Avoid_: 引用列表

**首启动向导（Onboarding Wizard）**:
新建空 vault / 打开本地文件夹 / 克隆远程空仓库三选一的初始化流程。

**供应商 Profile（Provider Profile）**:
一套完整的模型服务接入配置（base-url、API key、模型名、参数）；多 Profile 并存，各 AI 功能可分别指定。
_Avoid_: 服务商配置（泛指）、账号

**会话页面**:
`type: chat` 的页面，AI 对话的载体；可续聊、可被双链引用、随 Git 版本化。
_Avoid_: 聊天记录、会话文件

**能力**:
插件声明并由用户授予的权限单元（网络、文件系统、外部命令等）；安装时 diff 确认，可逐项回收。
_Avoid_: 权限（泛指）

**示范插件**:
随应用分发、走完整插件管线加载的插件；MVP 中兼作插件系统的验收示范。
