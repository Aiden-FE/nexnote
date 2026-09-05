/** 文件名 ↔ H1 绑定的纯函数（可单测、无 Electron 依赖）。 */

export function titleFromPath(path: string): string {
  const name = path.split('/').at(-1) ?? path;
  return name.replace(/\.md$/i, '') || '未命名页面';
}

export function sanitizePageTitle(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || '未命名页面';
}

export function parentDir(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? '' : path.slice(0, idx);
}

export function pagePathForTitle(currentPath: string, title: string): string {
  const dir = parentDir(currentPath);
  const name = `${sanitizePageTitle(title)}.md`;
  return dir ? `${dir}/${name}` : name;
}

/** 替换/插入文档首个 H1；frontmatter 保持文档最前。 */
export function bindH1ToTitle(markdown: string, title: string): string {
  const h1 = `# ${title}`;
  const lines = markdown.split('\n');
  let bodyStart = 0;

  if (lines[0]?.trim() === '---') {
    const close = lines.slice(1).findIndex((line) => line.trim() === '---');
    if (close >= 0) bodyStart = close + 2;
    while (bodyStart < lines.length && lines[bodyStart]?.trim() === '') bodyStart += 1;
  }

  // 只把正文第一块 H1 视为绑定标题；正文中后续 H1 不参与文件名绑定。
  const first = lines[bodyStart] ?? '';
  if (/^#\s+/.test(first)) {
    lines[bodyStart] = h1;
  } else {
    lines.splice(bodyStart, 0, h1, '');
  }
  return lines.join('\n');
}

/** 文档首个正文块为 H1 时返回标题；跳过 frontmatter。 */
export function firstH1(markdown: string): string | null {
  const lines = markdown.split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i]?.trim() !== '---') i += 1;
    i += 1;
  }
  while (i < lines.length && lines[i]?.trim() === '') i += 1;
  const m = /^#\s+(.+?)(?:\s+\^[A-Za-z0-9-]+)?\s*$/.exec(lines[i] ?? '');
  return m?.[1]?.trim() || null;
}
