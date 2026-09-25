import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProxyFetch } from '../src/ai/provider/proxy-fetch';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('createProxyFetch', () => {
  it('propagates proxy request failures without retrying through global fetch', async () => {
    const proxyError = new Error('proxy unavailable');
    const proxyFetch = vi.fn().mockRejectedValue(proxyError);
    const directFetch = vi.fn().mockResolvedValue(new Response('direct'));
    const loadProxyFetch = vi.fn(async () => proxyFetch as unknown as typeof fetch);
    vi.stubGlobal('fetch', directFetch);
    const fetchWithProxy = createProxyFetch('http://proxy.local:3128', [], loadProxyFetch);

    await expect(fetchWithProxy('https://provider.local/v1/chat/completions')).rejects.toBe(
      proxyError,
    );
    expect(loadProxyFetch).toHaveBeenCalledOnce();
    expect(proxyFetch).toHaveBeenCalledOnce();
    expect(directFetch).not.toHaveBeenCalled();
  });

  it('propagates proxy initialization failures without using global fetch', async () => {
    const importError = new Error('undici unavailable');
    const directFetch = vi.fn().mockResolvedValue(new Response('direct'));
    const loadProxyFetch = vi.fn(async () => {
      throw importError;
    });
    vi.stubGlobal('fetch', directFetch);
    const fetchWithProxy = createProxyFetch('http://proxy.local:3128', [], loadProxyFetch);

    await expect(fetchWithProxy('https://provider.local/v1/models')).rejects.toBe(importError);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it('routes an HTTP request through the installed undici ProxyAgent', async () => {
    const urls: string[] = [];
    const proxy = createServer((request, response) => {
      urls.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('proxied');
    });
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    const address = proxy.address() as AddressInfo;

    try {
      const fetchWithProxy = createProxyFetch(`http://127.0.0.1:${address.port}`);
      const response = await fetchWithProxy('http://origin.test/v1/models');
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('proxied');
      expect(urls).toEqual(['http://origin.test/v1/models']);
    } finally {
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('bypasses configured hosts without sending them to the proxy', async () => {
    const proxiedRequests: string[] = [];
    const proxy = createServer((request, response) => {
      proxiedRequests.push(request.url ?? '');
      response.writeHead(502);
      response.end('unexpected proxy route');
    });
    const destination = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('direct');
    });
    const listen = (server: ReturnType<typeof createServer>) =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    await Promise.all([listen(proxy), listen(destination)]);
    const proxyAddress = proxy.address() as AddressInfo;
    const destinationAddress = destination.address() as AddressInfo;

    try {
      const fetchWithProxy = createProxyFetch(`http://127.0.0.1:${proxyAddress.port}`, [
        '127.0.0.1',
      ]);
      const response = await fetchWithProxy(`http://127.0.0.1:${destinationAddress.port}/direct`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('direct');
      expect(proxiedRequests).toEqual([]);
    } finally {
      await Promise.all(
        [proxy, destination].map(
          (server) =>
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            ),
        ),
      );
    }
  });

  it('honors inherited no_proxy entries when no explicit bypass list is set', async () => {
    vi.stubEnv('no_proxy', '127.0.0.1');
    const proxiedRequests: string[] = [];
    const proxy = createServer((request, response) => {
      proxiedRequests.push(request.url ?? '');
      response.writeHead(502);
      response.end('unexpected proxy route');
    });
    const destination = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('direct');
    });
    const listen = (server: ReturnType<typeof createServer>) =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    await Promise.all([listen(proxy), listen(destination)]);
    const proxyAddress = proxy.address() as AddressInfo;
    const destinationAddress = destination.address() as AddressInfo;

    try {
      const fetchWithProxy = createProxyFetch(`http://127.0.0.1:${proxyAddress.port}`);
      const response = await fetchWithProxy(`http://127.0.0.1:${destinationAddress.port}/direct`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('direct');
      expect(proxiedRequests).toEqual([]);
    } finally {
      await Promise.all(
        [proxy, destination].map(
          (server) =>
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            ),
        ),
      );
    }
  });

  it('loads one proxy-bound fetch and reuses it for requests', async () => {
    const proxyFetch = vi.fn().mockResolvedValue(new Response('proxied'));
    const loadProxyFetch = vi.fn(async () => proxyFetch as unknown as typeof fetch);
    const fetchWithProxy = createProxyFetch('http://proxy.local:3128', [], loadProxyFetch);

    await expect(fetchWithProxy('https://provider.local/one')).resolves.toMatchObject({
      status: 200,
    });
    await expect(fetchWithProxy('https://provider.local/two')).resolves.toMatchObject({
      status: 200,
    });
    expect(loadProxyFetch).toHaveBeenCalledOnce();
    expect(proxyFetch).toHaveBeenCalledTimes(2);
  });
});
