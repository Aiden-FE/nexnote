/**
 * 轻量行级 diff（LCS）用于 diff 预览：替换类原地高亮增删，追加类整段标注新增。
 * 纯函数、无 DOM 依赖，可在 node 环境单测；流式生成时对累积文本重复计算即可。
 */

export type DiffOpType = 'eq' | 'add' | 'del';

export interface DiffOp {
  type: DiffOpType;
  text: string;
}

/** 行级 LCS diff：返回按阅读顺序排列的 eq/add/del 操作。 */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.length > 0 ? before.split('\n') : [];
  const b = after.length > 0 ? after.split('\n') : [];

  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const ai = a[i] ?? '';
      const bj = b[j] ?? '';
      dp[i]![j] = ai === bj ? (dp[i + 1]![j + 1] ?? 0) + 1 : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
    }
  }

  const ops: DiffOp[] = [];
  const push = (type: DiffOpType, text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += `\n${text}`;
    else ops.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ai = a[i] ?? '';
    const bj = b[j] ?? '';
    if (ai === bj) {
      push('eq', ai);
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      push('del', ai);
      i += 1;
    } else {
      push('add', bj);
      j += 1;
    }
  }
  while (i < n) {
    push('del', a[i] ?? '');
    i += 1;
  }
  while (j < m) {
    push('add', b[j] ?? '');
    j += 1;
  }
  return ops;
}

/** 是否存在可见差异（忽略首尾空白）。 */
export function hasVisibleDiff(before: string, after: string): boolean {
  return before.trim() !== after.trim();
}
