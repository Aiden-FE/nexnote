import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Entry } from '@napi-rs/keyring';

describe('native keyring packaging contract', () => {
  it('loads the host native keyring target in the test runtime', () => {
    expect(typeof Entry).toBe('function');
  });

  it('electron-builder unpacks keyring loader and platform .node packages', () => {
    const config = readFileSync('electron-builder.yml', 'utf8');
    expect(config).toContain('asarUnpack:');
    expect(config).toContain('node_modules/@napi-rs/keyring/**');
    expect(config).toContain('node_modules/@napi-rs/keyring-*/**');
  });
});
