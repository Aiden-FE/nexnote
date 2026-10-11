// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { createElement } from 'react';
import type { PluginAuditRecord, PluginView } from '@nexnote/shared';
import { PluginsSettingsPage } from '../src/features/plugins/PluginsSettingsPage';
import { setLanguage } from '../src/lib/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const crashedPlugin: PluginView = {
  id: 'com.demo.crashed',
  name: 'Demo Plugin',
  version: '1.0.0',
  state: 'crashed',
  permissions: [],
  grants: [],
  contributionCounts: { commands: 0, menus: 0, views: 0, blockTypes: 0 },
  lastError: 'PLUGIN_HEARTBEAT_TIMEOUT',
};

const auditRecords: PluginAuditRecord[] = [
  {
    id: 'audit-timeout',
    pluginId: crashedPlugin.id,
    operation: 'rpc',
    allowed: false,
    detail: 'PLUGIN_HEARTBEAT_TIMEOUT',
    at: Date.UTC(2026, 9, 11, 8, 0, 0),
  },
  {
    id: 'audit-raw',
    pluginId: crashedPlugin.id,
    operation: 'rpc',
    allowed: false,
    detail: 'boom',
    at: Date.UTC(2026, 9, 11, 8, 0, 1),
  },
];

function installBridge(): void {
  const invokeFn = vi.fn(async (channel: string) => {
    if (channel === 'plugins:list') return { ok: true, data: [crashedPlugin] };
    if (channel === 'plugins:listAuditLog') return { ok: true, data: auditRecords };
    throw new Error(`unexpected IPC channel: ${channel}`);
  });
  (window as unknown as { nexnote: { invoke: typeof invokeFn; on(): () => void } }).nexnote = {
    invoke: invokeFn,
    on: vi.fn(() => () => undefined),
  };
}

describe('PluginsSettingsPage 稳定错误码展示', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installBridge();
    setLanguage('en-US');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    setLanguage('zh-CN');
  });

  it('本地化应用生成的 heartbeat 错误，但保留第三方崩溃原文', async () => {
    await act(async () => {
      root.render(createElement(PluginsSettingsPage));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container.textContent).toContain('Demo Plugin');
    expect(container.querySelector('[data-testid="plugin-last-error"]')?.textContent).toBe(
      'Last error: The plugin script is not responding (heartbeat timeout).',
    );
    expect(container.querySelector('[data-testid="plugin-audit"]')).not.toBeNull();
    const audit = container.querySelector('[data-testid="plugin-audit"]');
    expect(audit?.textContent).toContain(
      'The plugin script is not responding (heartbeat timeout).',
    );
    expect(audit?.textContent).toContain('boom');
  });
});
