/** NexNote-owned binary-document .gitignore stanza (ADR-0015 Decision 7). */
export const BINARY_IGNORE_MARKER = '# NexNote binary documents (DEV-074)';
const BINARY_IGNORE_RULES = ['*.docx', '*.xlsx', '*.xmind'] as const;

/**
 * Keep unrelated user rules and their line-ending convention untouched while toggling
 * NexNote's exact binary rules. Repeated enable/disable calls are idempotent.
 */
export function updateBinaryIgnoreBlock(current: string, untrack: boolean): string {
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const rules = new Set<string>([BINARY_IGNORE_MARKER, ...BINARY_IGNORE_RULES]);
  const lines = current.split(/\r?\n/).filter((line) => !rules.has(line));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (untrack) lines.push('', BINARY_IGNORE_MARKER, ...BINARY_IGNORE_RULES);
  return lines.length ? `${lines.join(eol)}${eol}` : '';
}
