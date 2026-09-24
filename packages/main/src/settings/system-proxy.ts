import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface SystemProxySnapshot {
  /** Best candidate for HTTPS traffic; falls back to HTTP or SOCKS proxy. */
  https: string | null;
  /** Explicit HTTP proxy. */
  http: string | null;
  /** Explicit SOCKS5 proxy. */
  socks: string | null;
}

const CACHE_TTL_MS = 30_000;
let cached: { at: number; value: SystemProxySnapshot | null } | null = null;
let inflight: Promise<SystemProxySnapshot | null> | null = null;

/** Read the OS-level proxy configuration, cached for CACHE_TTL_MS. Returns null on error or no proxy. */
export function detectSystemProxy(force = false): Promise<SystemProxySnapshot | null> {
  const now = Date.now();
  if (!force && cached && now - cached.at < CACHE_TTL_MS) {
    return Promise.resolve(cached.value);
  }
  if (inflight) return inflight;
  inflight = detectByPlatform()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .catch(() => {
      cached = { at: Date.now(), value: null };
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Cached snapshot without I/O; null until the first detectSystemProxy() completes. */
export function getCachedSystemProxy(): SystemProxySnapshot | null {
  return cached && Date.now() - cached.at < CACHE_TTL_MS ? cached.value : null;
}

async function detectByPlatform(): Promise<SystemProxySnapshot | null> {
  if (process.platform === 'darwin') return detectMacOs();
  if (process.platform === 'win32') return detectWindows();
  return detectLinux();
}

/** macOS: parse `scutil --proxy` (HTTPEnable/HTTPProxy/HTTPPort, HTTPS*, SOCKS*). */
export function parseScutilProxy(output: string): SystemProxySnapshot | null {
  const map = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (value) map.set(key, value);
  }
  const http = enabledProxy(map, 'HTTPEnable', 'HTTPProxy', 'HTTPPort');
  const https = enabledProxy(map, 'HTTPSEnable', 'HTTPSProxy', 'HTTPSPort') ?? http;
  const socks = enabledProxy(map, 'SOCKSEnable', 'SOCKSProxy', 'SOCKSPort');
  if (!http && !https && !socks) return null;
  return { http, https, socks };
}

function enabledProxy(
  map: Map<string, string>,
  enableKey: string,
  hostKey: string,
  portKey: string,
): string | null {
  if (map.get(enableKey) !== '1') return null;
  const host = map.get(hostKey);
  const port = map.get(portKey);
  if (!host || !port) return null;
  return `http://${host}:${port}`;
}

async function detectMacOs(): Promise<SystemProxySnapshot | null> {
  const { stdout } = await execFileAsync('/usr/sbin/scutil', ['--proxy']);
  return parseScutilProxy(stdout);
}

/** Windows: read ProxyEnable + ProxyServer from the user registry Internet Settings key. */
export function parseWindowsRegistry(output: string): SystemProxySnapshot | null {
  const enable = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(output);
  if (!enable) return null;
const match = output.match(/ProxyServer\s+REG_SZ\s+(\S+)/i);
  const raw = match?.[1]?.trim();
  if (!raw) return null;
  if (raw.includes('=')) {
    // Per-protocol form: http=host:port;https=host:port;socks=host:port
    const parts = Object.fromEntries(
      raw.split(';').map((entry) => entry.split('=') as [string, string]),
    );
    const http = parts.http ? prefixHttp(parts.http) : null;
    const https = parts.https ? prefixHttp(parts.https) : http;
    const socks = parts.socks ? prefixSocks(parts.socks) : null;
    if (!http && !https && !socks) return null;
    return { http, https, socks };
  }
  const url = prefixHttp(raw);
  return { http: url, https: url, socks: null };
}

async function detectWindows(): Promise<SystemProxySnapshot | null> {
  const { stdout } = await execFileAsync('reg', [
    'query',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
    '/v',
    'ProxyEnable',
  ]);
  const { stdout: server } = await execFileAsync('reg', [
    'query',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
    '/v',
    'ProxyServer',
  ]);
  return parseWindowsRegistry(`${stdout}\n${server}`);
}

/** Linux: environment variables first; GNOME gsettings as fallback. */
async function detectLinux(): Promise<SystemProxySnapshot | null> {
  const http = process.env.HTTP_PROXY ?? process.env.http_proxy ?? null;
  const https = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? http;
  const socks = process.env.ALL_PROXY ?? process.env.all_proxy ?? null;
  if (http || https || socks) {
    return { http, https, socks: socks?.startsWith('socks') ? socks : null };
  }
  try {
    const mode = (await execFileAsync('gsettings', ['get', 'org.gnome.system.proxy', 'mode'])).stdout.trim();
    if (mode !== "'manual'") return null;
    const host = (await execFileAsync('gsettings', ['get', 'org.gnome.system.proxy.http', 'host'])).stdout
      .trim()
      .replace(/^'|'$/g, '');
    const port = (await execFileAsync('gsettings', ['get', 'org.gnome.system.proxy.http', 'port'])).stdout
      .trim()
      .replace(/^'|'$/g, '');
    if (!host || !port) return null;
    const url = `http://${host}:${port}`;
    return { http: url, https: url, socks: null };
  } catch {
    return null;
  }
}

function prefixHttp(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function prefixSocks(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^socks/.test(trimmed) ? trimmed : `socks5://${trimmed}`;
}
