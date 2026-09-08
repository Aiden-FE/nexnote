/* eslint-env node */
/**
 * Enforce semver consistency between package.json and an immutable release tag.
 * `--require-tag <tag>` is mandatory in public-release CI; the no-tag form is
 * deliberately retained only for local informational checks.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const requireIndex = args.indexOf('--require-tag');
const required = requireIndex >= 0;
const tag = required ? args[requireIndex + 1] : (process.env.GITHUB_REF_NAME ?? args[0]);

const semverRe = /^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/;
const pkgVersion = pkg.version;
if (!semverRe.test(pkgVersion)) {
  console.error(`package.json version "${pkgVersion}" is not valid semver`);
  process.exit(1);
}
if (!tag) {
  if (required) {
    console.error('--require-tag requires an explicit immutable vX.Y.Z tag');
    process.exit(1);
  }
  console.log(`package.json version: ${pkgVersion} (no tag provided)`);
  process.exit(0);
}
if (!/^v\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?$/.test(tag)) {
  console.error(`release tag "${tag}" must be an immutable vX.Y.Z semver tag`);
  process.exit(1);
}
const tagVersion = tag.slice(1);
if (tagVersion !== pkgVersion) {
  console.error(`version mismatch: package.json=${pkgVersion} tag=${tagVersion}`);
  process.exit(1);
}
console.log(`version match: ${pkgVersion} (${tag})`);
