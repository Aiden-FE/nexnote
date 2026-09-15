/* eslint-disable no-console */
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
// Only insert the override when building distributables; `--dir`/prepackaged don't need it.
const args = [...process.argv.slice(2), '-c.npmRebuild=false'];
if (channel !== 'stable') {
  const publish = JSON.stringify([
    { provider: 'github', owner: REPO_OWNER, repo: REPO_NAME, channel },
  ]);
  args.push(`-c.publish=${publish}`);
}
process.argv = [process.argv[0], ...args];
await import('electron-builder/out/cli/cli.js');
