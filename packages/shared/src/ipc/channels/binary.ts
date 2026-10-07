import type { Result } from '../result';
import type { BinaryEditorCommand } from '../events';

/**
 * binary:* 命名空间（DEV-074，ADR-0015；DEV-098 撤销 docx 后仅 xlsx / xmind）。
 *
 * 核心语义（仓库内副本 Vault Copy）：
 * - 导入即在知识库内生成合规副本，内容与外部原件一致，此后与原件脱钩；副本可原地覆写、
 *   随 Git 版本化、可直接交外部软件使用。
 * - 外部文件来源只经主进程 dialogs.pickFile；renderer 提供的字节走 base64；
 *   外部路径不接受 renderer 提供。任何 zip/XML 结构校验失败即 fail-closed。
 * - 只读保留区（xlsx 宏/图表/透视表、xmind 外框/关联线）在编辑器内只读标注，
 *   保存时原字节不丢失。
 */

export const BINARY_MAX_IMPORT_BYTES = 200 * 1024 * 1024;

/**
 * xmind 布局结构（DEV-102，ADR-0020）：node 的生长方向排布，与节点内容/层级无关。
 * 存 sidecar（`mindmapStructure`）而非 xmind 字节——xmind 的 structureClass 在本应用
 * 解析端不读、写回端恒为 logic.right，布局无法经字节往返。
 */
export const MINDMAP_STRUCTURE_IDS = ['right', 'left', 'up', 'down', 'fishbone', 'x'] as const;

export type MindmapStructureId = (typeof MINDMAP_STRUCTURE_IDS)[number];

/** X 结构仅在根节点子节点数 ≥ 2 时可用（DEV-102 决策 4）。 */
export const MIN_ROOT_CHILDREN_FOR_X_STRUCTURE = 2;

export function isMindmapStructureId(value: unknown): value is MindmapStructureId {
  return typeof value === 'string' && (MINDMAP_STRUCTURE_IDS as readonly string[]).includes(value);
}

/** vault 副本的二进制文档格式（与 TabKind 的 'xlsx'/'mindmap' 对应；docx 已撤销，见 DEV-098）。 */
export type BinaryKind = 'xlsx' | 'mindmap';

export interface BinaryReadResult {
  /** 语义模型（JSON 可序列化）：xlsx 为 fortune 工作簿数据，xmind 为 simple-mind-map 数据。 */
  data: unknown;
  sha256: string;
  /** 只读保留区摘要（编辑器据此展示「原字节不丢失、此处不编辑」标注）。 */
  readonly?: string[];
}

export const BINARY_CHANNELS = [
  'binary:ping',
  'binary:import',
  'binary:create',
  'binary:read',
  'binary:save',
  'binary:host:flush',
  'binary:host:open',
  'binary:host:close',
  'binary:host:ready',
  'binary:host:setActive',
  'binary:host:setBounds',
  'binary:editorTheme',
  'binary:mindmapTheme:set',
  'binary:mindmapStructure:set',
  'binary:gitignore:set',
  'binary:gitignore:get',
] as const;

export type BinaryChannel = (typeof BINARY_CHANNELS)[number];

export interface BinaryChannelMap {
  'binary:ping': {
    request: void;
    response: Result<{ pong: true; namespace: 'binary'; implementedBy: 'DEV-074' }>;
  };
  /**
   * 导入 vault 外 .xlsx / .xmind 为仓库内副本：不携带 data 时经主进程 dialogs.pickFile
   * （外部路径不接受 renderer 提供）；data 为 renderer 显式提供的 base64。
   * 导入前做 zip/XML fail-closed 校验 + 格式转换预检，落盘后写 sidecar 元数据。
   * 返回 null 表示用户取消选择。
   */
  'binary:import': {
    request: {
      kind: BinaryKind;
      data?: string;
      name?: string;
      targetDir?: string;
    };
    response: Result<{ path: string; sha256: string } | null>;
  };
  /** DEV-084：在 vault 内创建空白 xlsx / xmind 文档（命名自动去重；docx 已撤销，见 DEV-098）。 */
  'binary:create': {
    request: { kind: BinaryKind; title?: string; targetDir?: string };
    response: Result<{ path: string; sha256: string }>;
  };
  /** 读取 vault 内副本为语义模型（供 WebContentsView 编辑器渲染）。 */
  'binary:read': {
    request: { kind: BinaryKind; path: string };
    response: Result<BinaryReadResult>;
  };
  /** 保存语义模型回 vault 副本（原地覆写，expectedSha256 乐观锁；等待 pending 写入完成）。 */
  'binary:save': {
    request: { kind: BinaryKind; path: string; data: unknown; expectedSha256: string };
    response: Result<{ sha256: string }>;
  };
  /** 切换「二进制文档不随 Git 跟踪」：写入 vault 根 .gitignore（默认跟踪，不设行）。 */
  'binary:gitignore:set': {
    request: { untrack: boolean };
    response: Result<{ untracked: boolean; removedFromIndex: number }>;
  };
  'binary:gitignore:get': {
    request: void;
    response: Result<{ untracked: boolean }>;
  };
  /** DEV-074 宿主生命周期：由渲染层 tab 切换驱动，管理 WebContentsView 的创建/显示/销毁。 */
  'binary:host:open': {
    request: { kind: BinaryKind; path: string };
    response: Result<{ opened: true }>;
  };
  'binary:host:close': {
    request: { kind: BinaryKind; path: string };
    response: Result<{ closed: true }>;
  };
  'binary:host:setActive': {
    request: { kind: BinaryKind; path: string } | null;
    response: Result<{ active: boolean }>;
  };
  /**
   * DEV-074 宿主边界：BinaryTabView 上报占位矩形（窗口内容区坐标），
   * 宿主只覆盖这块区域、不盖住侧栏/标签条/状态栏；卸载时上报 null 收回宿主。
   */
  'binary:host:setBounds': {
    request: {
      kind: BinaryKind;
      path: string;
      bounds: { x: number; y: number; width: number; height: number } | null;
    };
    response: Result<{ applied: true }>;
  };
  /** 等待指定宿主 pending 写入完成（关闭 tab / 窗口前调用，ADR-0015 Decision 6）。 */
  'binary:host:flush': {
    request: { kind: BinaryKind; path: string };
    response: Result<{ flushed: true }>;
  };
  /**
   * DEV-074：宿主页面 bootstrap 完成后由渲染层主动 ack（主进程据此 flush 队列、roundTrip 才能拿到 __nexnoteHostFlush）。
   * payload 为空（per-host 不需要标识，主进程通过 senderId = webContents.id 识别）。
   * **Pull 模型**：响应携带 ack 前排队的初始命令（load/theme），宿主页在订阅之后自行应用——
   * 初始 load 永不丢失（push 给未订阅页面会被 ipcRenderer.on 永久丢掉，宿主卡在「等待加载文档…」）。
   * 重复 ack 幂等（返回空数组）。
   */
  'binary:host:ready': {
    request: void;
    response: Result<{ commands: BinaryEditorCommand[] }>;
  };
  /** 主题推送（ADR-0015 Decision 3「主题经 IPC 桥」）：广播给全部宿主。 */
  'binary:editorTheme': {
    request: { theme: 'light' | 'dark' };
    response: Result<{ applied: true }>;
  };
  /**
   * DEV-099：xmind 主题预设选择持久化到 sidecar（`mindmapTheme` 字段，read-merge-write）。
   * xmind 字节保持 XMind 规范纯净；读取复用 document:getMetadata。
   */
  'binary:mindmapTheme:set': {
    request: { path: string; theme: string };
    response: Result<{ saved: true }>;
  };
  /**
   * DEV-102：xmind 布局结构选择持久化到 sidecar（`mindmapStructure` 字段，read-merge-write），
   * 与 mindmapTheme 同构；structure 必须是 MINDMAP_STRUCTURE_IDS 中的枚举值。
   * xmind 字节保持 XMind 规范纯净；读取复用 document:getMetadata。
   */
  'binary:mindmapStructure:set': {
    request: { path: string; structure: MindmapStructureId };
    response: Result<{ saved: true }>;
  };
}
