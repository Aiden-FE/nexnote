import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseEnvironmentProxy,
  parseScutilProxy,
  parseWindowsRegistry,
  detectSystemProxy,
} from '../src/settings/system-proxy';

describe('parseScutilProxy（macOS scutil --proxy 输出解析）', () => {
  it('解析启用状态的 HTTP/HTTPS 代理', () => {
    const output = [
      '<dictionary> {',
      '  HTTPEnable : 1',
      '  HTTPPort : 7890',
      '  HTTPProxy : 127.0.0.1',
      '  HTTPSEnable : 1',
      '  HTTPSPort : 7890',
      '  HTTPSProxy : 127.0.0.1',
      '  SOCKSEnable : 0',
      '}',
    ].join('\n');
    const result = parseScutilProxy(output);
    expect(result).not.toBeNull();
    expect(result!.http).toBe('http://127.0.0.1:7890');
    expect(result!.https).toBe('http://127.0.0.1:7890');
    expect(result!.socks).toBeNull();
  });

  it('SOCKS 代理独立解析', () => {
    const output = ['SOCKSEnable : 1', 'SOCKSPort : 1080', 'SOCKSProxy : 10.0.0.1'].join('\n');
    const result = parseScutilProxy(output);
    expect(result!.socks).toBe('http://10.0.0.1:1080');
    expect(result!.http).toBeNull();
    expect(result!.https).toBeNull();
  });

  it('全部未启用时返回 null', () => {
    expect(parseScutilProxy('HTTPEnable : 0\nHTTPSEnable : 0\nSOCKSEnable : 0')).toBeNull();
  });

  it('启用但缺 host/port 时返回 null', () => {
    expect(parseScutilProxy('HTTPEnable : 1\nHTTPPort : 7890')).toBeNull();
  });
});

describe('parseWindowsRegistry（Windows reg query 输出解析）', () => {
  it('ProxyEnable=1 + 单一 ProxyServer 时同时用于 http/https', () => {
    const output = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '    ProxyEnable    REG_DWORD    0x1',
      '    ProxyServer    REG_SZ    proxy.corp.example:8080',
    ].join('\n');
    const result = parseWindowsRegistry(output);
    expect(result!.http).toBe('http://proxy.corp.example:8080');
    expect(result!.https).toBe('http://proxy.corp.example:8080');
  });

  it('按协议拆分形式解析', () => {
    const output = [
      '    ProxyEnable    REG_DWORD    0x1',
      '    ProxyServer    REG_SZ    http=10.0.0.2:8080;https=10.0.0.2:8443;socks=10.0.0.2:1080',
    ].join('\n');
    const result = parseWindowsRegistry(output);
    expect(result!.http).toBe('http://10.0.0.2:8080');
    expect(result!.https).toBe('http://10.0.0.2:8443');
    expect(result!.socks).toBe('socks5://10.0.0.2:1080');
  });

  it('ProxyEnable=0 时返回 null', () => {
    expect(parseWindowsRegistry('ProxyEnable REG_DWORD 0x0')).toBeNull();
  });
});

describe('parseEnvironmentProxy（HTTP_PROXY 等环境变量）', () => {
  it('识别 HTTP/HTTPS 与 SOCKS 代理环境变量', () => {
    expect(
      parseEnvironmentProxy({
        http_proxy: 'http://127.0.0.1:7897',
        https_proxy: 'http://127.0.0.1:7897',
        all_proxy: 'socks5://127.0.0.1:7897',
      }),
    ).toEqual({
      http: 'http://127.0.0.1:7897',
      https: 'http://127.0.0.1:7897',
      socks: 'socks5://127.0.0.1:7897',
    });
  });

  it('只配置 HTTPS 时使用它作为 HTTPS 代理', () => {
    expect(parseEnvironmentProxy({ HTTPS_PROXY: 'http://proxy.local:8080' })).toEqual({
      http: null,
      https: 'http://proxy.local:8080',
      socks: null,
    });
  });
});

describe('detectSystemProxy（缓存行为）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TTL 内复用缓存，不重复探测', async () => {
    const first = await detectSystemProxy(true);
    const second = await detectSystemProxy();
    expect(second).toBe(first);
  });
});
