import path from 'node:path';

export type DocumentFormat = 'native-block' | 'markdown' | 'docx';

export interface DocumentCapabilities {
  read: boolean;
  write: boolean;
  edit: boolean;
  export: boolean;
}

export interface DocumentRef {
  path: string;
  format: DocumentFormat;
  metadataPath: string;
}

export interface DocumentMetadata {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  confidence?: number;
  aliases?: string[];
  tags?: string[];
  [key: string]: unknown;
}

export interface DocumentRevision {
  size: number;
  mtimeMs: number;
  sha256: string;
}

export interface DocumentDescriptor {
  id: string;
  path: string;
  format: DocumentFormat;
  capabilities: DocumentCapabilities;
  title: string;
  revision: DocumentRevision;
}

export interface DocumentPayload {
  ref: DocumentRef;
  text: string;
  metadata: DocumentMetadata;
  revision: DocumentRevision;
}

export const DOCUMENT_CAPABILITIES: Record<DocumentFormat, DocumentCapabilities> = {
  'native-block': { read: true, write: true, edit: true, export: true },
  markdown: { read: true, write: true, edit: true, export: true },
  docx: { read: true, write: false, edit: true, export: true },
};

export function formatForPath(filePath: string): DocumentFormat | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== '.md' && extension !== '.markdown' && extension !== '.docx') return null;
  if (extension === '.docx') return 'docx';
  return 'markdown';
}

export function isDocumentPath(filePath: string): boolean {
  return formatForPath(filePath) !== null;
}

export function metadataPathFor(root: string, documentPath: string): string {
  const normalized = documentPath.replaceAll('\\', '/').replace(/^\/+/, '');
  const encoded = Buffer.from(normalized).toString('base64url');
  return path.join(root, '.nexnote', 'metadata', `${encoded}.json`);
}

export function documentRef(root: string, documentPath: string): DocumentRef {
  const format = formatForPath(documentPath);
  if (!format) throw new Error(`Unsupported document format: ${documentPath}`);
  return { path: documentPath, format, metadataPath: metadataPathFor(root, documentPath) };
}

export function mergeDocumentMetadata(
  inferred: DocumentMetadata,
  sidecar: DocumentMetadata | null,
): DocumentMetadata {
  return { ...inferred, ...(sidecar ?? {}) };
}
