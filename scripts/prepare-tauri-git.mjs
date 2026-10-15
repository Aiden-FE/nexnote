/* eslint-disable no-console */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const destination = join(root, 'src-tauri/resources/git');
const dugitePackage = createRequire(join(root, 'package.json')).resolve('dugite/package.json');
const dugiteRoot = dirname(dugitePackage);
const relativeBinary = process.platform === 'win32' ? 'git/cmd/git.exe' : 'git/bin/git';
const binary = join(dugiteRoot, relativeBinary);

const version = execFileSync(binary, ['--version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
if (!/^git version\s+\S+/.test(version)) throw new Error(`unexpected Git version: ${version}`);

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(join(dugiteRoot, 'git'), join(destination, 'git'), {
  recursive: true,
  dereference: true,
});
await mkdir(join(destination, 'licenses'), { recursive: true });
for (const name of ['COPYING', 'NOTICE', 'SOURCE_OFFER.txt']) {
  await cp(join(root, 'licenses/git', name), join(destination, 'licenses', name));
}

const manifest = {
  runtime: 'dugite',
  platform: process.platform,
  arch: process.arch,
  version,
  binary: relativeBinary,
  sha256: createHash('sha256')
    .update(await readFile(binary))
    .digest('hex'),
};
await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared Tauri bundled Git: ${manifest.platform}-${manifest.arch} (${version})`);
