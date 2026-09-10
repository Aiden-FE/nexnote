import { readZipEntry } from './zip';

/**
 * word/document.xml → Markdown 投影（阶段6，最小口径）：
 * - 段落 → 空行分隔文本；w:pStyle Heading1-6 → #…######；w:numPr → "- " 前缀；
 * - 粗体/斜体映射 run 属性（**bold** / *italic*）；表格降级为纯文本行（单元格 " | " 连接）。
 * - 自带最小 XML 扫描器（零依赖）：标签栈配对校验，任何不配对/损坏 → DocxError（fail closed）。
 */

export class DocxError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DocxError';
  }
}

const DOCUMENT_ENTRY = 'word/document.xml';

interface RunDraft {
  text: string;
  bold: boolean;
  italic: boolean;
}

interface ParagraphDraft {
  style: string | null;
  list: boolean;
  runs: RunDraft[];
}

interface CellDraft {
  paragraphs: string[];
}

interface TableDraft {
  currentRowCells: CellDraft[] | null;
}

const TAG_RE =
  /<\s*(\/?)\s*([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)\s*>/g;
const ATTR_RE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attrValue(attrs: string, name: string): string | null {
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrs))) {
    if (m[1] === name) return m[2] ?? m[3] ?? '';
  }
  return null;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[\da-fA-F]+|\w+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    switch (entity) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return whole; // 未知实体保持原样（宽松读取）
    }
  });
}

function headingLevel(style: string | null): number | null {
  if (!style) return null;
  const m = /^Heading([1-6])$/i.exec(style);
  return m ? Number(m[1]) : null;
}

function renderRuns(runs: RunDraft[]): string {
  let out = '';
  for (const run of runs) {
    if (run.text.length === 0) continue;
    if (run.bold && run.italic) out += `***${run.text}***`;
    else if (run.bold) out += `**${run.text}**`;
    else if (run.italic) out += `*${run.text}*`;
    else out += run.text;
  }
  return out;
}

/** 段落 → Markdown 行（表格内已在上游降级为纯文本）。 */
function renderParagraphLine(draft: ParagraphDraft, text: string): string {
  const level = headingLevel(draft.style);
  if (level !== null) return `${'#'.repeat(level)} ${text}`;
  if (draft.list) return `- ${text}`;
  return text;
}

/** 解析 document.xml 为 Markdown 投影；损坏 XML 抛 DocxError（绝不返回半截结果）。 */
export function documentXmlToMarkdown(xml: string): string {
  // 去注释（OOXML 正文不含 CDATA；注释里的标签不参与配对）。
  const source = xml.replace(/^\s*<\?xml[\s\S]*?\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack: string[] = [];
  let rootName: string | null = null;

  const blocks: string[] = [];
  let paragraph: ParagraphDraft | null = null;
  let currentRun: RunDraft | null = null;
  let captureText = false;
  let textBuffer = '';
  const tableStack: TableDraft[] = [];
  let cell: CellDraft | null = null;

  const pushBlock = (line: string): void => {
    blocks.push(line);
  };

  let lastIndex = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  for (m = TAG_RE.exec(source); m !== null; m = TAG_RE.exec(source)) {
    const [raw = '', closing = '', name = '', attrs = '', selfClosing = ''] = m;
    // 标签之间的文本仅在被 w:t 捕获时进入投影。
    const between = source.slice(lastIndex, m.index);
    if (captureText) textBuffer += between;
    else if (between.trim().length > 0) {
      throw new DocxError(`document.xml 结构损坏：标签外存在游离文本`, 'DOCX_INVALID_XML');
    }
    lastIndex = m.index + raw.length;

    if (closing) {
      const top = stack.pop();
      if (top !== name) {
        throw new DocxError(
          `document.xml 结构损坏：${name} 与 ${top ?? '(空栈)'} 不配对`,
          'DOCX_INVALID_XML',
        );
      }
      if (name === 'w:t') {
        if (currentRun) currentRun.text += decodeEntities(textBuffer);
        textBuffer = '';
        captureText = false;
      } else if (name === 'w:r') {
        if (currentRun && currentRun.text.length > 0 && paragraph) paragraph.runs.push(currentRun);
        currentRun = null;
      } else if (name === 'w:p') {
        const draft = paragraph;
        paragraph = null;
        if (!draft) continue;
        const text = renderRuns(draft.runs);
        if (text.trim().length === 0) continue;
        if (cell) cell.paragraphs.push(text);
        else pushBlock(renderParagraphLine(draft, text));
      } else if (name === 'w:tc') {
        const table = tableStack[tableStack.length - 1];
        if (cell && table) {
          table.currentRowCells ??= [];
          table.currentRowCells.push(cell);
        }
        cell = null;
      } else if (name === 'w:tr') {
        const table = tableStack[tableStack.length - 1];
        if (table?.currentRowCells) {
          const line = table.currentRowCells
            .map((c) => c.paragraphs.join('\n').trim())
            .filter((t) => t.length > 0)
            .join(' | ');
          if (line.length > 0) pushBlock(line);
          table.currentRowCells = null;
        }
      } else if (name === 'w:tbl') {
        tableStack.pop();
      }
      continue;
    }

    if (!selfClosing) {
      stack.push(name);
      rootName ??= name;
    }

    switch (name) {
      case 'w:p':
        if (!selfClosing) paragraph = { style: null, list: false, runs: [] };
        break;
      case 'w:r':
        currentRun = { text: '', bold: false, italic: false };
        break;
      case 'w:b':
        if (currentRun) currentRun.bold = true;
        break;
      case 'w:i':
        if (currentRun) currentRun.italic = true;
        break;
      case 'w:t':
        if (!selfClosing) {
          captureText = true;
          textBuffer = '';
        }
        break;
      case 'w:br':
        if (currentRun) currentRun.text += '\n';
        break;
      case 'w:tab':
        if (currentRun) currentRun.text += '\t';
        break;
      case 'w:pStyle': {
        const val = attrValue(attrs, 'w:val');
        if (paragraph && val) paragraph.style = val;
        break;
      }
      case 'w:numPr':
        if (paragraph) paragraph.list = true;
        break;
      case 'w:tbl':
        if (!selfClosing) tableStack.push({ currentRowCells: null });
        break;
      case 'w:tr':
        if (!selfClosing && tableStack.length > 0) {
          tableStack[tableStack.length - 1]!.currentRowCells = [];
        }
        break;
      case 'w:tc':
        if (!selfClosing) cell = { paragraphs: [] };
        break;
      default:
        break;
    }
  }

  if (!captureText && source.slice(lastIndex).trim().length > 0) {
    throw new DocxError('document.xml 结构损坏：末尾存在游离文本', 'DOCX_INVALID_XML');
  }
  if (stack.length > 0) {
    throw new DocxError(
      `document.xml 结构损坏：存在未闭合标签 ${stack[stack.length - 1]}`,
      'DOCX_INVALID_XML',
    );
  }
  if (rootName !== 'w:document') {
    throw new DocxError(`document.xml 根元素异常: ${rootName ?? '(空)'}`, 'DOCX_INVALID_XML');
  }
  return blocks.join('\n\n');
}

/** 读取 docx 字节中的 word/document.xml（zip + XML 双重校验）并返回 Markdown 投影。 */
export function projectDocxToMarkdown(bytes: Buffer): string {
  const xmlBytes = readZipEntry(bytes, DOCUMENT_ENTRY);
  return documentXmlToMarkdown(xmlBytes.toString('utf8'));
}
