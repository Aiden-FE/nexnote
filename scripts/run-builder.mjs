/* eslint-disable no-console */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dump, load } from 'js-yaml';
import { prepareNativeBindings } from './prepare-native-bindings.mjs';
/**
 * Normalize argv for electron-builder CLI.
 * 本仓库经 pnpm shim 调用时 argv[1]（脚本路径）会被 yargs 当作未知位置参数；
 * 这里把用户参数整体前移到 argv[1] 起始。
 *
 * It also wires the release channel from NEXNOTE_UPDATE_CHANNEL into the publish
 * config so electron-builder emits the correct channel-specific update manifest
 * (latest.yml for stable, <channel>-latest.yml for beta/alpha).
 */
const VALID_CHANNELS = new Set(['stable', 'beta', 'alpha']);

function resolveChannel() {
  const raw = process.env.NEXNOTE_UPDATE_CHANNEL?.trim().toLowerCase();
  if (raw && VALID_CHANNELS.has(raw)) return raw;
  return 'stable';
}

const channel = resolveChannel();
// Must match the git origin, not a placeholder.
const REPO_OWNER = 'Aiden-FE';
const REPO_NAME = 'nexnote';
// Keep caller arguments intact. electron-builder accepts boolean config overrides as
// `--config.npmRebuild false`; the old `-c.npmRebuild=false` form was parsed as a string.
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const root = process.cwd();
if (channel !== 'stable') {
  const config = load(readFileSync(join(root, 'electron-builder.yml'), 'utf8'));
  const publisher = config?.publish?.[0];
  if (
    publisher?.provider !== 'github' ||
    publisher.owner !== REPO_OWNER ||
    publisher.repo !== REPO_NAME
  ) {
    throw new Error('electron-builder GitHub publisher does not match the release repository');
  }
  publisher.channel = channel;
  const configPath = join(root, `.electron-builder-${channel}-${process.pid}.yml`);
  writeFileSync(configPath, dump(config), { flag: 'wx' });
  process.once('exit', () => {
    try {
      unlinkSync(configPath);
    } catch (error) {
      if (error.code !== 'ENOENT') console.error(error);
    }
  });
  args.push('--config', configPath);
}
process.argv = [process.argv[0], ...args];

const { cacheBinding } = await prepareNativeBindings({ root, mode: 'electron' });
await copyFile(
  cacheBinding,
  join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
);
console.log('staged validated Electron ABI for better-sqlite3');

await import('electron-builder/out/cli/cli.js');
