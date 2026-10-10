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
  GitRepairAction,
} from '@nexnote/shared';
import { dockPanelRegistry, statusBarRegistry } from '../../registries';
import { invoke, onEvent } from '../../lib/ipc';
import { t, useI18n } from '../../lib/i18n';
import { requestAppSave } from '../../editor/app-save';
import { useVault } from '../../shell/vault-context';
import { useUiStore } from '../../stores/ui-store';
import { useChatStore, nextChipId } from '../ai/chat/chat-store';
import { startNewSession, sendMessage, setPermissionMode } from '../ai/chat/chat-runtime';
import {
  reduceSyncProgress,
  conflictHoverText,
  initialPhaseMessage,
  type SyncPhase,
} from './state-machine';

statusBarRegistry.register({ id: 'git', align: 'left', render: GitStatusItem });
dockPanelRegistry.register({
  id: 'git-timeline',
  title: 'dock.panel.gitTimeline',
  titleIsKey: true,
  icon: History,
  render: GitTimeline,
});

export type { SyncPhase } from './state-machine';
export {
  reduceSyncProgress,
  conflictHoverText,
  initialPhaseMessage,
  isBusyPhase,
} from './state-machine';

/** doctor 服务返回稳定 code；用户可读文案由词典成文，未知 code 保留脱敏原文。 */
function doctorErrorText(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const key = code ? `git.doctor.error.${code}` : null;
  const text = key ? t(key) : '';
  return text === key ? (error instanceof Error ? error.message : String(error)) : text;
}

/** 已知 issue code 直接成文；服务端新 code / 测试注入 message 保留原文边界。 */
function doctorIssueText(issue: { code: string; message: string }): string {
  const key = `git.doctor.issue.${issue.code}`;
  const text = t(key);
  return text === key ? issue.message : text;
}

/** manual guidance 按 issue category 成文；未知 category 回退 unknown 指引。 */
function doctorManualGuidance(category: string): string {
  const key = `git.doctor.manual.${category}`;
  const text = t(key);
  return text === key ? t('git.doctor.manual.unknown') : text;
}

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
  const tr = useI18n();
  const vault = useVault();
  const [status, refresh] = useGitStatus();
  const [phase, setPhase] = useState<SyncPhase | null>(null);
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<GitDoctorDiagnosis | null>(null);
  const [doctorBusy, setDoctorBusy] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return onEvent('git:syncProgress', (payload) => {
      const next = reduceSyncProgress(
        { phase, phaseMessage },
        { phase: payload.phase, message: payload.message ?? null },
      );
      // 取消上一次未触发的清理定时器，避免 done 期间被新一轮进度覆盖
      if (clearTimer.current) {
        clearTimeout(clearTimer.current);
        clearTimer.current = null;
      }
      setPhase(next.phase);
      setPhaseMessage(next.phaseMessage);
      if (next.clearAfterMs !== null && next.clearAfterMs !== undefined) {
        clearTimer.current = setTimeout(() => setPhase(null), next.clearAfterMs);
      }
    });
    // reducer 是纯函数；phase/phaseMessage 的最新值由 setState 后下一次事件带入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );
  // vault 切换时让主进程按当前 vault 的自动同步配置启停计时器。
  useEffect(() => {
    void invoke('git:configureAutoSync').catch(() => undefined);
  }, [vault?.root]);
  const diagnose = async (failureMessage?: string) => {
    if (failureMessage) setError(failureMessage);
    try {
      const diagnosis = await invoke('git:doctor:diagnose');
      setDoctor(diagnosis);
      return diagnosis;
    } catch (caught) {
      // doctor 不可用时保留错误信息即可，不强制弹窗
      const text = doctorErrorText(caught);
      if (text) setError(text);
      setDoctor(null);
      return null;
    }
  };
  // DEV-088: vault 打开后若 status 已经是 conflict 或 rebaseInProgress，主动调
  // doctor 并弹窗——不需要用户点徽标。重复触发由 doctor 自身的幂等性保证。
  useEffect(() => {
    if (!vault || !status) return;
    if (!status.conflict && !status.rebaseInProgress) return;
    // 延迟到下一微任务，避免在 effect 同步体内触发 diagnose() 内部的 setState
    // （react-hooks/set-state-in-effect）；doctor 弹出本身是副作用而非状态派生。
    const timer = setTimeout(() => void diagnose(), 0);
    return () => clearTimeout(timer);
    // 仅在 vault 切换或 status 边界变化时弹一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.root, status?.conflict, status?.rebaseInProgress]);
  const runSync = async () => {
    setDoctor(null);
    setError(null);
    setPhase('fetching');
    setPhaseMessage(initialPhaseMessage('fetching'));
    try {
      await invoke('git:sync');
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : String(caught);
      await diagnose(text);
    } finally {
      void refresh();
      // DEV-088: clear stale spinner when the main-side sync threw before emitting a
      // terminal phase (e.g. requireRoot / fetch up front). The next syncProgress event
      // re-drives the reducer; this guard only removes the stuck 'fetching' badge.
      if (clearTimer.current) {
        clearTimeout(clearTimer.current);
        clearTimer.current = null;
      }
      setPhase(null);
      setPhaseMessage(null);
    }
  };
  // DEV-076：冲突徽标可点击 → 自动触发诊断并弹出 DoctorDialog
  const openConflictDiagnosis = async () => {
    await diagnose();
  };
  if (!vault) return null;
  if (!status)
    return (
      <span data-testid="status-git" data-tour="git-timeline">
        Git…
      </span>
    );
  // DEV-073 一键修复：plan.action 可执行时 prepare + execute 在一次交互内完成。
  const runOneClickRepair = async () => {
    if (!doctor?.plan.action) return;
    await runRepair(doctor.plan.action);
  };
  // DEV-083：显式指定 action 的修复（用于弹窗里的两个分流按钮）。
  const runRepair = async (action: GitRepairAction) => {
    setDoctorBusy(true);
    setError(null);
    try {
      const prepared = await invoke('git:doctor:repairPrepare', { action });
      await invoke('git:doctor:repairExecute', { ticket: prepared.ticket });
      setDoctor(null);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setError(text);
      // NO_OPERATION 表示计划依据的状态已经消失（例如用户在终端里中止了
      // rebase）。此时继续展示旧诊断只会让用户反复点击一个永远失败的按钮；
      // 重新诊断让弹窗回到当前真实状态。
      if ((e as { code?: string }).code === 'NO_OPERATION') {
        await diagnose(text);
      }
    } finally {
      setDoctorBusy(false);
      void refresh();
    }
  };
  // DEV-073 + 新增 sync-doctor 入口：把脱敏诊断作为结构化上下文带入 AI 对话，
  // 并直接告诉 Agent 优先调 git_doctor_repair（医生已认可的 action）。
  const openAgentHelp = async () => {
    const ui = useUiStore.getState();
    ui.setActiveDockPanel('ai-chat');
    const store = useChatStore.getState();
    const ensure = store.active ? Promise.resolve() : startNewSession();
    await ensure;
    // 切到编辑态：git_doctor_repair 是 write 工具 + requiresApproval，
    // 编辑态才会走 approvalRequired 流程让用户逐项确认。
    await setPermissionMode('edit');

    const diag = doctor;
    // 结构化 chip：Agent 看到的是字段而非 prose 摘要，能更稳地选择 action。
    const chipText = [
      'Git 同步诊断结果：',
      diag ? `类别：${diag.issue.category}（${diag.issue.code}）` : '',
      diag?.explanation ? `说明：${diag.explanation}` : '',
      diag?.conflictFiles.length ? `冲突文件：${diag.conflictFiles.join('、')}` : '',
      diag?.plan.action ? `推荐操作：${diag.plan.action}` : '推荐操作：（无自动修复）',
      diag?.plan.commandPreview ? `命令预览：${diag.plan.commandPreview}` : '',
      diag?.plan.manualGuidance ? `用户指引：${diag.plan.manualGuidance}` : '',
      error ? `最近错误：${error}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    useChatStore.getState().addChip({
      id: nextChipId('sync-doctor'),
      kind: 'sync-doctor',
      label: t('git.chat.syncDoctorLabel'),
      text: chipText,
    });

    // 把医生的 action 写成强结构化指令，避免模型走"先问要不要执行"路径。
    // 注意：系统 prompt 已经硬约束「必须调 git_doctor_repair」，这里再把
    // action 名以 JSON-like 形式重复一遍降低误读概率。
    const actionHint = diag?.plan.action
      ? `[INSTRUCTION] 必须立即调用 git_doctor_repair 工具，` +
        `参数 {"action": "${diag.plan.action}"}。` +
        `不要先问"是否执行"、不要输出步骤说明、不要让用户手动跑命令。` +
        `调用前一句话告诉用户你要做什么，调用后报告 doctor 返回的 message 或错误码。`
      : '医生没有给出可自动执行的动作；请基于诊断信息给用户清晰的步骤指引。';
    const prompt = [
      '同步医生已诊断此问题（点击触发）。',
      diag?.plan.action ? `推荐动作：${diag.plan.action}` : '',
      diag?.issue.message ? `错误摘要：${diag.issue.message}` : '',
      actionHint,
    ]
      .filter(Boolean)
      .join('\n');

    await sendMessage(prompt);
  };
  const dismissDoctor = async () => {
    setDoctor(null);
    setError(null);
    // 关闭弹窗时显式收尾 spinner（error 状态也会被同步清掉）
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    setPhase(null);
    setPhaseMessage(null);
    await invoke('git:doctor:dismiss').catch(() => undefined);
  };
  // DEV-076：error 与 done 同为终态，spinner 不再无限转圈
  const busy = phase !== null && phase !== 'done' && phase !== 'error';
  const titleText =
    error ??
    (busy ? (phaseMessage ?? tr('git.status.syncing')) : undefined) ??
    `${status.usingSystemGit ? tr('git.status.systemGit') : tr('git.status.bundledGit')} Git · ${status.remote ?? tr('git.status.noRemote')} · ${tr('git.status.clickToSync')}`;
  return (
    <div
      data-testid="status-git"
      data-tour="git-timeline"
      className="flex items-center gap-1.5 text-muted-foreground"
      title={titleText}
    >
      <span data-testid="status-git-branch" className="flex items-center gap-1">
        <GitBranch className="size-3.5" />
        {status.branch ?? tr('git.status.notInitialized')}
      </span>
      {status.conflict && (
        <button
          type="button"
          data-testid="status-git-conflict"
          className="cursor-pointer rounded bg-destructive/15 px-1 font-medium text-destructive hover:bg-destructive/25"
          title={conflictHoverText(status)}
          onClick={() => void openConflictDiagnosis()}
        >
          ⚠ {tr('git.status.conflict')}
        </button>
      )}
      {status.rebaseInProgress && (
        <span
          data-testid="status-git-rebase"
          className="rounded bg-amber-500/15 px-1 font-medium text-amber-700"
          title={tr('git.status.rebaseTitle')}
        >
          ⤴︎ {tr('git.status.rebaseInProgress')}
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
        title={busy ? (phaseMessage ?? tr('git.status.syncing')) : tr('git.status.syncTitle')}
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
          busy={doctorBusy}
          error={error}
          onOneClickRepair={() => void runOneClickRepair()}
          onRepairAction={(action) => void runRepair(action)}
          onOpenAgentHelp={() => void openAgentHelp()}
          onDismiss={() => void dismissDoctor()}
        />
      )}
    </div>
  );
}

function GitTimeline() {
  const vault = useVault();
  const tr = useI18n();
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
    if (!manualMessage.trim()) return setMessage(t('git.message.commitMessageRequired'));
    try {
      await requestAppSave(window);
      await invoke('git:commit', { message: manualMessage });
      setManualMessage('');
      setMessage(t('git.message.manualCommitCreated'));
      await refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const submitRemote = async () => {
    try {
      await invoke('git:addRemote', { name: remoteName, url: remoteUrl });
      setMessage(t('git.message.remoteSaved'));
      setRemoteUrl('');
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const previewRestore = async (commit: TimelineCommit) => {
    if (!filePath.trim()) return setMessage(t('git.message.restorePathRequired'));
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
        <h2 className="font-medium">{tr('git.timeline.title')}</h2>
        <button
          type="button"
          className="ml-auto rounded p-1 hover:bg-accent"
          title={tr('git.timeline.refresh')}
          onClick={() => void refresh()}
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <label className="block text-xs">
        {tr('git.timeline.fileFilter')}
        <input
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder={tr('git.timeline.fileFilterPlaceholder')}
          className="mt-1 h-8 w-full rounded border bg-background px-2 text-xs"
        />
      </label>
      <div className="flex gap-1">
        <input
          value={manualMessage}
          onChange={(e) => setManualMessage(e.target.value)}
          placeholder={tr('git.timeline.commitMessagePlaceholder')}
          className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-xs"
        />
        <button
          type="button"
          onClick={() => void commitManual()}
          className="rounded border px-2 text-xs hover:bg-accent"
        >
          {tr('git.timeline.commit')}
        </button>
      </div>
      <details className="rounded border p-2">
        <summary className="cursor-pointer text-xs font-medium">{tr('git.timeline.remoteSettings')}</summary>
        <div className="mt-2 space-y-2">
          <div className="flex gap-1">
            <input
              value={remoteName}
              onChange={(e) => setRemoteName(e.target.value)}
              aria-label={tr('git.timeline.remoteName')}
              className="h-8 w-20 rounded border px-2 text-xs"
            />
            <input
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              aria-label={tr('git.timeline.remoteUrl')}
              placeholder={tr('git.timeline.remoteUrlPlaceholder')}
              className="h-8 min-w-0 flex-1 rounded border px-2 text-xs"
            />
            <button
              type="button"
              onClick={() => void submitRemote()}
              className="rounded border px-2 text-xs"
            >
              {tr('git.timeline.addOrUpdate')}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {tr('git.timeline.remotePreflight')}
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
              {remote.name}: {remote.pushUrl || remote.fetchUrl}{tr('git.timeline.editRemote')}
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
            {tr('git.timeline.useSystemGit')}
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
                setMessage(t('git.message.restoreCreated'));
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
  const tr = useI18n();
  return (
    <li className="rounded border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-2 py-1.5 text-left text-xs"
      >
        {tr('git.timeline.autoGroup', {
          count: entries.length,
          action: open ? tr('git.timeline.collapse') : tr('git.timeline.expand'),
        })}
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
  const tr = useI18n();
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
        {tr('git.timeline.restoreVersion')}
      </button>
    </li>
  );
}
function DoctorDialog({
  diagnosis,
  busy,
  error,
  onOneClickRepair,
  onRepairAction,
  onOpenAgentHelp,
  onDismiss,
}: {
  diagnosis: GitDoctorDiagnosis;
  busy: boolean;
  error: string | null;
  onOneClickRepair(): void;
  onRepairAction(action: GitRepairAction): void;
  onOpenAgentHelp(): void;
  onDismiss(): void;
}) {
  const tr = useI18n();
  const canRepair = diagnosis.plan.action !== null;
  const isRebaseRepair =
    diagnosis.plan.action === 'preserve-local-and-abort' ||
    diagnosis.plan.action === 'abort-rebase-or-merge';
  // DEV-090：应用自有文件冲突可自动收敛并继续同步——这是「真正解决」，作为首选。
  const isContinueRepair = diagnosis.plan.action === 'resolve-conflict-and-continue';
  const issueText = doctorIssueText(diagnosis.issue);
  return (
    <div
      role="dialog"
      aria-label={tr('git.doctor.title')}
      className="fixed bottom-10 left-4 z-20 w-80 rounded border bg-card p-3 shadow"
    >
      <p className="font-medium">
        {tr('git.doctor.heading', { message: issueText })}
      </p>
      <p className="mt-1 text-xs">{diagnosis.explanation}</p>
      {diagnosis.conflictFiles.length > 0 && (
        <p className="mt-1 text-[10px]">
          {tr('git.doctor.conflictFiles', {
            files: diagnosis.conflictFiles.join(t('git.conflict.listSeparator')),
          })}
        </p>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground">
        {doctorManualGuidance(diagnosis.issue.category)}
      </p>
      {error && <p className="mt-1 text-[10px] text-destructive">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {isContinueRepair ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onOneClickRepair}
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-60"
            >
              {busy ? tr('git.doctor.busy.resolving') : tr('git.doctor.agentRepair')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRepairAction('preserve-local-and-abort')}
              className="rounded border px-2 py-1 text-xs disabled:opacity-60"
              title={tr('git.doctor.title.continueRepair')}
            >
              {tr('git.doctor.preserveAbort')}
            </button>
            <button
              type="button"
              onClick={onOpenAgentHelp}
              className="rounded border px-2 py-1 text-xs"
            >
              {tr('git.doctor.agentHelp')}
            </button>
          </>
        ) : canRepair && isRebaseRepair ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRepairAction('preserve-local-and-abort')}
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-60"
            >
              {busy ? tr('git.doctor.busy.preserving') : tr('git.doctor.preserveAbortRebase')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRepairAction('force-abort-rebase-or-merge')}
              className="rounded border border-destructive/40 px-2 py-1 text-xs text-destructive disabled:opacity-60"
              title={tr('git.doctor.title.discardLocal')}
            >
              {busy ? tr('git.doctor.busy.aborting') : tr('git.doctor.discardLocal')}
            </button>
            <button
              type="button"
              onClick={onOpenAgentHelp}
              className="rounded border px-2 py-1 text-xs"
            >
              {tr('git.doctor.agentHelp')}
            </button>
          </>
        ) : canRepair ? (
          <button
            type="button"
            disabled={busy}
            onClick={onOneClickRepair}
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-60"
          >
            {busy ? tr('git.doctor.busy.repairing') : tr('git.doctor.agentRepair')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenAgentHelp}
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
          >
            {tr('git.doctor.agentHelp')}
          </button>
        )}
        <button type="button" onClick={onDismiss} className="rounded border px-2 py-1 text-xs">
          {tr('git.doctor.dismiss')}
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
  const tr = useI18n();
  return (
    <div
      role="dialog"
      aria-label={tr('git.restore.title')}
      className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
    >
      <p className="font-medium">
        {tr('git.restore.confirmTitle', {
          path: restore.preview.path,
          hash: restore.commit.shortHash,
        })}
      </p>
      <p className="mt-1">{tr('git.restore.description')}</p>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[10px]">
        {buildLineDiff(restore.preview.current ?? '', restore.preview.target)}
      </pre>
      <p className="mt-1 text-[10px] text-muted-foreground">{tr('git.restore.legend')}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded bg-primary px-2 py-1 text-primary-foreground"
        >
          {tr('git.restore.confirm')}
        </button>
        <button type="button" onClick={onCancel} className="rounded border px-2 py-1">
          {tr('common.cancel')}
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
