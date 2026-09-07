/**
 * 最小 semver 兼容判定（DEV-013），避免为版本比较引入额外依赖。
 * 仅比较 major.minor.patch 数字段；prerelease/build 标记在兼容性判定中忽略
 * （minAppVersion 形如 0.1.0，不使用 prerelease 区间）。
 */

export function parseSemver(version: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isValidSemver(version: string): boolean {
  return parseSemver(version) !== null;
}

/** true = host 版本 >= minimum（满足最低版本要求）。 */
export function semverGte(host: string, minimum: string): boolean {
  const a = parseSemver(host);
  const b = parseSemver(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i]! > b[i]!;
  }
  return true;
}
