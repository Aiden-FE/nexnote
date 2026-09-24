import type { Result } from '../result';

/**
 * binary:* 命名空间（DEV-074，ADR-0015）：应用内二进制编辑器（docx / xlsx / xmind）。
 *
 * 核心语义（仓库内副本 Vault Copy）：
 * - 导入即在知识库内生成合规副本，内容与外部原件一致，此后与原件脱钩；副本可原地覆写、
 *   随 Git 版本化、可直接交外部软件使用。docx 为语义级往返而非字节级保真
 *   （段落/标题/加粗斜体/表格/字体色/对齐保留；页眉页脚、编号样式、上下标不保留）。
 * - 外部文件来源只经主进程 dialogs.pickFile；renderer 提供的字节走 base64；
 *   外部路径不接受 renderer 提供。任何 zip/XML 结构校验失败即 fail-closed。
 * - 只读保留区（xlsx 宏/图表/透视表、xmind 外框/关联线）在编辑器内只读标注，
 *   保存时原字节不丢失。
 */

export const BINARY_MAX_IMPORT_BYTES = 200 * 1024 * 1024;

/** vault 副本的二进制文档格式（与 TabKind 的 'xlsx'/'mindmap'/'docx' 对应）。 */
export type BinaryKind = 'docx' | 'xlsx' | 'mindmap';

/** 保存结果信封：docx 语义级往返丢弃的结构计数（用于编辑器内/用户可见的只读标注）。 */
export interface BinarySaveMeta {
  /** docx：页眉页脚数量（未保留，编辑保存后丢失）。 */
  headersFooters?: number;
  /** docx：编号列表样式数量（未保留）。 */
  numberingStyles?: number;
  /** docx：上下标 run 数量（未保留）。 */
  superSubscripts?: number;
  /** docx：普通段落/标题/表格等已保留的结构计数（信息性）。 */
  paragraphs?: number;
  tables?: number;
}

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
  'binary:docx:read',
  'binary:docx:save',
  'binary:gitignore:set',
  'binary:gitignore:get',
] as const;

export type BinaryChannel = (typeof BINARY_CHANNELS)[number];

export interface BinaryChannelMap {
  'binary:ping': { request: void; response: Result<{ pong: true; namespace: 'binary'; implementedBy: 'DEV-074' }> };
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
  /** DEV-084：在 vault 内创建空白 docx / xlsx / xmind 文档（命名自动去重）。 */
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
    response: Result<{ sha256: string; meta?: BinarySaveMeta }>;
  };
  /**
   * docx 语义级往返：读为 HTML（mammoth），并返回不保留结构计数
   * （页眉页脚 / 编号样式 / 上下标）供编辑器与 user guide 告知。
   */
  'binary:docx:read': {
    request: { path: string };
    response: Result<{
      html: string;
      sha256: string;
      meta: { headersFooters: number; numberingStyles: number; superSubscripts: number };
    }>;
  };
  /** docx 保存：TipTap HTML → 语义块 → dolanmiu/docx 重建，原地覆写。 */
  'binary:docx:save': {
    request: { path: string; html: string; expectedSha256: string };
    response: Result<{ sha256: string; meta?: BinarySaveMeta }>;
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
    request: { kind: BinaryKind | 'docx'; path: string };
    response: Result<{ opened: true }>;
  };
  'binary:host:close': {
    request: { kind: BinaryKind | 'docx'; path: string };
    response: Result<{ closed: true }>;
  };
  'binary:host:setActive': {
    request: { kind: BinaryKind | 'docx'; path: string } | null;
    response: Result<{ active: boolean }>;
  };
  /**
   * DEV-074 宿主边界：BinaryTabView 上报占位矩形（窗口内容区坐标），
   * 宿主只覆盖这块区域、不盖住侧栏/标签条/状态栏；卸载时上报 null 收回宿主。
   */
  'binary:host:setBounds': {
    request: {
      kind: BinaryKind | 'docx';
      path: string;
      bounds: { x: number; y: number; width: number; height: number } | null;
    };
    response: Result<{ applied: true }>;
  };
  /** 等待指定宿主 pending 写入完成（关闭 tab / 窗口前调用，ADR-0015 Decision 6）。 */
  'binary:host:flush': {
    request: { kind: BinaryKind | 'docx'; path: string };
    response: Result<{ flushed: true }>;
  };
  /**
   * DEV-074：宿主页面 bootstrap 完成后由渲染层主动 ack（主进程据此 flush 队列、roundTrip 才能拿到 __nexnoteHostFlush）。
   * payload 为空（per-host 不需要标识，主进程通过 senderId = webContents.id 识别）。
   * 出现 race / 重复 ack 时后到 ack 被忽略。
   */
  'binary:host:ready': {
    request: void;
    response: Result<{ acknowledged: true }>;
  };
  /** 主题推送（ADR-0015 Decision 3「主题经 IPC 桥」）：广播给全部宿主。 */
  'binary:editorTheme': {
    request: { theme: 'light' | 'dark' };
    response: Result<{ applied: true }>;
  };
}
