import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ADR-0023 阶段③门禁：主进程源码里的中文残留只允许**逐批减少**，不允许增加或改动。
 *
 * 与既有检查互补：
 * - `packages/shared` 侧 `message-catalog.test.ts` 保证 en-US 词典本身没有中文；
 * - `packages/renderer` 侧若干测试保证已迁移组件在 en-US 下渲染无中文；
 * - 本文件保证主进程源码没有**新增**或**被改动**的硬编码中文。
 *
 * 为什么用棘轮基线而不是逐条豁免：main/src 里有大量**刻意保留**的中文边界
 * （AI system prompt、工具 description、ZIP/XML 底层解析错误、Git commit message、
 * 插件 manifest 数据、设置检索关键词、mock fixture、zh 三元分支等）。逐条豁免表
 * 既难维护又会掩盖真正漏网的文案；棘轮基线把「现状」显式冻结成一份可 review 的
 * 快照，每迁移一批就变小，任何新增都必须显式说明。
 *
 * 基线里同时包含 `reason`：每条残留必须写明它属于哪一类保留边界，
 * 让评审能直接判断这条是否该继续保留。
 *
 * 刷新基线（仅在确实完成一批迁移、或确认某条残留属于新登记边界时执行）：
 *   UPDATE_MAIN_I18N_BASELINE=1 pnpm exec vitest run packages/main/tests/main-i18n-residue.test.ts
 */

const mainSrc = resolve(import.meta.dirname, '../src');
const binaryHostSrc = resolve(import.meta.dirname, '../../renderer/src/binary-host');
const baselinePath = join(import.meta.dirname, 'fixtures/main-i18n-residue.json');

interface ResidueEntry {
  /** 相对 packages/main/src 的路径 */
  file: string;
  /** 该行剥掉注释与首尾空白后的内容 */
  text: string;
  /** 保留理由：属于哪一类刻意保留边界 */
  reason: string;
}

/**
 * 保留边界分类。新增残留必须从下列分类中选一个，没有合适分类说明它该被翻译。
 */
const BOUNDARIES = {
  aiPrompt: 'AI system prompt / 用户消息模板：模型指令，不是 UI 文案',
  toolDescription: 'Agent 工具 description / 参数说明：发给模型的工具契约，不是 UI 文案',
  upstreamError: '上游 provider / ZIP / XML / 压缩库原始错误：透传底层诊断文本',
  gitCommitMessage: 'Git commit message 与自动提交摘要：不随界面语言本地化',
  devLog: '开发日志：开发者诊断输出，不上屏',
  dataLabel: '数据值 / 默认文件名 / 导入标签 / 只读能力标签：属于内容数据',
  pluginManifest: '插件 manifest 名称、描述、关键词与贡献点标题：插件内容边界',
  searchKeywords: '设置搜索索引的中英关键词数组：ADR-0023 决策③要求双语互通，属数据',
  mockFixture: '测试 / mock 替身的假数据',
  localeBranch: '语言三元分支中的 zh-CN 分支文案：同一字面量同时服务中英界面',
} as const;

/**
 * 逐行扫描：剥掉行注释与跨行块注释后检测 CJK。
 * 剥离逻辑保守：宁可漏报也不误报，避免把边界内容错误登记进基线。
 */
function stripComments(line: string, inBlock: boolean): { code: string; inBlock: boolean } {
  let out = '';
  let inString: '"' | "'" | '`' | null = null;
  let block = inBlock;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] as string;
    const next = line[i + 1];
    if (block) {
      if (ch === '*' && next === '/') {
        block = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') break;
    if (ch === '/' && next === '*') {
      block = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  return { code: out, inBlock: block };
}

const cjk = /[\u4e00-\u9fff]/;

/** 收集指定目录里所有剥掉注释后仍含 CJK 的行内容。 */
function scan(root: string): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      // Windows 的 path.join 产生反斜杠；基线统一存正斜杠相对路径
      const file = full.slice(root.length + 1).replaceAll('\\', '/');
      const lines = readFileSync(full, 'utf8').split('\n');
      let inBlockComment = false;
      for (const raw of lines) {
        const { code, inBlock } = stripComments(raw, inBlockComment);
        inBlockComment = inBlock;
        if (!cjk.test(code)) continue;
        const text = code.trim();
        if (text) found.push({ file, text });
      }
    }
  };
  walk(root);
  return found;
}

describe('main process i18n residue ratchet（ADR-0023 阶段③）', () => {
  it('中文残留基线只减不增：新增或改动的未登记中文即失败', () => {
    const actual = scan(mainSrc);
    const baseline: ResidueEntry[] = JSON.parse(readFileSync(baselinePath, 'utf8'));

    if (process.env.UPDATE_MAIN_I18N_BASELINE === '1') {
      const known = new Set<string>(Object.values(BOUNDARIES));
      const next: ResidueEntry[] = actual
        .map(({ file, text }) => {
          // 保留理由沿用基线里同文件同内容的既有记录；新条目默认记为待归类
          const existing = baseline.find((e) => e.file === file && e.text === text);
          const reason = existing?.reason ?? 'UNCLASSIFIED';
          return { file, text, reason: known.has(reason) ? reason : 'UNCLASSIFIED' };
        })
        .filter((entry, index, all) => all.findIndex((e) => e.file === entry.file && e.text === entry.text) === index)
        .sort((a, b) => (a.file === b.file ? a.text.localeCompare(b.text) : a.file.localeCompare(b.file)));
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
      const unclassified = next.filter((e) => e.reason === 'UNCLASSIFIED');
      expect(
        unclassified.map((e) => `${e.file}  ${e.text}`),
        `以下残留未归类，需人工判定是翻译还是登记保留边界：\n${unclassified
          .map((e) => `${e.file}  ${e.text}`)
          .join('\n')}`,
      ).toEqual([]);
      return;
    }

    const baselineText = new Set(baseline.map((e) => `${e.file}\u0000${e.text}`));
    const actualText = new Set(actual.map((e) => `${e.file}\u0000${e.text}`));

    // 只增不减：实际出现但基线没有的中文残留 = 回归
    const added = actual.filter((e) => !baselineText.has(`${e.file}\u0000${e.text}`));
    // 基线里有但源码已无 = 迁移进展（提示可刷新基线，不阻塞）
    const resolved = baseline.filter((e) => !actualText.has(`${e.file}\u0000${e.text}`));

    expect(
      added.map((e) => `${e.file}  ${e.text}`),
      `main/src 新增未登记中文残留（应翻译或显式登记保留边界）：\n${added
        .map((e) => `${e.file}  ${e.text}`)
        .join('\n')}`,
    ).toEqual([]);

    // 基线条目必须都带保留理由
    expect(
      baseline.filter((e) => !e.reason || e.reason === 'UNCLASSIFIED').map((e) => `${e.file}  ${e.text}`),
      '基线里存在未归类条目：每条残留都必须写明保留边界',
    ).toEqual([]);

    if (resolved.length > 0) {
      console.info(
        `main i18n 棘轮：${resolved.length} 条基线残留已迁移（当前源码残留 ${actual.length} 条），可刷新基线`,
      );
    }
  });

  it('binary-host 独立宿主源码不含用户可见中文残留（ADR-0023 阶段④）', () => {
    expect(scan(binaryHostSrc)).toEqual([]);
  });
});
