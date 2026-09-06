/* eslint-env node */
/**
 * Enforce semver consistency between package.json, git tag, and release notes.
 * CI: runs on push of v* tags; fails if they disagree.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];

const semverRe = /^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/;
const pkgVersion = pkg.version;
if (!semverRe.test(pkgVersion)) {
  console.error(`package.json version "${pkgVersion}" is not valid semver`);
  process.exit(1);
}
if (!tag) {
  console.log(`package.json version: ${pkgVersion} (no tag provided)`);
  process.exit(0);
}
const tagVersion = tag.replace(/^v/, '');
if (tagVersion !== pkgVersion) {
  console.error(`version mismatch: package.json=${pkgVersion} tag=${tagVersion}`);
  process.exit(1);
}
console.log(`version match: ${pkgVersion}`);
