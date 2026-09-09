/* eslint-disable no-console */
/**
 * Hard gate for the bundled (dugite) Git payload. Two modes:
 *  - --install-tree [root]: verify every workspace node_modules/dugite link.
 *    Build outputs are never scanned, so stale release payloads cannot satisfy it.
 *  - --app <output>: verify every app.asar.unpacked below the output. Packaged
 *    payload paths must be real files/directories wholly inside that tree.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [mode, input = '.'] = process.argv.slice(2);

if (mode !== '--install-tree' && mode !== '--app') {
  fail('usage: node scripts/verify-bundled-git.mjs --install-tree [root] | --app <output>');
}

const target = resolve(root, input);
const relativeBinary = process.platform === 'win32' ? 'git/cmd/git.exe' : 'git/bin/git';
const payloads = mode === '--install-tree' ? installPayloads(target) : packagedPayloads(target);

if (payloads.length === 0) {
  fail(
    mode === '--install-tree'
      ? `dugite package is missing from install tree: ${target}`
      : `no app.asar.unpacked found under packaged output: ${target}`,
  );
}

for (const payload of payloads) {
  const binary = join(payload, relativeBinary);
  if (mode === '--app' && !hasRealPackagedPayload(payload, relativeBinary)) {
    fail(`dugite bundled Git is missing or symlinked in packaged app: ${payload}`);
  }
  if (mode === '--install-tree' && !isFile(binary, true)) {
    fail(`dugite bundled Git is missing from install tree package: ${payload}`);
  }
  verifyExecutable(binary);
}

function installPayloads(start) {
  return [start, ...packageDirs(start)]
    .map((project) => join(project, 'node_modules', 'dugite'))
    .filter((path) => exists(path));
}

function packagedPayloads(start) {
  return findRealDirectories(start, (path) => basename(path) === 'app.asar.unpacked').map(
    (unpacked) => join(unpacked, 'node_modules', 'dugite'),
  );
}

function packageDirs(start) {
  const packagesRoot = join(start, 'packages');
  if (!isDirectory(packagesRoot, false)) return [];
  try {
    return readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => join(packagesRoot, entry.name))
      .filter((project) => isFile(join(project, 'package.json'), false));
  } catch {
    return [];
  }
}

function findRealDirectories(start, matches) {
  if (!isDirectory(start, false)) return [];
  const found = [];
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = join(current, entry.name);
      if (matches(child)) found.push(child);
      else pending.push(child);
    }
  }
  return found;
}

function hasRealPackagedPayload(payload, relative) {
  const parts = ['node_modules', 'dugite', ...relative.split('/')];
  let current = resolve(payload, '..', '..');
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    const final = index === parts.length - 1;
    if (final ? !isFile(current, false) : !isDirectory(current, false)) return false;
  }
  return true;
}

function verifyExecutable(binary) {
  try {
    const version = execFileSync(binary, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!/^git version\s+\S+/.test(version)) throw new Error(`unexpected output: ${version}`);
    console.log(`Bundled Git verified: ${binary} (${version})`);
  } catch (error) {
    fail(
      `dugite bundled Git is not executable: ${binary}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isDirectory(path, allowSymlink) {
  try {
    const stat = lstatSync(path);
    if (!allowSymlink && stat.isSymbolicLink()) return false;
    return allowSymlink ? stat.isDirectory() || stat.isSymbolicLink() : stat.isDirectory();
  } catch {
    return false;
  }
}

function isFile(path, allowSymlink) {
  try {
    const stat = lstatSync(path);
    if (!allowSymlink && stat.isSymbolicLink()) return false;
    // A symlink (pnpm style) is acceptable here; resolve it and require a real file.
    return allowSymlink && stat.isSymbolicLink() ? statSync(path).isFile() : stat.isFile();
  } catch {
    return false;
  }
}

function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}
