# NexNote

本地优先知识库桌面应用的共享领域语言；用于沟通应用内文档模型、XMind 结构与用户可见行为。

## Language

### 文档与打印

**Document**:
Vault 中的一份内容文件；当前包括块文档、Markdown 文档、XLSX、XMind 等格式。
_Avoid_: Page, note

**Block document**:
以块编辑器为权威视图的 `.md` 文档，sidecar `format` 为 `native-block`。
_Avoid_: Native block, block note

**Markdown document**:
以源码模式为权威视图的 `.md`/`.markdown` 文档，sidecar `format` 为 `markdown`。
_Avoid_: Plain Markdown, MD document

**Printing**:
把当前 active 文档的渲染语义内容交给系统打印流程的行为；不包含打印应用 UI。
_Avoid_: Screenshot, export

### xmind 结构

**布局结构（Layout Structure）**:
xmind 文档内节点在画布上的排布骨架，决定子节点相对父节点的生长方向；与节点内容、层级顺序相互独立。
_Avoid_: 骨架、结构类型、视图模式、主题

**结构类（Structure Class）**:
XMind 官方写在 topic 上的结构标识字符串；受支持布局结构的文件权威只读取根节点的结构类。
_Avoid_: 布局名、structure 标签、sidecar 结构

**文件权威结构（File-Authoritative Structure）**:
保存在 `.xmind` 字节内的受支持布局结构；外部 XMind 软件打开时应看到相同结构模式。
_Avoid_: sidecar 结构、应用内设置、布局偏好

**NexNote 专用布局（NexNote-Only Layout）**:
官方结构类中没有对应物的 legacy 布局（`up` / `x`）；可在应用内渲染，但结构面板不再新增选择。
_Avoid_: 四向结构、向上结构作为外部承诺、X 结构作为外部承诺

### AI 与召回

**语义向量（Semantic embedding）**:
把文本映射为可按语义相近度比较的数值表示；语义相近不要求词面相同。
_Avoid_: 词法哈希向量、云端向量

**内置语义向量（Built-in semantic embedding）**:
由 NexNote 管理并在本机执行的语义向量能力；模型文件在用户显式启用后下载，推理过程不依赖外部模型接口。
_Avoid_: 捆绑向量模型、本地哈希向量

**向量代际（Embedding generation）**:
由同一语义向量来源产生、可相互比较的一组向量；来源变化后必须重建，不能与旧代际混排。
_Avoid_: 向量缓存版本、模型版本作为唯一身份
