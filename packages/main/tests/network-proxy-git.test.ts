import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGlobalSettings } from '@nexnote/shared';
import { deriveNetworkProxy } from '../src/settings/network-proxy';
import { GitService } from '../src/git/git-service';

const roots: string[] = [];
const services: GitService[] = [];
const servers: ReturnType<typeof createServer>[] = [];

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function configureIdentity(repository: string): void {
  git(['config', 'user.name', 'NexNote Proxy Test'], repository);
  git(['config', 'user.email', 'proxy-test@nexnote.local'], repository);
}

function startGitHttpProxy(projectRoot: string): Promise<{
  server: ReturnType<typeof createServer>;
  url: string;
  requests: string[];
}> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const body: Buffer[] = [];
    request.on('data', (chunk: Buffer) => body.push(chunk));
    request.on('end', () => {
      const target = new URL(request.url ?? '', `http://${request.headers.host ?? 'origin.test'}`);
      requests.push(`${request.method} ${target.pathname}${target.search}`);
      const content = Buffer.concat(body);
      const backendPath = path.join(
        execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(),
        'git-http-backend',
      );
      const backend = spawn(backendPath, [], {
        env: {
          ...process.env,
          GATEWAY_INTERFACE: 'CGI/1.1',
          GIT_HTTP_EXPORT_ALL: '1',
          GIT_PROJECT_ROOT: projectRoot,
          HTTP_GIT_PROTOCOL: String(request.headers['git-protocol'] ?? ''),
          PATH_INFO: target.pathname,
          QUERY_STRING: target.searchParams.toString(),
          REQUEST_METHOD: request.method ?? 'GET',
          CONTENT_TYPE: String(request.headers['content-type'] ?? ''),
          CONTENT_LENGTH: String(content.length),
          REMOTE_ADDR: '127.0.0.1',
          SERVER_NAME: target.hostname,
          SERVER_PORT: target.port || '80',
          SERVER_PROTOCOL: 'HTTP/1.1',
        },
      });
      const output: Buffer[] = [];
      const errors: Buffer[] = [];
      backend.stdout.on('data', (chunk: Buffer) => output.push(chunk));
      backend.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
      backend.once('error', (error) => {
        response.writeHead(500);
        response.end(String(error));
      });
      backend.once('close', (code) => {
        const result = Buffer.concat(output);
        const divider = result.indexOf(Buffer.from('\r\n\r\n'));
        if (code !== 0 || divider < 0) {
          response.writeHead(500);
          response.end(Buffer.concat(errors).toString() || 'git-http-backend failed');
          return;
        }
        const headerText = result.subarray(0, divider).toString('utf8');
        const status = Number(headerText.match(/^Status:\s*(\d+)/im)?.[1] ?? 200);
        const headers: Record<string, string> = {};
        for (const line of headerText.split(/\r?\n/)) {
          const separator = line.indexOf(':');
          if (separator <= 0 || /^Status:/i.test(line)) continue;
          headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
        }
        response.writeHead(status, headers);
        response.end(result.subarray(divider + 4));
      });
      backend.stdin.end(content);
    });
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${address.port}`, requests });
    });
  });
}

const hasGitHttpBackend = (() => {
  try {
    return existsSync(
      path.join(
        execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(),
        'git-http-backend',
      ),
    );
  } catch {
    return false;
  }
})();

describe('Git proxy request path', () => {
  afterEach(async () => {
    for (const service of services.splice(0)) {
      service.cancelAutoCommit();
      service.setRoot(null);
    }
    await Promise.all(
      servers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            ),
        ),
    );
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it.skipIf(!hasGitHttpBackend)(
    'does not inherit shell proxy when Git proxy is disabled',
    async () => {
      vi.stubEnv('GIT_EDITOR', undefined);
      const root = mkdtempSync(path.join(tmpdir(), 'nexnote-git-proxy-off-test-'));
      roots.push(root);
      const projectRoot = path.join(root, 'projects');
      mkdirSync(projectRoot, { recursive: true });
      git(['init', root]);
      const { url: proxyUrl, requests } = await startGitHttpProxy(projectRoot);
      for (const key of [
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'ALL_PROXY',
        'http_proxy',
        'https_proxy',
        'all_proxy',
      ]) {
        vi.stubEnv(key, proxyUrl);
      }
      const service = new GitService({ useSystemGit: true });
      services.push(service);
      service.setRoot(root);
      const proxy = new URL(proxyUrl);
      service.setNetworkProxy(
        deriveNetworkProxy(
          {
            ...defaultGlobalSettings().network,
            mode: 'http',
            host: proxy.hostname,
            port: Number(proxy.port),
            bypass: ['origin.test'],
          },
          null,
        ),
      );
      await expect(service.addRemote('bypass', 'http://origin.test/repo.git')).rejects.toThrow();
      expect(requests).toEqual([]);

      service.setNetworkProxy(
        deriveNetworkProxy({ ...defaultGlobalSettings().network, applyToGit: false }, null),
      );
      await expect(service.addRemote('origin', 'http://origin.test/repo.git')).rejects.toThrow();
      expect(requests).toEqual([]);
    },
  );

  it.skipIf(!hasGitHttpBackend)(
    'supports ls-remote, fetch, pull, and push through a system proxy snapshot',
    async () => {
      vi.stubEnv('GIT_EDITOR', undefined);
      const root = mkdtempSync(path.join(tmpdir(), 'nexnote-git-proxy-test-'));
      roots.push(root);
      const projectRoot = path.join(root, 'projects');
      const bare = path.join(projectRoot, 'repo.git');
      const seed = path.join(root, 'seed');
      const working = path.join(root, 'working');
      mkdirSync(projectRoot, { recursive: true });
      git(['init', '--bare', '--initial-branch=main', bare]);
      git(['--git-dir', bare, 'config', 'http.receivepack', 'true']);
      git(['init', '--initial-branch=main', seed]);
      configureIdentity(seed);
      writeFileSync(path.join(seed, 'remote.md'), 'remote v1');
      git(['add', 'remote.md'], seed);
      git(['commit', '-m', 'seed remote'], seed);
      git(['remote', 'add', 'origin', bare], seed);
      git(['push', '-u', 'origin', 'main'], seed);
      git(['--git-dir', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
      git(['clone', bare, working]);
      configureIdentity(working);

      const { url: proxyUrl, requests } = await startGitHttpProxy(projectRoot);
      const remoteUrl = 'http://origin.test/repo.git';
      const service = new GitService({ useSystemGit: true, minCommitIntervalMs: 0 });
      services.push(service);
      service.setRoot(working);
      service.setNetworkProxy(
        deriveNetworkProxy(defaultGlobalSettings().network, {
          http: proxyUrl,
          https: proxyUrl,
          socks: null,
        }),
      );
      await service.addRemote('origin', remoteUrl);
      await service.pull();

      writeFileSync(path.join(seed, 'remote.md'), 'remote v2');
      git(['add', 'remote.md'], seed);
      git(['commit', '-m', 'update remote'], seed);
      git(['push', 'origin', 'main'], seed);
      await service.sync({ strategy: 'merge' });
      expect(
        await import('node:fs/promises').then(({ readFile }) =>
          readFile(path.join(working, 'remote.md'), 'utf8'),
        ),
      ).toBe('remote v2');

      writeFileSync(path.join(working, 'local.md'), 'local push');
      await service.commitManual('local change');
      await service.push();
      expect(git(['--git-dir', bare, 'show', 'main:local.md'])).toBe('local push');
      expect(
        requests.some((request) =>
          request.startsWith('GET /repo.git/info/refs?service=git-upload-pack'),
        ),
      ).toBe(true);
      expect(requests.some((request) => request.startsWith('POST /repo.git/git-upload-pack'))).toBe(
        true,
      );
      expect(
        requests.some((request) =>
          request.startsWith('GET /repo.git/info/refs?service=git-receive-pack'),
        ),
      ).toBe(true);
      expect(
        requests.some((request) => request.startsWith('POST /repo.git/git-receive-pack')),
      ).toBe(true);
    },
  );
});
