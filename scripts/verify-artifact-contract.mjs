/* eslint-disable no-console */
/**
 * Validate the publishable artifact set and update metadata produced by electron-builder.
 * This is intentionally independent of GitHub Actions so preflight and local tests share
 * the same exact OS/architecture/target contract.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import yaml from 'js-yaml';

const CHANNELS = new Set(['stable', 'beta', 'alpha']);

export function channelManifestNames(channel) {
  if (!CHANNELS.has(channel)) throw new Error(`invalid channel: ${channel}`);
  const prefix = channel === 'stable' ? 'latest' : channel;
  return {
    mac: `${prefix}-mac.yml`,
    windows: `${prefix}.yml`,
    linux: `${prefix}-linux.yml`,
  };
}

export function expectedArtifactNames(version, productName = 'NexNote') {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`invalid release version: ${version}`);
  const product = productName.replaceAll(/[^A-Za-z0-9._-]+/g, '-');
  return {
    macArm64: {
      dmg: `${product}-${version}-mac-arm64.dmg`,
      zip: `${product}-${version}-mac-arm64.zip`,
    },
    macX64: {
      dmg: `${product}-${version}-mac-x64.dmg`,
      zip: `${product}-${version}-mac-x64.zip`,
    },
    windows: {
      nsis: `${product}-${version}-win-x64.exe`,
      portable: `${product}-${version}-win-x64-portable.exe`,
    },
    linux: {
      appImage: `${product}-${version}-linux-x86_64.AppImage`,
      deb: `${product}-${version}-linux-x86_64.deb`,
    },
  };
}

function filesUnder(root) {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function sha512Base64(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64');
}

function findExact(root, name, required = true) {
  const matches = filesUnder(root).filter((file) => basename(file) === name);
  if (matches.length > 1) throw new Error(`duplicate artifact basename: ${name}`);
  if (required && matches.length === 0) throw new Error(`missing required artifact: ${name}`);
  return matches[0];
}

function assertArtifact(root, name, required = true) {
  const file = findExact(root, name, required);
  if (file && statSync(file).size === 0) throw new Error(`empty artifact: ${name}`);
  return file;
}

function assertManifestRecord(root, manifestName, artifactName, version) {
  const manifestPath = findExact(root, manifestName);
  let document;
  try {
    document = yaml.load(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`invalid update manifest ${manifestName}: ${error.message}`);
  }
  if (document?.version !== version)
    throw new Error(`${manifestName} version ${document?.version ?? '<missing>'} != ${version}`);
  if (document?.channel && document.channel !== manifestName.replace(/-?(?:mac|linux)?\.yml$/, ''))
    throw new Error(`${manifestName} channel does not match its filename`);
  if (!Array.isArray(document?.files)) throw new Error(`${manifestName} has no files list`);

  const records = document.files.filter((entry) => {
    if (!entry || typeof entry.url !== 'string') return false;
    try {
      return (
        basename(decodeURIComponent(new URL(entry.url, 'https://example.invalid').pathname)) ===
        artifactName
      );
    } catch {
      return basename(entry.url) === artifactName;
    }
  });
  if (records.length !== 1)
    throw new Error(`${manifestName} must record ${artifactName} exactly once`);
  const record = records[0];
  const artifactPath = findExact(root, artifactName);
  const size = statSync(artifactPath).size;
  if (record.size !== size)
    throw new Error(`${manifestName} size for ${artifactName} ${record.size} != ${size}`);
  if (record.sha512 !== sha512Base64(artifactPath))
    throw new Error(`${manifestName} sha512 for ${artifactName} does not match the artifact`);
}

function assertBlockmap(root, artifactName) {
  // electron-builder writes <archive>.blockmap for zip/AppImage/NSIS update targets.
  assertArtifact(root, `${artifactName}.blockmap`);
}

export function verifyArtifactContract({ releaseDir, channel, version, productName = 'NexNote' }) {
  const root = resolve(releaseDir);
  const names = expectedArtifactNames(version, productName);
  const manifests = channelManifestNames(channel);

  for (const name of [
    names.macArm64.dmg,
    names.macArm64.zip,
    names.macX64.dmg,
    names.macX64.zip,
    names.windows.nsis,
    names.linux.appImage,
  ])
    assertArtifact(root, name);

  // optional portable/deb remain available for manual downloads but do not gate the updater primary.
  assertArtifact(root, names.windows.portable, false);
  assertArtifact(root, names.linux.deb, false);

  // Differential update metadata is required only for the NSIS/macOS ZIP primary paths.
  // AppImage updates use the AppImage entry in its channel manifest and need no blockmap.
  for (const name of [names.macArm64.zip, names.macX64.zip, names.windows.nsis])
    assertBlockmap(root, name);

  assertManifestRecord(root, manifests.mac, names.macArm64.zip, version);
  assertManifestRecord(root, manifests.mac, names.macX64.zip, version);
  assertManifestRecord(root, manifests.windows, names.windows.nsis, version);
  assertManifestRecord(root, manifests.linux, names.linux.appImage, version);
  return { names, manifests };
}

function main() {
  const [releaseDir = 'release', channel = 'stable', version] = process.argv.slice(2);
  if (!version)
    throw new Error('usage: verify-artifact-contract.mjs <release-dir> <channel> <version>');
  verifyArtifactContract({ releaseDir, channel, version });
  console.log(`artifact contract passed for ${channel} ${version}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
