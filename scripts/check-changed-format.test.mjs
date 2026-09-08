import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(resolve(tmpdir(), 'nexnote-format-gate-'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: temp, encoding: 'utf8', ...options });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

try {
  run('git', ['init', '-q']);
  run('git', ['config', 'user.email', 'format-gate@example.invalid']);
  run('git', ['config', 'user.name', 'Format Gate Test']);
  writeFileSync(resolve(temp, 'base.js'), 'const base = 1;\n');
  run('git', ['add', '--', 'base.js']);
  run('git', ['commit', '-qm', 'base']);
  const base = run('git', ['rev-parse', 'HEAD']).stdout.trim();

  const filenames = [
    '--config=missing.js',
    '--plugin=missing-plugin.js',
    '-p.js',
    'space name.js',
    'line\nbreak.js',
  ];
  for (const filename of filenames) {
    const path = resolve(temp, filename);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'const formatted = true;\n');
  }
  run('git', ['add', '--', ...filenames]);
  run('git', ['commit', '-qm', 'add adversarial filenames']);

  mkdirSync(resolve(temp, 'scripts'));
  cpSync(
    resolve(root, 'scripts/check-changed-format.sh'),
    resolve(temp, 'scripts/check-changed-format.sh'),
  );
  chmodSync(resolve(temp, 'scripts/check-changed-format.sh'), 0o755);
  // Scaffold a minimal node_modules with the real Prettier so npx --no-install resolves locally.
  mkdirSync(resolve(temp, 'node_modules/.bin'), { recursive: true });
  cpSync(resolve(root, 'node_modules/prettier'), resolve(temp, 'node_modules/prettier'), {
    recursive: true,
  });
  symlinkSync('../prettier/bin/prettier.cjs', resolve(temp, 'node_modules/.bin/prettier'));

  const result = spawnSync('bash', ['scripts/check-changed-format.sh', base], {
    cwd: temp,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${resolve(temp, 'node_modules/.bin')}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, `format gate failed\n${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(
    result.stderr,
    /Invalid configuration|Cannot find module|Ignored unknown option/,
  );
  assert.match(result.stdout, /All matched files use Prettier code style!/);

  const empty = spawnSync('bash', ['scripts/check-changed-format.sh', 'HEAD'], {
    cwd: temp,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${resolve(temp, 'node_modules/.bin')}:${process.env.PATH}` },
  });
  assert.equal(empty.status, 0, `empty diff failed\n${empty.stdout}\n${empty.stderr}`);
  assert.match(empty.stdout, /No changed files to check/);

  const missing = spawnSync('bash', ['scripts/check-changed-format.sh', 'missing-ref'], {
    cwd: temp,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${resolve(temp, 'node_modules/.bin')}:${process.env.PATH}` },
  });
  assert.notEqual(missing.status, 0, 'git diff failure must propagate');

  console.log('Changed-format gate safely handled leading dashes, spaces, and newlines.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
