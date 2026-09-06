/* eslint-disable no-console */
/** Merge native arm64/x64 electron-builder latest-mac.yml files without overwrite races. */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const root = process.argv[2] ?? 'release';
const channel = process.argv[3] ?? 'stable';
if (!['stable', 'beta', 'alpha'].includes(channel)) throw new Error(`invalid channel: ${channel}`);
const manifestName = `${channel === 'stable' ? 'latest' : channel}-mac.yml`;
const manifests = [];
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const file = join(root, dir.name, manifestName);
  if (existsSync(file)) manifests.push({ file, doc: yaml.load(readFileSync(file, 'utf8')) });
}
if (manifests.length !== 2) throw new Error(`expected arm64 and x64 ${manifestName}, found ${manifests.length}`);
const [first, ...rest] = manifests.map((entry) => entry.doc);
if (!first?.version || rest.some((doc) => doc?.version !== first.version)) throw new Error('mac update manifest versions differ');
const files = manifests.flatMap(({ doc }) => doc.files ?? []);
const urls = new Set(files.map((file) => file.url));
if (urls.size !== files.length || ![...urls].some((url) => /arm64/.test(url)) || ![...urls].some((url) => /x64/.test(url))) {
  throw new Error('merged mac manifest must contain distinct arm64 and x64 files');
}
writeFileSync(join(root, manifestName), yaml.dump({ ...first, files }), 'utf8');
console.log(`merged ${manifests.length} native mac manifests into ${manifestName}`);
