import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as Dugite from 'dugite';

const require = createRequire(import.meta.url);

type DugiteApi = typeof Dugite;

export type GitRuntimeSource = 'bundled' | 'system' | 'missing';

export interface GitRuntimeResolution {
  source: GitRuntimeSource;
  binary: string;
  environment?: NodeJS.ProcessEnv;
}

export function chooseGitRuntime(options: {
  useSystemGit: boolean;
  allowSystemFallback: boolean;
  embeddedBinary: string | null;
}): GitRuntimeResolution {
  if (options.useSystemGit) return { source: 'system', binary: 'git' };
  if (options.embeddedBinary) return { source: 'bundled', binary: options.embeddedBinary };
  if (options.allowSystemFallback) return { source: 'system', binary: 'git' };
  return { source: 'missing', binary: 'git' };
}

export function resolveInstalledGitRuntime(
  options: {
    useSystemGit: boolean;
    allowSystemFallback: boolean;
  },
  load: () => DugiteApi | null = loadDugite,
): GitRuntimeResolution {
  if (options.useSystemGit) return chooseGitRuntime({ ...options, embeddedBinary: null });

  const dugite = load();
  if (dugite) {
    try {
      const binary = dugite.resolveGitBinary();
      if (binary && existsSync(binary)) {
        return {
          source: 'bundled',
          binary,
          environment: dugite.setupEnvironment({ ...process.env }).env,
        };
      }
    } catch {
      // Optional package or payload is unavailable; choose fallback policy below.
    }
  }
  return chooseGitRuntime({ ...options, embeddedBinary: null });
}

function loadDugite(): DugiteApi | null {
  try {
    return require('dugite') as DugiteApi;
  } catch {
    return null;
  }
}
