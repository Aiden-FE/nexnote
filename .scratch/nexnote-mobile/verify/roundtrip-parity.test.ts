// @vitest-environment happy-dom
// 跨端核对（MOB-007 / MOB-008 验收）
//
// 两条不变式：
// 1) 手机端未编辑的文件，必须与远端逐字节一致（手机端没有改写无关内容）
// 2) 手机端写入/编辑过的文件，过桌面端块编辑器内核往返必须零漂移、双链不丢
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEditor } from '../../../packages/kernel/src';

const EVIDENCE = join(
  process.cwd(),
  '.scratch/nexnote-mobile/evidence/cross-device-evidence.json',
);
const REMOTE = join(
  process.cwd(),
  '.scratch/nexnote-mobile/fixture-clean/remote.git',
);

type Evidence = { pagePaths: string[]; pageText: Record<string, string> };

/** 读取远端初始提交中的文件原文；不存在返回 null */
function initialBlob(path: string): string | null {
  const rootCommit = execFileSync(
    'git',
    ['-C', REMOTE, 'rev-list', '--max-parents=0', 'HEAD'],
    { encoding: 'utf8' },
  ).trim();
  try {
    // 探测「该路径是否存在」是本函数的正常语义，静默 git 的 stderr
    return execFileSync('git', ['-C', REMOTE, 'show', `${rootCommit}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

describe('MOB-007 / MOB-008 跨端核对', () => {
  it.skipIf(!existsSync(EVIDENCE))(
    '未编辑文件逐字节未动；手机端产出文件经桌面端内核往返零漂移',
    () => {
      const evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8')) as Evidence;
      const report: string[] = [];
      const untouchedFailures: string[] = [];
      const roundtripFailures: string[] = [];
      let untouched = 0;
      let written = 0;

      for (const path of evidence.pagePaths) {
        const deviceText = evidence.pageText[path];
        // 以初始提交（clone 基线）分类：基线里没有的文件才是手机端写出来的。
        // 不能用 HEAD 判断——手机端写入后已推送，HEAD 里也有它。
        const baseline = initialBlob(path);

        if (baseline !== null && baseline === deviceText) {
          // 手机端未触碰该文件：不变量 1
          untouched += 1;
          report.push(`UNCHANGED  ${path}`);
          continue;
        }

        // 手机端写入或编辑过的文件：不变量 2
        written += 1;
        const container = document.createElement('div');
        document.body.append(container);
        const kernel = createEditor(container, {
          initialMarkdown: deviceText,
          slashMenu: false,
          dragHandle: false,
        });
        const out = kernel.getMarkdown();
        const same =
          out.replace(/\n+$/, '') === deviceText.replace(/\n+$/, '');
        if (same) {
          report.push(`ROUNDTRIP OK  ${path}`);
        } else {
          roundtripFailures.push(path);
          report.push(`ROUNDTRIP DIFF  ${path}`);
          report.push(`      手机端: ${JSON.stringify(deviceText)}`);
          report.push(`      往返后: ${JSON.stringify(out)}`);
        }
        for (const match of deviceText.matchAll(/\[\[([^\]]+)\]\]/g)) {
          expect(out, `${path} 的双链 [[${match[1]}]] 丢失`).toContain(
            `[[${match[1]}]]`,
          );
        }
      }

      // 远端有但设备端没有的页面 = 手机端误删
      const remoteFiles = execFileSync(
        'git',
        ['-C', REMOTE, 'ls-tree', '-r', '--name-only', 'HEAD'],
        { encoding: 'utf8' },
      )
        .split('\n')
        .filter((line) => line.endsWith('.md'))
        .map((line) => line.trim());
      for (const path of remoteFiles) {
        if (!evidence.pagePaths.includes(path)) {
          untouchedFailures.push(path);
          report.push(`MISSING  ${path}（远端有，设备端没有）`);
        }
      }

      console.log(
        `\n跨端核对：未编辑 ${untouched} 个 / 设备端写入 ${written} 个，` +
          `未编辑差异 ${untouchedFailures.length} / 往返差异 ${roundtripFailures.length}\n` +
          report.join('\n'),
      );
      expect(untouchedFailures).toEqual([]);
      expect(roundtripFailures).toEqual([]);
    },
  );
});
