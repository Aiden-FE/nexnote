type ReasoningTag = 'think' | 'analysis';

type TagInspection =
  { kind: 'potential' } | { kind: 'tag'; name: ReasoningTag; closing: boolean } | { kind: 'text' };

const REASONING_TAGS: readonly ReasoningTag[] = ['think', 'analysis'];

function isTagWhitespace(character: string): boolean {
  return /\s/u.test(character);
}

/**
 * Recognise only complete think/analysis protocol tags. Similar HTML/text such as
 * `<thinking>` is rejected as normal content, while case and whitespace inside a
 * protocol tag are accepted across arbitrary stream boundaries.
 */
function inspectTag(value: string): TagInspection {
  let index = 1;
  while (index < value.length && isTagWhitespace(value[index]!)) index += 1;
  if (index === value.length) return { kind: 'potential' };

  const closing = value[index] === '/';
  if (closing) {
    index += 1;
    while (index < value.length && isTagWhitespace(value[index]!)) index += 1;
    if (index === value.length) return { kind: 'potential' };
  }

  const nameStart = index;
  while (index < value.length && /[a-z]/i.test(value[index]!)) index += 1;
  const fragment = value.slice(nameStart, index).toLowerCase();
  const candidates = REASONING_TAGS.filter((name) => name.startsWith(fragment));
  if (!fragment || candidates.length === 0) return { kind: 'text' };
  if (index === value.length) return { kind: 'potential' };

  const name = candidates.find((candidate) => candidate === fragment);
  if (!name) return { kind: 'text' };

  while (index < value.length && isTagWhitespace(value[index]!)) index += 1;
  if (index === value.length) return { kind: 'potential' };
  if (value[index] !== '>' || index !== value.length - 1) return { kind: 'text' };
  return { kind: 'tag', name, closing };
}

export interface ReasoningStreamFilter {
  push(chunk: string): string;
  finish(): string;
}

/**
 * Filters reasoning protocol blocks without exposing tentative markers or hidden
 * text. An incomplete opening marker is held during streaming, then restored by
 * finish() when it proved to be ordinary text. Once a complete opening tag is
 * observed, everything remains hidden until the matching nested block closes.
 */
export function createReasoningStreamFilter(): ReasoningStreamFilter {
  let pendingTag = '';
  let hiddenTags: ReasoningTag[] = [];
  let finished = false;

  const push = (chunk: string): string => {
    if (finished) return '';
    let output = '';

    for (const character of chunk) {
      if (!pendingTag) {
        if (character === '<') pendingTag = character;
        else if (hiddenTags.length === 0) output += character;
        continue;
      }

      pendingTag += character;
      const inspection = inspectTag(pendingTag);
      if (inspection.kind === 'potential') continue;

      if (inspection.kind === 'text') {
        const nextTagAt = pendingTag.lastIndexOf('<');
        const text = nextTagAt > 0 ? pendingTag.slice(0, nextTagAt) : pendingTag;
        if (hiddenTags.length === 0) output += text;
        pendingTag = nextTagAt > 0 ? pendingTag.slice(nextTagAt) : '';
        continue;
      }

      const completeTag = pendingTag;
      pendingTag = '';
      if (!inspection.closing) {
        hiddenTags.push(inspection.name);
      } else if (hiddenTags.at(-1) === inspection.name) {
        hiddenTags = hiddenTags.slice(0, -1);
      } else if (hiddenTags.length === 0) {
        output += completeTag;
      }
    }

    return output;
  };

  return {
    push,
    finish: () => {
      if (finished) return '';
      const output = hiddenTags.length === 0 ? pendingTag : '';
      pendingTag = '';
      hiddenTags = [];
      finished = true;
      return output;
    },
  };
}

export function sanitizeReasoningArtifacts(text: string): string {
  const filter = createReasoningStreamFilter();
  return filter.push(text) + filter.finish();
}
