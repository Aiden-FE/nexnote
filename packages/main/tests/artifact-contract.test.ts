import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import packageJson from '../../../package.json';
import { describe, expect, it } from 'vitest';

import {
  expectedArtifactNames,
  verifyArtifactContract,
} from '../../../scripts/verify-artifact-contract.mjs';

const version = packageJson.version;

function writeManifest(dir: string, name: string, entries: string[]) {
  const files = entries.map((entry) => {
    const path = join(dir, entry);
    const body = Buffer.from(entry);
    writeFileSync(path, body);
    return {
      url: entry,
      size: body.length,
      sha512: createHash('sha512').update(body).digest('base64'),
    };
  });
  writeFileSync(join(dir, name), `version: ${version}\nfiles: ${JSON.stringify(files)}\n`);
}

function makeRelease() {
  const dir = mkdtempSync(join('/tmp', 'nexnote-artifact-contract-'));
  const names = expectedArtifactNames(version);
  for (const name of [
    names.macArm64.dmg,
    names.macArm64.zip,
    names.macX64.dmg,
    names.macX64.zip,
    names.windows.nsis,
    names.linux.appImage,
    names.macArm64.zip + '.blockmap',
    names.macX64.zip + '.blockmap',
    names.windows.nsis + '.blockmap',
    names.linux.appImage + '.blockmap',
  ])
    writeFileSync(join(dir, name), Buffer.from(name));
  writeManifest(dir, 'latest-mac.yml', [names.macArm64.zip, names.macX64.zip]);
  writeManifest(dir, 'latest.yml', [names.windows.nsis]);
  writeManifest(dir, 'latest-linux.yml', [names.linux.appImage]);
  return { dir, names };
}

describe('artifact contract', () => {
  it('expands stable names with explicit platform and architecture', () => {
    expect(expectedArtifactNames(version)).toMatchObject({
      macArm64: {
        dmg: `NexNote-${version}-mac-arm64.dmg`,
        zip: `NexNote-${version}-mac-arm64.zip`,
      },
      macX64: {
        dmg: `NexNote-${version}-mac-x64.dmg`,
        zip: `NexNote-${version}-mac-x64.zip`,
      },
      windows: { nsis: `NexNote-${version}-win-x64.exe` },
      linux: { appImage: `NexNote-${version}-linux-x86_64.AppImage` },
    });
  });

  it('accepts the required set without optional portable/deb or AppImage blockmap', () => {
    const { dir, names } = makeRelease();
    try {
      rmSync(join(dir, `${names.linux.appImage}.blockmap`));
      expect(verifyArtifactContract({ releaseDir: dir, channel: 'stable', version })).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requires blockmaps for macOS update zips and Windows NSIS', () => {
    const { dir, names } = makeRelease();
    try {
      rmSync(join(dir, `${names.windows.nsis}.blockmap`));
      expect(() => verifyArtifactContract({ releaseDir: dir, channel: 'stable', version })).toThrow(
        /blockmap/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds artifacts and manifests recursively in download-artifact directories', () => {
    const { dir, names } = makeRelease();
    try {
      mkdirSync(join(dir, 'nexnote-macos-arm64'), { recursive: true });
      const macDmg = join(dir, names.macArm64.dmg);
      const nestedMacDmg = join(dir, 'nexnote-macos-arm64', names.macArm64.dmg);
      writeFileSync(nestedMacDmg, readFileSync(macDmg));
      rmSync(macDmg);
      const macManifest = join(dir, 'latest-mac.yml');
      writeFileSync(join(dir, 'nexnote-macos-arm64', 'latest-mac.yml'), readFileSync(macManifest));
      rmSync(macManifest);
      expect(verifyArtifactContract({ releaseDir: dir, channel: 'stable', version })).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'missing mac architecture',
      (dir: string, names: ReturnType<typeof expectedArtifactNames>) =>
        rmSync(join(dir, names.macX64.zip)),
    ],
    ['missing manifest', (dir: string) => rmSync(join(dir, 'latest-linux.yml'))],
    [
      'wrong manifest URL',
      (dir: string, _names: ReturnType<typeof expectedArtifactNames>) =>
        writeFileSync(
          join(dir, 'latest.yml'),
          `version: ${version}\nfiles: [{url: wrong.exe, size: 1, sha512: wrong}]\n`,
        ),
    ],
    [
      'wrong manifest version',
      (dir: string, names: ReturnType<typeof expectedArtifactNames>) =>
        writeFileSync(
          join(dir, 'latest-linux.yml'),
          `version: 9.9.9\nfiles: [{url: ${names.linux.appImage}, size: 1, sha512: wrong}]\n`,
        ),
    ],
  ])('rejects %s', (_, mutate) => {
    const { dir, names } = makeRelease();
    try {
      mutate(dir, names);
      expect(() =>
        verifyArtifactContract({ releaseDir: dir, channel: 'stable', version }),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects duplicate basenames across preflight directories', () => {
    const { dir, names } = makeRelease();
    try {
      mkdirSync(join(dir, 'other'));
      writeFileSync(join(dir, 'other', names.macArm64.dmg), 'duplicate');
      expect(() => verifyArtifactContract({ releaseDir: dir, channel: 'stable', version })).toThrow(
        /duplicate artifact basename/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
