/**
 * 面向产品文档的最小 Markdown 渲染器。
 * 只支持仓库章节实际用到的语法：标题、段落、有序/无序列表、围栏代码块、
 * 引用、GFM 表格，以及行内的 `code` / **bold** / *italic* / [link](href)。
 * 输出经过转义；链接仅允许相对路径、锚点与 http(s)。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 由标题文本派生稳定锚点 id；渲染器与目录共用，保证两处一致。 */
export function headingId(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `h-${slug || 'section'}`;
}

function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('#')) {
    return trimmed;
  }
  return null;
}

function inline(text: string): string {
  const codes: string[] = [];
  // 用私用区字符作占位标记，避免控制字符触发 no-control-regex。
  const OPEN = '\uE000';
  const CLOSE = '\uE001';
  // 先摘出行内代码，避免其内部内容被后续规则改写。
  const withPlaceholders = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `${OPEN}${codes.length - 1}${CLOSE}`;
  });

  const html = escapeHtml(withPlaceholders)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
      const safe = safeHref(href);
      if (!safe) return match;
      const external = /^https?:/i.test(safe);
      const attributes = external ? ' rel="noreferrer noopener" target="_blank"' : '';
      return `<a href="${escapeHtml(safe)}"${attributes}>${label}</a>`;
    })
    // 文档里的 Wiki 双链只作术语展示，不产生站内链接。
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match, target: string, label?: string) =>
        `<span class="wiki">${escapeHtml(label ?? target)}</span>`,
    );

  const restore = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g');
  return html.replace(restore, (_match, index: string) => codes[Number(index)] ?? '');
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());
}

const isTableDivider = (line: string): boolean =>
  line.includes('-') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line);

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const paragraph: string[] = [];
  let index = 0;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph.length = 0;
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      flushParagraph();
      index += 1;
      continue;
    }

    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flushParagraph();
      const language = fence[1] ?? '';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      const attribute = language ? ` class="lang-${escapeHtml(language)}"` : '';
      out.push(`<pre${attribute}><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = (heading[1] ?? '#').length;
      const title = (heading[2] ?? '').trim();
      const id = level >= 2 && level <= 3 ? ` id="${escapeHtml(headingId(title))}"` : '';
      out.push(`<h${level}${id}>${inline(title)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const body: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        body.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index += 1;
      }
      out.push(`<blockquote><p>${inline(body.join(' '))}</p></blockquote>`);
      continue;
    }

    if (line.includes('|') && isTableDivider(lines[index + 1] ?? '')) {
      flushParagraph();
      const header = splitRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length) {
        const row = lines[index] ?? '';
        if (!row.includes('|') || row.trim() === '') break;
        rows.push(splitRow(row));
        index += 1;
      }
      const head = header.map((cell) => `<th>${inline(cell)}</th>`).join('');
      const body = rows
        .map(
          (row) =>
            `<tr>${header.map((_cell, i) => `<td>${inline(row[i] ?? '')}</td>`).join('')}</tr>`,
        )
        .join('');
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const tag = ordered ? 'ol' : 'ul';
      const pattern = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items: string[] = [];
      while (index < lines.length) {
        const item = pattern.exec(lines[index] ?? '');
        if (!item) break;
        items.push(`<li>${inline((item[1] ?? '').trim())}</li>`);
        index += 1;
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    paragraph.push(line.trim());
    index += 1;
  }

  flushParagraph();
  return out.join('\n');
}
