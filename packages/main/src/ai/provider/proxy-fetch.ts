type ProxyFetchLoader = (proxyUrl: string, bypass: string[]) => Promise<typeof fetch>;

async function loadUndiciProxyFetch(proxyUrl: string, bypass: string[]): Promise<typeof fetch> {
  const { EnvHttpProxyAgent, fetch: undiciFetch } = await import('undici');
  const inheritedBypass = process.env.no_proxy ?? process.env.NO_PROXY ?? '';
  const noProxy = [...inheritedBypass.split(/[\s,]+/), ...bypass].filter(Boolean).join(',');
  const dispatcher = new EnvHttpProxyAgent({
    httpProxy: proxyUrl,
    httpsProxy: proxyUrl,
    noProxy,
  });
  return (input, init) =>
    undiciFetch(
      input as never,
      { ...(init ?? {}), dispatcher } as never,
    ) as unknown as Promise<Response>;
}

export function createProxyFetch(
  proxyUrl: string,
  bypass: string[] = [],
  loadProxyFetch: ProxyFetchLoader = loadUndiciProxyFetch,
): typeof fetch {
  let proxyFetch: Promise<typeof fetch> | undefined;
  return (input, init) => {
    proxyFetch ??= loadProxyFetch(proxyUrl, bypass);
    return proxyFetch.then((fetchWithProxy) => fetchWithProxy(input, init));
  };
}
