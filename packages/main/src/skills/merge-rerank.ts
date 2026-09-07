import type { RetrievalSource } from '@nexnote/shared';

export interface SkillRunResult {
  skillId: string;
  sources: RetrievalSource[];
}

/**
 * 跨 Skill 合并 + 重排（DEV-014，纯函数）。
 *
 * 不同 Skill（或同一检索器的不同参数集）的原始 score 不直接可比：
 * 先在每个 Skill 内做 min-max 归一化，再跨源去重（同 path+blockId 视为同一块），
 * 同一块被多个 Skill 命中时取归一化分的最大值并合并溯源；最后按归一化分降序、
 * 路径稳定序排列。无命中或单一值时退化为原始分（0/0 归一化按 0 处理）。
 */
export function mergeSkillResults(
  runs: SkillRunResult[],
  topK: number,
): RetrievalSource[] {
  const merged = new Map<string, RetrievalSource & { _norm: number }>();

  for (const run of runs) {
    const scores = run.sources.map((s) => s.score);
    const max = scores.length ? Math.max(...scores) : 0;
    const min = scores.length ? Math.min(...scores) : 0;
    const range = max - min;

    for (const source of run.sources) {
      const norm = range > 0 ? (source.score - min) / range : source.score > 0 ? 1 : 0;
      const key = `${source.path}::${source.blockId ?? ''}`;
      const existing = merged.get(key);
      const tagged: RetrievalSource = { ...source, skillId: run.skillId };
      if (!existing) {
        merged.set(key, { ...tagged, _norm: norm });
      } else {
        // 多 Skill 命中：保留最高归一化分；溯源标注所有命中 Skill。
        const keep = norm > existing._norm ? tagged : existing;
        merged.set(key, {
          ...keep,
          _norm: Math.max(existing._norm, norm),
          score: Math.max(existing.score, source.score),
        });
      }
    }
  }

  return [...merged.values()]
    // 归一化分并列时（每个 Skill 的最佳命中都会到 1.0）退回原始绝对分，再以路径稳定。
    .sort(
      (a, b) => b._norm - a._norm || b.score - a.score || a.path.localeCompare(b.path),
    )
    .slice(0, topK)
    .map(({ _norm, ...rest }) => {
      void _norm;
      return rest;
    });
}

/** 把来源块打包为注入对话的上下文正文（多 Skill 合并后）。 */
export function packContextText(sources: RetrievalSource[], budgetChars: number): string {
  const parts: string[] = [];
  let used = 0;
  for (const source of sources) {
    const block = `${source.title}${source.skillId ? `（${source.skillId}）` : ''}\n${source.snippet}`;
    if (used + block.length > budgetChars) break;
    parts.push(block);
    used += block.length + 2;
  }
  return parts.join('\n\n');
}
