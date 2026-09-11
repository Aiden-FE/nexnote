import { readZipEntry } from './zip';

const DOCUMENT_ENTRY = 'word/document.xml';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface EditRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface EditParagraph {
  text: string;
  runs: EditRun[];
  heading: number | null;
  list: boolean;
  editable: boolean;
  /** 原始 XML，仅用于未支持段落或未修改段落的保真重建。 */
  originalXml: string;
  modified?: boolean;
}

export interface EditDocument {
  paragraphs: EditParagraph[];
  unsupportedCount: number;
  /** 内部保存原始 XML，open→不编辑→save 保证字节不变。 */
  originalXml: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
function decode(value: string): string {
  return value.replace(/&(#\d+|#x[\da-fA-F]+|amp|lt|gt|quot|apos);/g, (all, entity: string) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    return String.fromCodePoint(
      Number.parseInt(
        entity.slice(entity[1] === 'x' || entity[1] === 'X' ? 2 : 1),
        entity[1] === 'x' || entity[1] === 'X' ? 16 : 10,
      ),
    );
  });
}
function paragraphXml(p: EditParagraph): string {
  const pPr = p.heading
    ? `<w:pPr><w:pStyle w:val="Heading${p.heading}"/></w:pPr>`
    : p.list
      ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
      : '';
  const runs = p.runs
    .map(
      (r) =>
        `<w:r>${r.bold || r.italic ? `<w:rPr>${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`,
    )
    .join('');
  return `<w:p>${pPr}${runs}</w:p>`;
}

function topLevelParagraphs(xml: string): string[] {
  const bodyStart = xml.indexOf('<w:body');
  const bodyOpen = xml.indexOf('>', bodyStart);
  const bodyEnd = xml.lastIndexOf('</w:body>');
  if (bodyStart < 0 || bodyOpen < 0 || bodyEnd < 0) throw new Error('document.xml 缺少 w:body');
  const body = xml.slice(bodyOpen + 1, bodyEnd);
  const result: string[] = [];
  let start = -1;
  let depth = 0;
  const token = /<\/?w:p(?:\s[^>]*)?>/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(body))) {
    if (!m[0].startsWith('</')) {
      if (depth === 0) start = m.index;
      depth += 1;
      if (m[0].endsWith('/>')) depth -= 1;
    } else {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        result.push(body.slice(start, token.lastIndex));
        start = -1;
      }
    }
  }
  return result;
}

function parseParagraph(xml: string): EditParagraph {
  const headingMatch = /<w:pStyle\b[^>]*w:val=["']Heading([1-6])["'][^>]*\/?\s*>/i.exec(xml);
  const list = /<w:numPr\b|<w:pStyle\b[^>]*w:val=["']ListParagraph["']/i.test(xml);
  const runs: EditRun[] = [];
  const runRe = /<w:r\b[\s\S]*?<\/w:r>/g;
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(xml))) {
    const runXml = m[0];
    const text = [...runXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((x) => decode(x[1] ?? ''))
      .join('');
    if (text || /<w:tab\s*\/>/.test(runXml) || /<w:br\s*\/>/.test(runXml))
      runs.push({
        text: [...text].filter((character) => character !== String.fromCharCode(0)).join(''),
        bold: /<w:b(?:\s[^>]*)?\s*\/>/.test(runXml),
        italic: /<w:i(?:\s[^>]*)?\s*\/>/.test(runXml),
      });
  }
  const editable = !/<w:(?:drawing|pict|object|fldSimple|hyperlink)\b/.test(xml);
  return {
    text: runs.map((r) => r.text).join(''),
    runs,
    heading: headingMatch ? Number(headingMatch[1]) : null,
    list,
    editable,
    originalXml: xml,
  };
}

export function openEditDocument(bytes: Buffer): EditDocument {
  const xml = readZipEntry(bytes, DOCUMENT_ENTRY).toString('utf8');
  const paragraphs = topLevelParagraphs(xml).map(parseParagraph);
  return {
    paragraphs,
    unsupportedCount: paragraphs.filter((p) => !p.editable).length,
    originalXml: xml,
  };
}

export function serializeEditDocument(document: EditDocument): string {
  if (!document.paragraphs.some((p) => p.modified)) return document.originalXml;

  // Replace paragraph occurrences in document order. Using String.replace per paragraph
  // would replace the first identical XML repeatedly when a document has duplicate paragraphs.
  let output = document.originalXml;
  let cursor = 0;
  for (const paragraph of document.paragraphs) {
    const position = output.indexOf(paragraph.originalXml, cursor);
    if (position < 0) throw new Error('编辑模型与原始 document.xml 不匹配');
    if (paragraph.modified && paragraph.editable) {
      const replacement = paragraphXml(paragraph);
      output =
        output.slice(0, position) +
        replacement +
        output.slice(position + paragraph.originalXml.length);
      cursor = position + replacement.length;
    } else {
      cursor = position + paragraph.originalXml.length;
    }
  }
  return output;
}

export function editParagraph(
  document: EditDocument,
  index: number,
  patch: Partial<Pick<EditParagraph, 'text' | 'runs' | 'heading' | 'list'>>,
): void {
  const p = document.paragraphs[index];
  if (!p || !p.editable) throw new Error('该段落不支持编辑');
  Object.assign(p, patch);
  if (patch.text !== undefined && patch.runs === undefined) p.runs = [{ text: patch.text }];
  p.modified = true;
}

export { DOCUMENT_ENTRY, W_NS };
