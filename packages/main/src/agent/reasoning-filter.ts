const OPEN_TAGS = ['<think>', '<analysis>'] as const;

type ReasoningTag = 'think' | 'analysis';

function partialTagSuffix(buffer: string, candidates: readonly string[]): number {
  const lower = buffer.toLowerCase();
  for (
    let length = Math.min(lower.length, Math.max(...candidates.map((tag) => tag.length)));
    length > 0;
    length -= 1
  ) {
    const suffix = lower.slice(-length);
    if (candidates.some((tag) => tag.startsWith(suffix))) return length;
  }
  return 0;
}

export interface ReasoningStreamFilter {
  push(chunk: string): string;
  finish(): string;
}

export function createReasoningStreamFilter(): ReasoningStreamFilter {
  let buffer = '';
  let hiddenTag: ReasoningTag | null = null;

  const push = (chunk: string): string => {
    buffer += chunk;
    let output = '';

    while (buffer) {
      if (hiddenTag) {
        const closingTag = `</${hiddenTag}>`;
        const closeAt = buffer.toLowerCase().indexOf(closingTag);
        if (closeAt < 0) {
          const keep = partialTagSuffix(buffer, [closingTag]);
          buffer = keep > 0 ? buffer.slice(-keep) : '';
          break;
        }
        buffer = buffer.slice(closeAt + closingTag.length);
        hiddenTag = null;
        continue;
      }

      const lower = buffer.toLowerCase();
      const matches = OPEN_TAGS.map((tag) => ({ tag, index: lower.indexOf(tag) })).filter(
        (match) => match.index >= 0,
      );
      const opening = matches.sort((left, right) => left.index - right.index)[0];
      if (opening) {
        output += buffer.slice(0, opening.index);
        hiddenTag = opening.tag === '<think>' ? 'think' : 'analysis';
        buffer = buffer.slice(opening.index + opening.tag.length);
        continue;
      }

      const keep = partialTagSuffix(buffer, OPEN_TAGS);
      if (keep > 0) {
        output += buffer.slice(0, -keep);
        buffer = buffer.slice(-keep);
      } else {
        output += buffer;
        buffer = '';
      }
      break;
    }

    return output;
  };

  return {
    push,
    finish: () => {
      const partial = hiddenTag ? 0 : partialTagSuffix(buffer, OPEN_TAGS);
      const output = hiddenTag ? '' : partial > 0 ? buffer.slice(0, -partial) : buffer;
      buffer = '';
      hiddenTag = null;
      return output;
    },
  };
}

export function sanitizeReasoningArtifacts(text: string): string {
  const filter = createReasoningStreamFilter();
  return filter.push(text) + filter.finish();
}
