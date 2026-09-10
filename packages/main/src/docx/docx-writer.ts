import { buildZip } from './zip';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

function inlineRuns(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain) runs.push({ text: plain });
    plain = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        runs.push({ text: text.slice(i + 2, end), bold: true });
        i = end + 1;
        continue;
      }
    }
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i + 1) {
        flush();
        runs.push({ text: text.slice(i + 1, end), italic: true });
        i = end;
        continue;
      }
    }
    plain += text[i];
  }
  flush();
  return runs;
}

function runXml(run: InlineRun): string {
  const props =
    run.bold || run.italic
      ? `<w:rPr>${run.bold ? '<w:b/>' : ''}${run.italic ? '<w:i/>' : ''}</w:rPr>`
      : '';
  return `<w:r>${props}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
}

function paragraphXml(text: string, heading: number | null, list: boolean): string {
  const pStyle = heading
    ? `<w:pPr><w:pStyle w:val="Heading${heading}"/></w:pPr>`
    : list
      ? '<w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr>'
      : '';
  return `<w:p>${pStyle}${inlineRuns(text).map(runXml).join('')}</w:p>`;
}

function documentXml(markdown: string): string {
  const paragraphs: string[] = [];
  let pending: string[] = [];
  const flush = (): void => {
    if (pending.length > 0) {
      paragraphs.push(paragraphXml(pending.join('\n'), null, false));
      pending = [];
    }
  };
  for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      paragraphs.push(paragraphXml(heading[2]!, heading[1]!.length, false));
      continue;
    }
    const list = /^\s*[-*]\s+(.*)$/.exec(line);
    if (list) {
      flush();
      // 保留 Markdown 列表标记，避免无 numbering.xml 时 Word 丢失语义。
      paragraphs.push(paragraphXml(`- ${list[1]!}`, null, true));
      continue;
    }
    pending.push(line);
  }
  flush();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body>${paragraphs.join('')}<w:sectPr/></w:body></w:document>`;
}

function stylesXml(): string {
  const styles = Array.from({ length: 6 }, (_, i) => {
    const level = i + 1;
    const size = 32 - i * 2;
    return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:pPr><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W_NS}">${styles}</w:styles>`;
}

/** 将 Markdown 写出为 Word/Pages 可打开的最小 DOCX 包。 */
export function markdownToDocx(markdown: string): Buffer {
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml(markdown), 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(stylesXml(), 'utf8') },
  ]);
}
