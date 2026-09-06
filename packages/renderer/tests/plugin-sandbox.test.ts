import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const frameSource = readFileSync(
  join(here, '../src/features/plugins/PluginSandboxFrame.tsx'),
  'utf8',
);
const runtimeHtml = readFileSync(join(here, '../public/plugin-runtime/index.html'), 'utf8');
const bootstrap = readFileSync(join(here, '../public/plugin-runtime/bootstrap.js'), 'utf8');

describe('plugin iframe security + runtime', () => {
  it('uses minimum sandbox and external bootstrap under strict CSP', () => {
    expect(frameSource).toContain('sandbox="allow-scripts"');
    expect(frameSource).not.toContain('allow-same-origin');
    expect(frameSource).not.toContain('allow-popups');
    expect(runtimeHtml).toContain("default-src 'none'");
    expect(runtimeHtml).toContain("script-src 'self' blob:");
    expect(runtimeHtml).not.toContain("'unsafe-inline'");
    expect(runtimeHtml).toContain('<script src="./bootstrap.js"></script>');
  });

  it('loads fixture entry before lifecycle events and sends host ready afterward', () => {
    const fixture = readFileSync(
      join(here, '../../main/tests/fixtures/demo-plugin/main.js'),
      'utf8',
    );
    const listeners = new Map<string, (() => void)[]>();
    const sandbox = {
      window: {
        addEventListener: (name: string, listener: () => void) =>
          listeners.set(name, [...(listeners.get(name) ?? []), listener]),
        nexnotePlugin: { registerCommand: () => undefined },
      },
    };
    vm.runInNewContext(fixture, sandbox);
    for (const name of [
      'nexnote-plugin-initialize',
      'nexnote-plugin-activate',
      'nexnote-plugin-ready',
    ])
      for (const listener of listeners.get(name) ?? []) listener();
    expect(sandbox.window).toMatchObject({ __demoLifecycle: ['initialize', 'activate'] });
    expect(bootstrap.indexOf('script.onload')).toBeLessThan(
      bootstrap.indexOf("dispatchLifecycle('initialize')"),
    );
    expect(bootstrap).toContain("dispatchLifecycle('ready')");
    expect(bootstrap).toContain("type: 'runtime-ready'");
    expect(bootstrap).toContain("msg.type === 'lifecycle'");
    expect(frameSource).toContain("hook: 'deactivate'");
    expect(frameSource).toContain("hook: 'unload'");
  });

  it('uses versioned MessageChannel RPC, timeout and crash reporting', () => {
    expect(bootstrap).toContain("var API_VERSION = '1.0.0'");
    expect(bootstrap).toContain("type: 'rpc'");
    expect(bootstrap).toContain('RPC 超时');
    expect(bootstrap).toContain("type: 'crash'");
    expect(bootstrap).toContain('URL.createObjectURL(blob)');
  });
});
