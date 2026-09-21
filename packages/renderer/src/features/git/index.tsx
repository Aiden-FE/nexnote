import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  GitBranch,
  GitCommit,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Settings2,
} from 'lucide-react';
import type {
  GitCommit as TimelineCommit,
  GitRemote,
  GitRestorePreview,
  GitStatus,
  GitDoctorDiagnosis,
  GitDoctorRepairPrepareResult,
} from '@nexnote/shared';
import { dockPanelRegistry, statusBarRegistry } from '../../registries';
import { invoke, onEvent } from '../../lib/ipc';
import { requestAppSave } from '../../editor/app-save';
import { useVault } from '../../shell/vault-context';

statusBarRegistry.register({ id: 'git', align: 'left', render: GitStatusItem });
dockPanelRegistry.register({
  id: 'git-timeline',
  title: '版本时间线',
  icon: History,
  render: GitTimeline,
});

type SyncPhase = 'fetching' | 'rebasing' | 'merging' | 'pushing' | 'done' | 'error';

function useGitStatus(): [GitStatus | null, () => Promise<void>] {
  const vault = useVault();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const refresh = async (): Promise<void> => {
    if (!vault) return setStatus(null);
    try {
      setStatus(await invoke('git:getStatus'));
    } catch {
      setStatus(null);
    }
  };
  useEffect(() => {
    // 初次加载为异步 IPC 拉取（与 App 壳一致），事件订阅负责后续增量
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    if (!vault) return;
    return onEvent('git:statusChanged', setStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.root]);
  return [status, refresh];
}

function GitStatusItem() {
  const vault = useVault();
  const [status, refresh] = useGitStatus();
  const [phase, setPhase] = useState<SyncPhase | null>(null);
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<GitDoctorDiagnosis | null>(null);
  const [doctorTicket, setDoctorTicket] = useState<GitDoctorRepairPrepareResult | null>(null);
  void useState(false); // 占位，避免后续删除 useState 引入的 lint 噪声
  useEffect(() => {
    return onEvent('git:syncProgress', (payload) => {
      setPhase(payload.phase);
      setPhaseMessage(payload.message ?? null);
      if (payload.phase === 'done') {
        // 主流程结束：保留 600ms 让用户感知"已完成"，再清掉 spinner。
        setTimeout(() => setPhase(null), 600);
      }
    });
  }, []);
  // vault 切换时让主进程按当前 vault 的自动同步配置启停计时器。
  useEffect(() => {
    void invoke('git:configureAutoSync').catch(() => undefined);
  }, [vault?.root]);
  const runSync = async () => {
    setDoctor(null);
    setError(null);
    setPhase('fetching');
    setPhaseMessage('正在同步…');
    try {
      await invoke('git:sync');
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : String(caught);
      setError(text);
      setPhase('error');
      try {
        setDoctor(await invoke('git:doctor:diagnose'));
      } catch {
        /* doctor 不可用时保留原始错误即可 */
      }
    } finally {
      void refresh();
    }
  };
  if (!vault) return null;
  if (!status)
    return (
      <span data-testid="status-git" data-tour="git-timeline">
        Git…
      </span>
    );
  const prepareDoctor = async () => {
    if (!doctor?.plan.action) return;
    setDoctorBusy(true);
    try {
      setDoctorTicket(await invoke('git:doctor:repairPrepare', { action: doctor.plan.action }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDoctorBusy(false);
    }
  };
  const executeDoctor = async () => {
    if (!doctorTicket) return;
    setDoctorBusy(true);
    try {
      await invoke('git:doctor:repairExecute', { ticket: doctorTicket.ticket });
      setDoctorTicket(null);
      setDoctor(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDoctorBusy(false);
      void refresh();
    }
  };
  const dismissDoctor = async () => {
    setDoctorTicket(null);
    setDoctor(null);
    await invoke('git:doctor:dismiss').catch(() => undefined);
  };
  const busy = phase !== null && phase !== 'done';
  const titleText =
    error ??
    (phase && phase !== 'done' ? phaseMessage ?? '正在同步…' : undefined) ??
    `${status.usingSystemGit ? '系统' : '捆绑'} Git · ${status.remote ?? '未配置远程'} · 点击同步`;
  return (
    <div
      data-testid="status-git"
      data-tour="git-timeline"
      className="flex items-center gap-1.5 text-muted-foreground"
      title={titleText}
    >
      <span data-testid="status-git-branch" className="flex items-center gap-1">
        <GitBranch className="size-3.5" />
        {status.branch ?? '未初始化'}
      </span>
      {status.conflict && (
        <span
          data-testid="status-git-conflict"
          className="rounded bg-destructive/15 px-1 font-medium text-destructive"
          title="存在未解决的合并冲突"
        >
          ⚠ 冲突
        </span>
      )}
      {status.changed > 0 && (
        <span className="rounded bg-amber-500/15 px-1 text-amber-700">● {status.changed}</span>
      )}
      {status.remote && (
        <>
          <span className="text-orange-600">{status.behind ? `↓${status.behind}` : ''}</span>
          <span className="text-sky-600">{status.ahead ? `↑${status.ahead}` : ''}</span>
        </>
      )}
      <button
        type="button"
        title={busy ? phaseMessage ?? '正在同步…' : '一键同步：拉取 + 合并 + 推送'}
        disabled={busy}
        onClick={() => void runSync()}
        className="rounded p-0.5 hover:bg-accent disabled:opacity-60"
        data-testid="status-git-sync"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ArrowDownUp className="size-3.5" />
        )}
      </button>
      {doctor && (
        <DoctorDialog
          diagnosis={doctor}
          onPrepare={() => void prepareDoctor()}
          onDismiss={() => void dismissDoctor()}
        />
      )}
      {doctorTicket && (
        <DoctorTicketDialog
          prepared={doctorTicket}
          onExecute={() => void executeDoctor()}
          onDismiss={() => void dismissDoctor()}
        />
      )}
    </div>
  );
}

function GitTimeline() {
  const vault = useVault();
  const [commits, setCommits] = useState<TimelineCommit[]>([]);
  const [filePath, setFilePath] = useState('');
  const [manualMessage, setManualMessage] = useState('');
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [remoteName, setRemoteName] = useState('origin');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [useSystemGit, setUseSystemGit] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [restore, setRestore] = useState<{
    commit: TimelineCommit;
    preview: GitRestorePreview;
  } | null>(null);
  // generation guard prevents a slow earlier refresh from overwriting a newer one
  // (e.g. the user rapidly cycles the file filter; the first response must not clobber).
  const refreshGen = useRef(0);
  const refresh = async (): Promise<void> => {
    if (!vault) return;
    const gen = ++refreshGen.current;
    const pathArg = filePath.trim() || undefined;
    try {
      const [timeline, listed, status] = await Promise.all([
        invoke('git:getTimeline', { path: pathArg, limit: 100 }),
        invoke('git:listRemotes'),
        invoke('git:getStatus'),
      ]);
      if (gen !== refreshGen.current) return;
      setCommits(timeline);
      setRemotes(listed);
      setUseSystemGit(status.usingSystemGit);
    } catch (e) {
      if (gen !== refreshGen.current) return;
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    // 初次加载为异步 IPC 拉取；vault 切换或文件过滤变化时重新加载
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    if (!vault) return;
    return onEvent('git:statusChanged', () => void refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.root, filePath]);
  const commitManual = async (): Promise<void> => {
    if (!manualMessage.trim()) return setMessage('提交说明不能为空');
    try {
      await requestAppSave(window);
      await invoke('git:commit', { message: manualMessage });
      setManualMessage('');
      setMessage('已创建手动提交');
      await refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const submitRemote = async () => {
    try {
      await invoke('git:addRemote', { name: remoteName, url: remoteUrl });
      setMessage('远程已保存并通过授权预检');
      setRemoteUrl('');
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const previewRestore = async (commit: TimelineCommit) => {
    if (!filePath.trim()) return setMessage('请输入要恢复的知识库内相对文件路径');
    try {
      setRestore({
        commit,
        preview: await invoke('git:previewRestore', { path: filePath.trim(), commit: commit.hash }),
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const grouped = useMemo(() => groupAutoCommits(commits), [commits]);
  return (
    <section data-testid="git-timeline" className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="size-4" />
        <h2 className="font-medium">版本时间线</h2>
        <button
          type="button"
          className="ml-auto rounded p-1 hover:bg-accent"
          title="刷新"
          onClick={() => void refresh()}
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <label className="block text-xs">
        单篇文件时间线
        <input
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="notes/page.md（留空显示全部）"
          className="mt-1 h-8 w-full rounded border bg-background px-2 text-xs"
        />
      </label>
      <div className="flex gap-1">
        <input
          value={manualMessage}
          onChange={(e) => setManualMessage(e.target.value)}
          placeholder="手动提交说明（点击提交）"
          className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-xs"
        />
        <button
          type="button"
          onClick={() => void commitManual()}
          className="rounded border px-2 text-xs hover:bg-accent"
        >
          提交
        </button>
      </div>
      <details className="rounded border p-2">
        <summary className="cursor-pointer text-xs font-medium">远程仓库与 Git 设置</summary>
        <div className="mt-2 space-y-2">
          <div className="flex gap-1">
            <input
              value={remoteName}
              onChange={(e) => setRemoteName(e.target.value)}
              aria-label="远程名称"
              className="h-8 w-20 rounded border px-2 text-xs"
            />
            <input
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              aria-label="远程地址"
              placeholder="HTTPS 或 SSH 地址"
              className="h-8 min-w-0 flex-1 rounded border px-2 text-xs"
            />
            <button
              type="button"
              onClick={() => void submitRemote()}
              className="rounded border px-2 text-xs"
            >
              添加/更新
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            保存时执行 git ls-remote 授权预检；失败请检查网络、SSH key 或 HTTPS 凭证。
          </p>
          {remotes.map((remote) => (
            <button
              type="button"
              key={remote.name}
              onClick={() => {
                setRemoteName(remote.name);
                setRemoteUrl(remote.pushUrl || remote.fetchUrl);
              }}
              className="block text-left text-xs underline"
            >
              {remote.name}: {remote.pushUrl || remote.fetchUrl}（编辑）
            </button>
          ))}
          <label className="flex items-center gap-2 text-xs">
            <Settings2 className="size-3" />
            <input
              type="checkbox"
              checked={useSystemGit}
              onChange={(event) => {
                const enabled = event.target.checked;
                void invoke('git:setUseSystemGit', { enabled })
                  .then(() => setUseSystemGit(enabled))
                  .catch((caught: unknown) =>
                    setMessage(caught instanceof Error ? caught.message : String(caught)),
                  );
              }}
            />
            使用系统 Git（默认使用捆绑 Git）
          </label>
        </div>
      </details>
      {message && (
        <p className="rounded border px-2 py-1 text-xs text-muted-foreground">{message}</p>
      )}
      <ol className="space-y-1.5">
        {grouped.map((group) =>
          group.auto ? (
            <AutoGroup key={group.key} entries={group.entries} onRestore={previewRestore} />
          ) : (
            group.entries.map((entry) => (
              <CommitRow key={entry.hash} entry={entry} onRestore={previewRestore} />
            ))
          ),
        )}
      </ol>
      {restore && (
        <RestorePreview
          restore={restore}
          onCancel={() => setRestore(null)}
          onConfirm={() => {
            void invoke('git:restoreFile', {
              path: restore.preview.path,
              commit: restore.commit.hash,
            })
              .then(() => {
                setRestore(null);
                setMessage('已恢复文件并创建新的恢复提交');
                void refresh();
              })
              .catch((caught: unknown) =>
                setMessage(caught instanceof Error ? caught.message : String(caught)),
              );
          }}
        />
      )}
    </section>
  );
}
function groupAutoCommits(commits: TimelineCommit[]) {
  const groups: Array<{ key: string; auto: boolean; entries: TimelineCommit[] }> = [];
  for (const entry of commits) {
    const key =
      entry.kind === 'auto'
        ? `auto-${new Date(entry.date).toISOString().slice(0, 13)}`
        : entry.hash;
    const last = groups.at(-1);
    if (entry.kind === 'auto' && last?.key === key) last.entries.push(entry);
    else groups.push({ key, auto: entry.kind === 'auto', entries: [entry] });
  }
  return groups;
}
function AutoGroup({
  entries,
  onRestore,
}: {
  entries: TimelineCommit[];
  onRestore(commit: TimelineCommit): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-2 py-1.5 text-left text-xs"
      >
        自动提交 · {entries.length} 条 · {open ? '收起' : '展开'}
      </button>
      {open && (
        <ol className="space-y-1 border-t p-1">
          {entries.map((entry) => (
            <CommitRow key={entry.hash} entry={entry} onRestore={onRestore} />
          ))}
        </ol>
      )}
    </li>
  );
}
function CommitRow({
  entry,
  onRestore,
}: {
  entry: TimelineCommit;
  onRestore(commit: TimelineCommit): void;
}) {
  return (
    <li
      className={`rounded border px-2 py-1.5 text-xs ${entry.kind === 'manual' ? 'border-primary/40 bg-primary/5' : ''}`}
    >
      <div className="flex gap-1 font-mono text-[10px] text-muted-foreground">
        {entry.isHead && <span className="text-primary">HEAD</span>}
        <span>{entry.shortHash}</span>
        <span className="ml-auto">{new Date(entry.date).toLocaleString()}</span>
      </div>
      <p className="mt-0.5 flex items-center gap-1 text-foreground">
        <GitCommit className="size-3" />
        {entry.message}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{entry.author}</p>
      <button
        type="button"
        onClick={() => onRestore(entry)}
        className="mt-1 flex items-center gap-1 text-[10px] text-primary"
      >
        <RotateCcw className="size-3" />
        恢复此版本
      </button>
    </li>
  );
}
function DoctorDialog({
  diagnosis,
  onPrepare,
  onDismiss,
}: {
  diagnosis: GitDoctorDiagnosis;
  onPrepare(): void;
  onDismiss(): void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Git 同步诊断"
      className="fixed bottom-10 left-4 z-20 w-80 rounded border bg-card p-3 shadow"
    >
      <p className="font-medium">Git 同步诊断：{diagnosis.issue.category}</p>
      <p className="mt-1 text-xs">{diagnosis.explanation}</p>
      {diagnosis.conflictFiles.length > 0 && (
        <p className="mt-1 text-[10px]">冲突文件：{diagnosis.conflictFiles.join('、')}</p>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground">{diagnosis.plan.manualGuidance}</p>
      <div className="mt-2 flex gap-2">
        {diagnosis.plan.action && (
          <button
            type="button"
            onClick={onPrepare}
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
          >
            预览并准备
          </button>
        )}
        <button type="button" onClick={onDismiss} className="rounded border px-2 py-1 text-xs">
          忽略
        </button>
      </div>
    </div>
  );
}
function DoctorTicketDialog({
  prepared,
  onExecute,
  onDismiss,
}: {
  prepared: GitDoctorRepairPrepareResult;
  onExecute(): void;
  onDismiss(): void;
}) {
  return (
    <div
      role="dialog"
      aria-label="确认 Git 修复"
      className="fixed bottom-10 left-4 z-20 w-80 rounded border border-amber-500/40 bg-card p-3 shadow"
    >
      <p className="font-medium">确认执行安全修复？</p>
      <p className="mt-1 text-xs">{prepared.diagnosis.plan.commandPreview}</p>
      <p className="mt-1 text-[10px]">
        票据有效至 {new Date(prepared.ticketExpiresAt).toLocaleTimeString()}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onExecute}
          className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
        >
          确认执行
        </button>
        <button type="button" onClick={onDismiss} className="rounded border px-2 py-1 text-xs">
          拒绝
        </button>
      </div>
    </div>
  );
}

function RestorePreview({
  restore,
  onCancel,
  onConfirm,
}: {
  restore: { commit: TimelineCommit; preview: GitRestorePreview };
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <div
      role="dialog"
      aria-label="恢复预览"
      className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
    >
      <p className="font-medium">
        确认恢复 {restore.preview.path} 到 {restore.commit.shortHash}？
      </p>
      <p className="mt-1">将生成新的恢复提交，不会改写历史。</p>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[10px]">
        {buildLineDiff(restore.preview.current ?? '', restore.preview.target)}
      </pre>
      <p className="mt-1 text-[10px] text-muted-foreground">- 当前内容 · + 恢复后的目标内容</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded bg-primary px-2 py-1 text-primary-foreground"
        >
          确认恢复
        </button>
        <button type="button" onClick={onCancel} className="rounded border px-2 py-1">
          取消
        </button>
      </div>
    </div>
  );
}

function buildLineDiff(current: string, target: string): string {
  const before = current.split('\n');
  const after = target.split('\n');
  const lines: string[] = [];
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    if (before[index] === after[index]) lines.push(`  ${before[index] ?? ''}`);
    else {
      if (before[index] !== undefined) lines.push(`- ${before[index]}`);
      if (after[index] !== undefined) lines.push(`+ ${after[index]}`);
    }
  }
  return lines.join('\n');
}
