# NexNote

本地优先知识库桌面应用的共享领域语言。

## Language

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
