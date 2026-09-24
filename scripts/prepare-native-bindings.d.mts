export interface RebuildStagedBinding {
  binding: string;
  cleanup: () => Promise<void>;
}

export interface PrepareNativeBindingsOptions {
  root: string;
  mode: 'node' | 'electron';
  platform?: string;
  arch?: string;
  moduleRoot?: string;
  electronVersion?: string;
  electronAbi?: string;
  nodeAbi?: string;
  validate?: (binding: string, runtime: 'node' | 'electron') => Promise<void>;
  rebuildElectron?: () => Promise<RebuildStagedBinding>;
  rebuildNode?: () => Promise<void>;
  lockPollMs?: number;
  lockTimeoutMs?: number;
}

export function nativeBindingCachePath(
  root: string,
  runtime: { platform: string; arch: string; modules: string },
): string;

export function prepareNativeBindings(
  options: PrepareNativeBindingsOptions,
): Promise<{ cacheBinding: string }>;
