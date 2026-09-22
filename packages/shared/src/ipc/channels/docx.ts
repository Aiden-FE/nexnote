import type { Result } from '../result';

/**
 * DOCX 命名空间（DEV-074，ADR-0015）：
 * - 仓库内副本语义：导入即在知识库内生成可原地覆写的副本，随 Git 版本化；
 *   可编辑往返经 binary:docx:read / binary:docx:save（语义级，非字节级保真）。
 * - 本命名空间保留 Markdown 投影降级路径（docx:createEditCopy 转 .md、docx:export 产新
 *   .docx，导出目标已存在时拒绝）与导入 fail-closed 校验。
 * - 导入复用 fs:importBinaryFile 策略（base64 + sidecar 元数据）。
 */

export interface DocxPreviewPayload {
  /** document.xml → Markdown 投影（只读） */
  markdown: string;
  /** 原 .docx 字节 sha256（编辑副本 sidecar 与硬约束测试的锚点） */
  sha256: string;
}

export interface DocxEditRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}
export interface DocxEditParagraph {
  type?: 'paragraph';
  text: string;
  runs: DocxEditRun[];
  heading: number | null;
  list: boolean;
  editable: boolean;
  originalXml: string;
  modified?: boolean;
}
export interface DocxRawTable {
  type: 'table';
  /** Read-only text projection of the table cells. */
  text: string;
  /** The complete original w:tbl element, retained for lossless saves. */
  originalXml: string;
}
export type DocxEditBlock = DocxEditParagraph | DocxRawTable;
export interface DocxEditDocument {
  /** Top-level blocks in document order. */
  blocks: DocxEditBlock[];
  unsupportedCount: number;
  originalXml: string;
}

export interface DocxEditDocumentPayload {
  document: DocxEditDocument;
  sha256: string;
}

export interface DocxEditCopyPayload {
  /** 副本 vault 相对路径（`<stem> (副本).md`） */
  path: string;
  /** 本次是否新建（幂等：副本已存在时 false） */
  created: boolean;
}

export const DOCX_CHANNELS = [
  'docx:import',
  'docx:readPreview',
  'docx:createEditCopy',
  'docx:export',
  'docx:openEdit',
  'docx:save',
] as const;

export type DocxChannel = (typeof DOCX_CHANNELS)[number];

export interface DocxChannelMap {
  /**
   * 导入 vault 外 .docx：不携带 data 时经主进程 dialogs.pickFile 选择文件（外部路径
   * 不接受 renderer 提供，防止任意本地文件读取）；data 为 renderer 显式提供的 base64。
   * 导入前做 zip/XML fail closed 校验，落盘后写 sidecar {format:'docx', sourceSha256}。
   */
  'docx:import': {
    request: {
      data?: string;
      name?: string;
      targetDir?: string;
    };
    response: Result<{ path: string; sha256: string } | null>;
  };
  /** 只读预览：返回 Markdown 投影与原件字节 sha256。 */
  'docx:readPreview': { request: { path: string }; response: Result<DocxPreviewPayload> };
  /** 在原文档同目录创建 `<stem> (副本).md`（幂等），sidecar 记录 native-block 来源。 */
  'docx:createEditCopy': { request: { path: string }; response: Result<DocxEditCopyPayload> };
  /**
   * 导出 .md 为新 .docx：默认写同目录 `<stem>.docx`（重名自动去抖），
   * targetPath 显式指定时已存在即拒绝；绝不覆盖已有文件。
   */
  'docx:export': {
    request: { path: string; targetPath?: string };
    response: Result<{ path: string }>;
  };
  'docx:openEdit': { request: { path: string }; response: Result<DocxEditDocumentPayload> };
  'docx:save': {
    request: { path: string; document: DocxEditDocument; expectedSha256: string };
    response: Result<DocxEditDocumentPayload>;
  };
}
