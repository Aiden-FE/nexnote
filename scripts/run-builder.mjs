/* eslint-disable no-console */
/**
 * Normalize argv for electron-builder CLI.
 * 本仓库经 pnpm shim 调用时 argv[1]（脚本路径）会被 yargs 当作未知位置参数；
 * 这里把用户参数整体前移到 argv[1] 起始。
 */
process.argv = [process.argv[0], ...process.argv.slice(2)];
await import('electron-builder/out/cli/cli.js');
