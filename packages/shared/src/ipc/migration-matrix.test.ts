import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from './contract';
import { IPC_EVENT_CHANNELS } from './events';

type MatrixRow = string[];

function parseMatrixRows(): MatrixRow[] {
  const matrixPath = fileURLToPath(
    new URL('../../../../docs/tauri/ipc-migration-matrix.md', import.meta.url),
  );
  return readFileSync(matrixPath, 'utf8')
    .split(/\r?\n/)
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter(
      (cells) =>
        cells.length >= 7 &&
        cells[0] !== 'Channel' &&
        cells[0] !== 'Event' &&
        cells.some((cell) => !cell.startsWith('-')),
    );
}

describe('Tauri IPC migration matrix', () => {
  const matrix = readFileSync(
    fileURLToPath(new URL('../../../../docs/tauri/ipc-migration-matrix.md', import.meta.url)),
    'utf8',
  );
  const rows = parseMatrixRows();
  // ai:streamEvent was removed from the renderer allowlist, but DEV-115 keeps it in
  // the inventory as an explicitly-unsupported legacy event.
  const expectedNames = new Set([...IPC_CHANNELS, ...IPC_EVENT_CHANNELS, 'ai:streamEvent']);
  const matrixNames = rows.map((row) => row[0]!);
  const duplicateNames = matrixNames.filter((name, index) => matrixNames.indexOf(name) !== index);
  const missingNames = [...expectedNames].filter((name) => !matrixNames.includes(name));
  const undefinedNames = matrixNames.filter((name) => !expectedNames.has(name));

  it('covers every shared channel and event exactly once', () => {
    expect(duplicateNames).toEqual([]);
    expect(missingNames).toEqual([]);
    expect(undefinedNames).toEqual([]);
  });

  it('uses only defined statuses and matches the documented progress summary', () => {
    const allowedStatuses = new Set([
      'ported',
      'pending',
      'explicitly-unsupported',
      'electron-only',
    ]);
    const statuses = rows.map((row) => row.at(-1)!.split('（')[0]!.trim());
    expect(statuses.filter((status) => !allowedStatuses.has(status))).toEqual([]);

    const counts = new Map<string, number>();
    for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
    const summary = matrix.match(
      /(\d+) 条 `ported`，(\d+) 条 `pending`，(\d+) 条 `explicitly-unsupported`/u,
    );
    expect(summary, 'progress summary must be present').not.toBeNull();
    expect(Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)))).toEqual({
      'explicitly-unsupported': Number(summary![3]),
      pending: Number(summary![2]),
      ported: Number(summary![1]),
    });
    expect(new Set(matrixNames).size).toBe(expectedNames.size);

    const eventNames = new Set(IPC_EVENT_CHANNELS);
    for (const row of rows) {
      if (!row.at(-1)!.startsWith('ported')) continue;
      const target = eventNames.has(row[0]!) ? row[4] : row[7];
      expect(target, row[0]).toMatch(/::/);
    }
  });
});
