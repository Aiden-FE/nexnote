// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createSourceEditor } from '../src/editor/source/codemirror-host';

function mount(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  return createSourceEditor(parent, { initialText: text, onChange: () => undefined });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('DEV-029 source-mode fence decoration highlighting', () => {
  it('decorates a lazily loaded language fence once the grammar arrives', async () => {
    const editor = mount('```dockerfile\nFROM node:22\nRUN echo hi\n```\n');
    await settle();
    expect(document.querySelectorAll('.cm-content [class*="hljs-"]').length).toBeGreaterThan(0);
    editor.destroy();
    document.body.innerHTML = '';
  });

  it('renders toml fences with the kernel-provided grammar', async () => {
    const editor = mount('```toml\n[server]\nport = 8080\n```\n');
    await settle();
    expect(document.querySelectorAll('.cm-content [class*="hljs-"]').length).toBeGreaterThan(0);
    editor.destroy();
    document.body.innerHTML = '';
  });

  it('renders unknown language fences as plain text without console errors', async () => {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener('error', onError);
    const editor = mount('```not-a-language\njust text\n```\n');
    await settle();
    expect(document.querySelectorAll('.cm-content [class*="hljs-"]')).toHaveLength(0);
    expect(errors).toHaveLength(0);
    window.removeEventListener('error', onError);
    editor.destroy();
    document.body.innerHTML = '';
  });
});
