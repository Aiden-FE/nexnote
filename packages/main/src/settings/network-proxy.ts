import type { NetworkProxyConfig, NetworkSettings } from '@nexnote/shared';
import { getCachedSystemProxy, type SystemProxySnapshot } from './system-proxy';

export interface NetworkProxyDerivation {
  env: NodeJS.ProcessEnv | null;
  cliConfig: string[] | null;
}

function gitProxy(network: NetworkSettings): NetworkProxyConfig {
  return network.gitProxy ?? network;
}

function aiProxy(network: NetworkSettings): NetworkProxyConfig {
  return network.aiProxy ?? network;
}

/** DEV-072：把用户网络设置 + （可选）系统代理快照派生为 Git 子进程 env 与 `git -c` 配置。 */
export function deriveNetworkProxy(
  network: NetworkSettings,
  system: SystemProxySnapshot | null,
): NetworkProxyDerivation {
  const target = gitProxy(network);
  if (!network.applyToGit || target.mode === 'off') {
    return { env: null, cliConfig: ['http.proxy='] };
  }
  if (target.mode === 'system') {
    // 系统模式：优先 OS 探测快照；无快照则继承宿主 env（Git CLI 自身读 HTTPS_PROXY 等）。
    if (!system) return { env: null, cliConfig: null };
    const env: NodeJS.ProcessEnv = {};
    if (target.bypass.length) {
      const bypass = target.bypass.join(',');
      env.NO_PROXY = bypass;
      env.no_proxy = bypass;
    }
    if (system.https) env.HTTPS_PROXY = system.https;
    if (system.http) env.HTTP_PROXY = system.http;
    if (system.socks) env.ALL_PROXY = system.socks;
    const cliConfig: string[] = [];
    if (system.https) cliConfig.push(`http.proxy=${system.https}`, `https.proxy=${system.https}`);
    else if (system.http) cliConfig.push(`http.proxy=${system.http}`);
    else if (system.socks) cliConfig.push(`http.proxy=${system.socks}`);
    return {
      env: Object.keys(env).length ? env : null,
      cliConfig: cliConfig.length ? cliConfig : null,
    };
  }
  if (!target.host || !target.port) return { env: null, cliConfig: null };
  const proxyUrl = buildProxyUrl(target);
  const env: NodeJS.ProcessEnv = { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl };
  if (target.bypass.length) {
    const bypass = target.bypass.join(',');
    env.NO_PROXY = bypass;
    env.no_proxy = bypass;
  }
  const cliConfig =
    target.mode === 'socks5'
      ? [`http.proxy=${proxyUrl}`]
      : [`http.proxy=${proxyUrl}`, `https.proxy=${proxyUrl}`];
  return { env, cliConfig };
}

/** DEV-072：AI 侧代理 URL 派生（独立于 Git，尊重 applyToAi 与可选的 aiProxy 覆盖）。 */
export function deriveAiProxyUrl(
  network: NetworkSettings,
  system: SystemProxySnapshot | null,
): string | null {
  const target = aiProxy(network);
  if (!network.applyToAi) return null;
  if (target.mode === 'off') return null;
  if (target.mode === 'system') {
    return system ? (system.https ?? system.http ?? system.socks) : null;
  }
  if (!target.host || !target.port) return null;
  return buildProxyUrl(target);
}

export function buildProxyUrl(network: NetworkProxyConfig): string {
  const scheme = network.mode === 'socks5' ? 'socks5' : network.mode;
  const auth = network.username
    ? `${encodeURIComponent(network.username)}:${encodeURIComponent(network.password ?? '')}@`
    : '';
  return `${scheme}://${auth}${network.host}:${network.port}`;
}

export function deriveAiProxyBypass(network: NetworkSettings): string[] {
  return network.applyToAi ? aiProxy(network).bypass : [];
}

/** AI/Git 代理 URL 派生（不触发系统代理 I/O）。 */
export function deriveNetworkProxyFromCache(network: NetworkSettings): NetworkProxyDerivation {
  return deriveNetworkProxy(network, getCachedSystemProxy());
}

export function deriveAiProxyUrlFromCache(network: NetworkSettings): string | null {
  return deriveAiProxyUrl(network, getCachedSystemProxy());
}
