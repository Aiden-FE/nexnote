import { describe, expect, it, vi } from 'vitest';
import { PLUGIN_API_VERSION, type PluginRpcRequest, type PluginRpcResponse } from '@nexnote/shared';
import { invokeWithPermissionRetry } from '../src/features/plugins/permission-flow';
import { SandboxHeartbeatWatchdog } from '../src/features/plugins/sandbox-watchdog';

const request: PluginRpcRequest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'permission-1',
  method: 'permission.request',
  params: { permission: 'network' },
};
const required: PluginRpcResponse = {
  apiVersion: PLUGIN_API_VERSION,
  id: request.id,
  ok: false,
  error: { code: 'PERMISSION_REQUIRED', message: '需要用户授权 network' },
};

describe('plugin permission prompt protocol', () => {
  it('prompts, grants always-allow and retries the original permission.request', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(required)
      .mockResolvedValueOnce({
        apiVersion: PLUGIN_API_VERSION,
        id: request.id,
        ok: true,
        data: { granted: true, alwaysAllow: true },
      });
    const grant = vi.fn().mockResolvedValue(undefined);
    const ask = vi.fn().mockResolvedValue({ allowed: true, alwaysAllow: true });
    const response = await invokeWithPermissionRetry('com.nexnote.demo', request, ask, {
      rpc,
      grant,
    });
    expect(ask).toHaveBeenCalledWith('network');
    expect(grant).toHaveBeenCalledWith('com.nexnote.demo', 'network', true);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(response.data).toEqual({ granted: true, alwaysAllow: true });
  });

  it('keeps granted false when the user rejects', async () => {
    const rpc = vi.fn().mockResolvedValue(required);
    const grant = vi.fn();
    const response = await invokeWithPermissionRetry(
      'com.nexnote.demo',
      request,
      async () => ({ allowed: false, alwaysAllow: false }),
      { rpc, grant },
    );
    expect(grant).not.toHaveBeenCalled();
    expect(response).toEqual(
      expect.objectContaining({ ok: true, data: { granted: false, alwaysAllow: false } }),
    );
  });
});

describe('sandbox heartbeat watchdog', () => {
  it('expires after the iframe misses its executable heartbeat budget', () => {
    const watchdog = new SandboxHeartbeatWatchdog(1_000, 2_000);
    expect(watchdog.expired(3_000)).toBe(false);
    expect(watchdog.expired(3_001)).toBe(true);
    watchdog.beat(3_001);
    expect(watchdog.expired(5_001)).toBe(false);
  });
});
