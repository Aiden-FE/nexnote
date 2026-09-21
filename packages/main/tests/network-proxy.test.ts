import { describe, expect, it } from 'vitest';
import { defaultGlobalSettings, type NetworkSettings } from '@nexnote/shared';
import {
  deriveAiProxyUrl,
  deriveNetworkProxy,
} from '../src/settings/network-proxy';
import type { SystemProxySnapshot } from '../src/settings/system-proxy';

const systemProxy: SystemProxySnapshot = {
  http: 'http://sys-proxy.local:3128',
  https: 'http://sys-proxy.local:3128',
  socks: null,
};

function net(overrides: Partial<NetworkSettings> = {}): NetworkSettings {
  return { ...defaultGlobalSettings().network, ...overrides };
}

describe('deriveNetworkProxy', () => {
  it('applyToGit=false 或 mode=off 时不注入', () => {
    expect(deriveNetworkProxy(net({ applyToGit: false }), systemProxy)).toEqual({
      env: null,
      cliConfig: null,
    });
    expect(deriveNetworkProxy(net({ mode: 'off' }), systemProxy)).toEqual({
      env: null,
      cliConfig: null,
    });
  });

  it('system 模式 + 有快照时注入 OS 代理 env 与 git -c 配置', () => {
    const result = deriveNetworkProxy(net(), systemProxy);
    expect(result.env).toEqual({
      HTTPS_PROXY: 'http://sys-proxy.local:3128',
      HTTP_PROXY: 'http://sys-proxy.local:3128',
    });
    expect(result.cliConfig).toEqual([
      'http.proxy=http://sys-proxy.local:3128',
      'https.proxy=http://sys-proxy.local:3128',
    ]);
  });

  it('system 模式 + 无快照时继承宿主 env（返回 null）', () => {
    expect(deriveNetworkProxy(net(), null)).toEqual({ env: null, cliConfig: null });
  });

  it('自定义 http 模式生成完整 URL + 双通道', () => {
    const result = deriveNetworkProxy(
      net({ mode: 'http', host: 'proxy.local', port: 8080 }),
      null,
    );
    expect(result.env!.HTTPS_PROXY).toBe('http://proxy.local:8080');
    expect(result.cliConfig).toEqual([
      'http.proxy=http://proxy.local:8080',
      'https.proxy=http://proxy.local:8080',
    ]);
  });

  it('自定义 socks5 模式只注入 http.proxy（git 不认 https.proxy 的 socks 前缀）', () => {
    const result = deriveNetworkProxy(
      net({ mode: 'socks5', host: '10.0.0.1', port: 1080 }),
      null,
    );
    expect(result.cliConfig).toEqual(['http.proxy=socks5://10.0.0.1:1080']);
  });

  it('自定义模式带认证时对 user/password 进行 URL 编码', () => {
    const result = deriveNetworkProxy(
      net({ mode: 'http', host: 'p.local', port: 80, username: 'a b', password: 'p@ss' }),
      null,
    );
    expect(result.env!.HTTPS_PROXY).toBe('http://a%20b:p%40ss@p.local:80');
  });

  it('host/port 缺失的自定义模式不注入', () => {
    expect(deriveNetworkProxy(net({ mode: 'http' }), null)).toEqual({
      env: null,
      cliConfig: null,
    });
  });
});

describe('deriveAiProxyUrl', () => {
  it('applyToAi=false 恒为 null', () => {
    expect(deriveAiProxyUrl(net({ applyToAi: false }), systemProxy)).toBeNull();
  });

  it('system 模式优先取 https 快照', () => {
    expect(deriveAiProxyUrl(net(), systemProxy)).toBe('http://sys-proxy.local:3128');
  });

  it('system 模式无快照返回 null（直连）', () => {
    expect(deriveAiProxyUrl(net(), null)).toBeNull();
  });

  it('自定义模式返回代理 URL，off 返回 null', () => {
    expect(deriveAiProxyUrl(net({ mode: 'https', host: 'h', port: 1 }), null)).toBe('https://h:1');
    expect(deriveAiProxyUrl(net({ mode: 'off' }), systemProxy)).toBeNull();
  });
});
