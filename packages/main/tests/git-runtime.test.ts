import { describe, expect, it } from 'vitest';
import { chooseGitRuntime, resolveInstalledGitRuntime } from '../src/git/git-runtime';

describe('Git runtime binary resolution', () => {
  it('用户显式选择系统 Git 时忽略 bundled payload', () => {
    expect(
      chooseGitRuntime({
        useSystemGit: true,
        allowSystemFallback: false,
        embeddedBinary: '/app/dugite/git/bin/git',
      }),
    ).toEqual({ source: 'system', binary: 'git' });
  });

  it('默认使用可用的 bundled Git', () => {
    expect(
      chooseGitRuntime({
        useSystemGit: false,
        allowSystemFallback: true,
        embeddedBinary: '/app/dugite/git/bin/git',
      }),
    ).toEqual({ source: 'bundled', binary: '/app/dugite/git/bin/git' });
  });

  it('开发环境缺 bundled payload 时回退系统 Git', () => {
    expect(
      chooseGitRuntime({
        useSystemGit: false,
        allowSystemFallback: true,
        embeddedBinary: null,
      }),
    ).toEqual({ source: 'system', binary: 'git' });
  });

  it('生产环境缺 bundled payload 时返回 missing，禁止静默 PATH fallback', () => {
    expect(
      chooseGitRuntime({
        useSystemGit: false,
        allowSystemFallback: false,
        embeddedBinary: null,
      }),
    ).toEqual({ source: 'missing', binary: 'git' });
  });

  it('dugite 可选包被 pnpm 整体省略时，开发环境仍回退系统 Git', () => {
    expect(
      resolveInstalledGitRuntime({ useSystemGit: false, allowSystemFallback: true }, () => null),
    ).toEqual({ source: 'system', binary: 'git' });
  });

  it('dugite 可选包被 pnpm 整体省略时，生产环境返回 missing', () => {
    expect(
      resolveInstalledGitRuntime({ useSystemGit: false, allowSystemFallback: false }, () => null),
    ).toEqual({ source: 'missing', binary: 'git' });
  });
});
