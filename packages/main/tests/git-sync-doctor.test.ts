import { describe, expect, it, vi } from 'vitest';
import {
  GIT_DOCTOR_TICKET_TTL_MS,
  GIT_REPAIR_ACTIONS,
  GitSyncDoctor,
  GitSyncDoctorError,
  classifySyncError,
  classifySyncIssue,
  sanitizeDiagnosticText,
} from '../src/git/git-sync-doctor';
import type { GitService } from '../src/git/git-service';
import type { GitStatus } from '@nexnote/shared';

/** 可控 GitService 替身：statusFor / commitManual / pull / push 全部可编程。 */
type FakeGit = GitService & {
  statusFor: ReturnType<typeof vi.fn>;
  commitManual: ReturnType<typeof vi.fn>;
  pull: ReturnType<typeof vi.fn>;
  push: ReturnType<typeof vi.fn>;
};
function fakeGit(status: Partial<GitStatus> = {}): FakeGit {
  return {
    statusFor: vi.fn(async (): Promise<GitStatus> => ({
      repository: true,
      branch: 'main',
      changed: 0,
      ahead: 0,
      behind: 0,
      remote: 'origin',
      conflict: false,
      usingSystemGit: false,
      ...status,
    })),
    commitManual: vi.fn(async () => ({ message: 'committed', status: {} as GitStatus })),
    pull: vi.fn(async () => ({ message: 'pulled', status: {} as GitStatus })),
    push: vi.fn(async () => ({ message: 'pushed', status: {} as GitStatus })),
    rawStatusPorcelain: vi.fn(async () => [] as string[]),
    doctorFingerprint: vi.fn(async () => ({
      headOid: 'head-1',
      remoteOid: 'remote-1',
      porcelain: ' M note.md',
      files: [{ path: 'note.md', sha256: 'hash-1' }],
    })),
  } as unknown as FakeGit;
}

function doctorWith(
  git: FakeGit,
  opts: { ai?: object; root?: string | null; now?: () => number; ttlMs?: number } = {},
) {
  let root = opts.root !== undefined ? opts.root : '/vault/a';
  const doctor = new GitSyncDoctor({
    git,
    ai: opts.ai as never,
    getRoot: () => root,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.ttlMs !== undefined ? { ttlMs: opts.ttlMs } : {}),
  });
  return {
    doctor,
    setRoot(next: string | null) {
      root = next;
    },
  };
}

describe('classifySyncIssue（规则优先分类）', () => {
  const ok = {
    repository: true,
    conflict: false,
    changed: 0,
    ahead: 0,
    behind: 0,
    remote: 'origin',
  };
  it('非仓库 → git-missing', () => {
    expect(classifySyncIssue({ ...ok, repository: false }).category).toBe('git-missing');
  });
  it('冲突最优先 → conflict', () => {
    expect(
      classifySyncIssue({ ...ok, conflict: true, changed: 3, ahead: 1, behind: 1 }).category,
    ).toBe('conflict');
  });
  it('脏工作区 → dirty', () => {
    expect(classifySyncIssue({ ...ok, changed: 2 }).category).toBe('dirty');
  });
  it('无远程 → no-remote', () => {
    expect(classifySyncIssue({ ...ok, remote: null }).category).toBe('no-remote');
  });
  it('分叉/落后 → non-fast-forward', () => {
    expect(classifySyncIssue({ ...ok, ahead: 1, behind: 2 }).category).toBe('non-fast-forward');
    expect(classifySyncIssue({ ...ok, behind: 2 }).category).toBe('non-fast-forward');
  });
  it('全部正常 → unknown/SYNC_OK', () => {
    const r = classifySyncIssue(ok);
    expect(r.category).toBe('unknown');
    expect(r.code).toBe('SYNC_OK');
  });
});

describe('classifySyncError（异常分类兜底）', () => {
  it('认证错误 → auth', () => {
    expect(classifySyncError(new Error('Authentication failed for https://x/y.git')).category).toBe(
      'auth',
    );
  });
  it('网络错误 → network', () => {
    expect(
      classifySyncError(new Error('fatal: unable to access: Could not resolve host: x')).category,
    ).toBe('network');
  });
  it('non-fast-forward → non-fast-forward', () => {
    expect(
      classifySyncError(
        new Error('Updates were rejected because the remote contains work (non-fast-forward)'),
      ).category,
    ).toBe('non-fast-forward');
  });
  it('Git 二进制缺失 → git-missing', () => {
    expect(
      classifySyncError(
        Object.assign(new Error('bundled Git 缺失'), { code: 'GIT_BINARY_MISSING' }),
      ).category,
    ).toBe('git-missing');
  });
  it('未知 → unknown', () => {
    expect(classifySyncError(new Error('奇怪错误')).category).toBe('unknown');
  });
});

describe('sanitizeDiagnosticText（脱敏）', () => {
  it('剥离 URL userinfo 凭据', () => {
    expect(sanitizeDiagnosticText('https://user:secret@github.com/a/b.git')).not.toContain(
      'secret',
    );
  });
  it('剥离 token=xxx 键值对', () => {
    expect(sanitizeDiagnosticText('fetch failed token=abc123 after retry')).not.toContain('abc123');
  });
  it('剥离 Authorization Bearer/Basic 以及凭据键（含下划线和 URL query）', () => {
    const text = sanitizeDiagnosticText(
      'Authorization: Bearer bearer-value; Authorization: Basic basic-value ' +
        'client_secret=cs-value api_key=ak-value access_token=at-value password=pw-value ' +
        'token=tok-value secret=sec-value key=key-value ' +
        'https://host/x?client_secret=url-cs&api_key=url-ak&access_token=url-at',
    );
    expect(text).toContain('Authorization: ***');
    for (const secret of [
      'bearer-value',
      'basic-value',
      'cs-value',
      'ak-value',
      'at-value',
      'pw-value',
      'tok-value',
      'sec-value',
      'key-value',
      'url-cs',
      'url-ak',
      'url-at',
    ])
      expect(text).not.toContain(secret);
  });
});

describe('GitSyncDoctor 修复计划（白名单 + 禁止破坏命令）', () => {
  it('dirty → commit；behind+clean → pull；ahead → push', async () => {
    const a = doctorWith(fakeGit({ changed: 2 }));
    expect((await a.doctor.diagnose()).plan.action).toBe('commit');
    const b = doctorWith(fakeGit({ behind: 3 }));
    expect((await b.doctor.diagnose()).plan.action).toBe('pull');
    const c = doctorWith(fakeGit({ ahead: 2 }));
    expect((await c.doctor.diagnose()).plan.action).toBe('push');
  });
  it('分叉（ahead+behind）不提供自动修复', async () => {
    const { doctor } = doctorWith(fakeGit({ ahead: 1, behind: 1 }));
    const d = await doctor.diagnose();
    expect(d.plan.action).toBeNull();
    expect(d.plan.safe).toBe(false);
  });
  it('conflict 不自动覆盖：action=null，只给人工指引', async () => {
    const { doctor } = doctorWith(fakeGit({ conflict: true }));
    const d = await doctor.diagnose();
    expect(d.issue.category).toBe('conflict');
    expect(d.plan.action).toBeNull();
    expect(d.plan.safe).toBe(false);
    expect(d.plan.manualGuidance).toContain('Agent');
  });
  it('所有 commandPreview 均不含破坏性命令', async () => {
    for (const action of GIT_REPAIR_ACTIONS) {
      const git = fakeGit(
        action === 'commit' ? { changed: 1 } : action === 'pull' ? { behind: 1 } : { ahead: 1 },
      );
      const { doctor } = doctorWith(git);
      const d = await doctor.diagnose();
      const preview = d.plan.commandPreview ?? '';
      expect(preview).toBeTruthy();
      expect(preview).not.toMatch(
        /reset\s+--hard|clean|checkout\s+--\s*\.|push\s+.*--force|push\s+-f/,
      );
    }
  });
});

describe('ticket 一次性 / TTL / 参数漂移（TOCTOU）', () => {
  it('ticket 只能消费一次；第二次 INVALID_TICKET', async () => {
    const git = fakeGit({ changed: 2 });
    git.statusFor.mockResolvedValue({
      repository: true,
      branch: 'main',
      changed: 2,
      ahead: 0,
      behind: 0,
      remote: 'origin',
      conflict: false,
      usingSystemGit: false,
    });
    const { doctor } = doctorWith(git);
    const { ticket } = await doctor.prepare('commit');
    // commit 后 changed=0：execute 内部校验用同一替身状态 → 先复刻漂移再复位
    git.statusFor.mockResolvedValue({
      repository: true,
      branch: 'main',
      changed: 2,
      ahead: 0,
      behind: 0,
      remote: 'origin',
      conflict: false,
      usingSystemGit: false,
    });
    await doctor.execute(ticket);
    await expect(doctor.execute(ticket)).rejects.toMatchObject({ code: 'INVALID_TICKET' });
  });
  it('过期 ticket 拒绝执行（TICKET_EXPIRED）且一次性消费', async () => {
    let clock = 1_000_000;
    const git = fakeGit({ changed: 1 });
    const { doctor } = doctorWith(git, { now: () => clock, ttlMs: 60_000 });
    const { ticket } = await doctor.prepare('commit');
    clock += 61_000;
    await expect(doctor.execute(ticket)).rejects.toMatchObject({ code: 'TICKET_EXPIRED' });
    clock += 1;
    await expect(doctor.execute(ticket)).rejects.toMatchObject({ code: 'INVALID_TICKET' });
  });
  it('prepare 后 vault 切换 → ROOT_CHANGED，且 git 操作未被调用', async () => {
    const git = fakeGit({ changed: 1 });
    const { doctor, setRoot } = doctorWith(git);
    const { ticket } = await doctor.prepare('commit');
    setRoot('/vault/b');
    await expect(doctor.execute(ticket)).rejects.toMatchObject({ code: 'ROOT_CHANGED' });
    expect(git.commitManual).not.toHaveBeenCalled();
  });
  it('状态漂移（prepare 后 changed 变化）→ STATE_DRIFT，不执行任何命令', async () => {
    const git = fakeGit({ changed: 1 });
    const { doctor } = doctorWith(git);
    const { ticket } = await doctor.prepare('commit');
    git.statusFor.mockResolvedValue({
      repository: true,
      branch: 'main',
      changed: 5,
      ahead: 0,
      behind: 0,
      remote: 'origin',
      conflict: false,
      usingSystemGit: false,
    });
    await expect(doctor.execute(ticket)).rejects.toMatchObject({ code: 'STATE_DRIFT' });
    expect(git.commitManual).not.toHaveBeenCalled();
  });
  it('内容指纹漂移（文件 sha256）→ STATE_DRIFT，不执行命令', async () => {
    const git = fakeGit({ changed: 1 });
    const { doctor } = doctorWith(git);
    const { ticket } = await doctor.prepare('commit');
    git.doctorFingerprint.mockResolvedValue({
      headOid: 'head-1',
      remoteOid: 'remote-1',
      porcelain: ' M note.md',
      files: [{ path: 'note.md', sha256: 'changed-hash' }],
    });
    await expect(doctor.execute(ticket)).rejects.toMatchObject({ code: 'STATE_DRIFT' });
    expect(git.commitManual).not.toHaveBeenCalled();
  });
  it('prepare 拒绝不属于该类别的 action（ACTION_NOT_ALLOWED）', async () => {
    const git = fakeGit({ ahead: 2 }); // 类别只允许 push
    const { doctor } = doctorWith(git);
    await expect(doctor.prepare('pull')).rejects.toMatchObject({ code: 'ACTION_NOT_ALLOWED' });
  });
  it('prepare 非法 action → INVALID_ACTION', async () => {
    const { doctor } = doctorWith(fakeGit());
    await expect(doctor.prepare('reset --hard' as never)).rejects.toMatchObject({
      code: 'INVALID_ACTION',
    });
  });
  it('conflict 状态 prepare → CONFLICT_PRESENT，不签发票据', async () => {
    const git = fakeGit({ conflict: true });
    const { doctor } = doctorWith(git);
    await expect(doctor.prepare('commit')).rejects.toMatchObject({ code: 'CONFLICT_PRESENT' });
  });
  it('dismiss 清空票据：execute → INVALID_TICKET', async () => {
    const git = fakeGit({ changed: 1 });
    const { doctor } = doctorWith(git);
    const { ticket } = await doctor.prepare('commit');
    doctor.dismiss();
    await expect(doctor.execute(ticket)).rejects.toMatchObject({ code: 'INVALID_TICKET' });
  });
  it('无 vault → git-missing/NO_VAULT 诊断且不抛错', async () => {
    const { doctor } = doctorWith(fakeGit(), { root: null });
    const d = await doctor.diagnose();
    expect(d.issue.code).toBe('NO_VAULT');
  });
  it('statusFor 原始异常 → STATUS_FAILED 稳定文案，票据一次性消费', async () => {
    const git = fakeGit({ changed: 1 });
    const { doctor } = doctorWith(git);
    const { ticket } = await doctor.prepare('commit');
    git.statusFor.mockRejectedValue(new Error('Authorization: Bearer sk-live-abcdef123'));
    const error = await doctor.execute(ticket).catch((e: Error & { code?: string }) => e);
    expect(error).toMatchObject({ code: 'STATUS_FAILED' });
    expect(error.message).not.toContain('sk-live-abcdef123');
    expect(error.message).toBe('无法读取当前仓库状态，请重试');
    await expect(doctor.execute(ticket)).rejects.toMatchObject({ code: 'INVALID_TICKET' });
    expect(git.commitManual).not.toHaveBeenCalled();
  });
  it('execute 走 commitManual/pull/push 既有安全路径且无其它 git 调用', async () => {
    const git = fakeGit({ changed: 1 });
    const { doctor } = doctorWith(git);
    const { ticket } = await doctor.prepare('commit');
    const result = await doctor.execute(ticket);
    expect(git.commitManual).toHaveBeenCalledOnce();
    expect(result.message).toBeTruthy();
  });
});

describe('AI 解释（脱敏降级）', () => {
  it('未配置 AI → 规则降级 explanationSource=rules', async () => {
    const { doctor } = doctorWith(fakeGit({ behind: 2 }));
    const d = await doctor.diagnose();
    expect(d.explanationSource).toBe('rules');
    expect(d.explanation).toContain('落后');
  });
  it('AI 可用时返回 ai 解释', async () => {
    const ai = { chatCompletion: vi.fn(async () => ({ content: '远程有新版本，拉取即可同步。' })) };
    const { doctor } = doctorWith(fakeGit({ behind: 2 }), { ai });
    const d = await doctor.diagnose();
    expect(d.explanationSource).toBe('ai');
    expect(ai.chatCompletion).toHaveBeenCalled();
  });
  it('AI 失败 → 规则降级不抛错', async () => {
    const ai = {
      chatCompletion: vi.fn(async () => {
        throw new Error('AI_NOT_CONFIGURED');
      }),
    };
    const { doctor } = doctorWith(fakeGit({ behind: 2 }), { ai });
    const d = await doctor.diagnose();
    expect(d.explanationSource).toBe('rules');
  });
  it('AI 返回命令样式文本 → 丢弃降级为规则', async () => {
    const ai = {
      chatCompletion: vi.fn(async () => ({ content: '请执行 git reset --hard origin/main' })),
    };
    const { doctor } = doctorWith(fakeGit({ behind: 2 }), { ai });
    const d = await doctor.diagnose();
    expect(d.explanationSource).toBe('rules');
    expect(d.explanation).not.toContain('reset');
  });
});

describe('常量', () => {
  it('TTL 默认 5 分钟；action 白名单固定三项', () => {
    expect(GIT_DOCTOR_TICKET_TTL_MS).toBe(5 * 60_000);
    expect(GIT_REPAIR_ACTIONS).toEqual(['commit', 'pull', 'push']);
  });
  it('GitSyncDoctorError 携带稳定 code', () => {
    expect(new GitSyncDoctorError('x', 'TICKET_EXPIRED').code).toBe('TICKET_EXPIRED');
  });
});
