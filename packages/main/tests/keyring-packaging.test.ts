import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Entry } from '@napi-rs/keyring';

describe('native keyring packaging contract', () => {
  it('loads the host native keyring target in the test runtime', () => {
    expect(typeof Entry).toBe('function');
  });

  it('electron-builder unpacks keyring loader and platform .node packages', () => {
    const packageJson = JSON.parse(
      readFileSync(
        path.resolve(fileURLToPath(new URL('../../../package.json', import.meta.url))),
        'utf8',
      ),
    );
    const config = readFileSync(
      path.resolve(fileURLToPath(new URL('../../../electron-builder.yml', import.meta.url))),
      'utf8',
    );
    expect(config).toContain('asarUnpack:');
    expect(config).toContain('node_modules/@napi-rs/keyring/**');
    expect(config).toContain('node_modules/@napi-rs/keyring-*/**');
    expect(packageJson.optionalDependencies?.['@napi-rs/keyring']).toBe('^1.3.0');
    const electronVite = readFileSync(
      path.resolve(fileURLToPath(new URL('../../../electron.vite.config.ts', import.meta.url))),
      'utf8',
    );
    expect(electronVite).toContain("'@napi-rs/keyring'");
    // dugite 的 __dirname 推导要求它在 Electron main 构建中保持 externalize。
    expect(electronVite).toContain("'dugite'");
  });
});
