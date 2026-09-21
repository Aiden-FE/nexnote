import type { NetworkSettings } from '@nexnote/shared';
import { getCachedSystemProxy, type SystemProxySnapshot } from './system-proxy';

export interface NetworkProxyDerivation {
  env: NodeJS.ProcessEnv | null;
  cliConfig: string[] | null;
}

/** DEV-072：把用户网络设置 + （可选）系统代理快照派生为 Git 子进程 env 与 `git -c` 配置。 */
export function deriveNetworkProxy(
  network: NetworkSettings,
  system: SystemProxySnapshot | null,
): NetworkProxyDerivation {
  if (!network.applyToGit || network.mode === 'off') return { env: null, cliConfig: null };
  if (network.mode === 'system') {
    // 系统模式：优先 OS 探测快照；无快照则继承宿主 env（Git CLI 自身读 HTTPS_PROXY 等）。
    if (!system) return { env: null, cliConfig: null };
    const env: NodeJS.ProcessEnv = {};
    if (system.https) env.HTTPS_PROXY = system.https;
    if (system.http) env.HTTP_PROXY = system.http;
    if (system.socks) env.ALL_PROXY = system.socks;
    const cliConfig: string[] = [];
    if (system.https) cliConfig.push(`http.proxy=${system.https}`, `https.proxy=${system.https}`);
    else if (system.http) cliConfig.push(`http.proxy=${system.http}`);
    else if (system.socks) cliConfig.push(`http.proxy=${system.socks}`);
    return { env: Object.keys(env).length ? env : null, cliConfig: cliConfig.length ? cliConfig : null };
  }
  if (!network.host || !network.port) return { env: null, cliConfig: null };
  const proxyUrl = buildProxyUrl(network);
  const env: NodeJS.ProcessEnv = { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl };
  const cliConfig =
    network.mode === 'socks5'
      ? [`http.proxy=socks5://${network.host}:${network.port}`]
      : [`http.proxy=${proxyUrl}`, `https.proxy=${proxyUrl}`];
  return { env, cliConfig };
}

/** DEV-072：AI 侧代理 URL 派生（独立于 Git，尊重 applyToAi）。 */
export function deriveAiProxyUrl(
  network: NetworkSettings,
  system: SystemProxySnapshot | null,
): string | null {
  if (!network.applyToAi) return null;
  if (network.mode === 'off') return null;
  if (network.mode === 'system') {
    return system ? (system.https ?? system.http ?? system.socks) : null;
  }
  if (!network.host || !network.port) return null;
  return buildProxyUrl(network);
}

export function buildProxyUrl(network: NetworkSettings): string {
  const scheme = network.mode === 'socks5' ? 'socks5' : network.mode;
  const auth = network.username
    ? `${encodeURIComponent(network.username)}:${encodeURIComponent(network.password ?? '')}@`
    : '';
  return `${scheme}://${auth}${network.host}:${network.port}`;
}

/** 便捷包装：读当前缓存快照并派生（不触发 I/O）。 */
export function deriveNetworkProxyFromCache(network: NetworkSettings): NetworkProxyDerivation {
  return deriveNetworkProxy(network, getCachedSystemProxy());
}

export function deriveAiProxyUrlFromCache(network: NetworkSettings): string | null {
  return deriveAiProxyUrl(network, getCachedSystemProxy());
}
