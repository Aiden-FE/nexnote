// 跨端命中集一致性核对（MOB-006 验收）
//
// 用桌面端真实 IndexService 索引同一份内容，跑与手机端同一组查询，
// 与手机端导出的命中集逐条比对。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LinkIndexService } from '../../../packages/main/src/indexer/index-service';

const EVIDENCE = join(
  process.cwd(),
  '.scratch/nexnote-mobile/evidence/cross-device-evidence.json',
);

type Evidence = {
  hits: Record<string, string[]>;
  pagePaths: string[];
  pageText: Record<string, string>;
};

describe('MOB-006 跨端命中集一致性', () => {
  it.skipIf(!existsSync(EVIDENCE))(
    '桌面端与手机端在同一组中文查询下命中集一致',
    () => {
      const evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8')) as Evidence;

      // 用手机端导出的原文重建同一份知识库内容
      const root = mkdtempSync(join(tmpdir(), 'nexnote-parity-'));
      for (const path of evidence.pagePaths) {
        const target = join(root, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, evidence.pageText[path], 'utf8');
      }

      const svc = new LinkIndexService();
      svc.setRoot(root);

      const report: string[] = [];
      let mismatches = 0;
      for (const [query, mobilePaths] of Object.entries(evidence.hits)) {
        const desktopPaths = svc
          .search(query, 50)
          .map((hit) => hit.path)
          .sort();
        const expected = [...mobilePaths].sort();
        const same =
          desktopPaths.length === expected.length &&
          desktopPaths.every((path, index) => path === expected[index]);
        if (!same) mismatches += 1;
        report.push(
          `${same ? 'OK  ' : 'DIFF'} ${JSON.stringify(query)}\n` +
            `      手机端: ${JSON.stringify(expected)}\n` +
            `      桌面端: ${JSON.stringify(desktopPaths)}`,
        );
      }
      // 让核对结果进入测试输出，便于人工复核
      console.log(`\n跨端命中集核对（共 ${Object.keys(evidence.hits).length} 条查询，差异 ${mismatches} 条）\n` + report.join('\n'));

      svc.close();
      expect(mismatches).toBe(0);
    },
  );
});
