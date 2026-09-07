import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CloudDownload,
  FolderOpen,
  FolderPlus,
  History,
  Loader2,
  Trash2,
} from 'lucide-react';
import { invoke } from '../lib/ipc';
import type { RecentVaultEntry } from '@nexnote/shared';
import { cn } from '../lib/utils';
import { CloneRemoteStep } from './CloneRemoteStep';

interface OnboardingWizardProps {
  recent: RecentVaultEntry[];
  /** vault:open/create 成功后由主进程广播 vault:changed，App 自行切换视图；这里仅刷新 recent。 */
  onRecentsChanged: () => void;
}

type Step = 'choose' | 'create' | 'clone';

/** 首启动向导：三选一（新建空 vault / 打开本地文件夹 / 克隆远程仓库占位）。 */
export function OnboardingWizard({ recent, onRecentsChanged }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('我的知识库');
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [pendingGitInitPath, setPendingGitInitPath] = useState<string | null>(null);
  const [createWithGit, setCreateWithGit] = useState(true);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [inspectResult, setInspectResult] = useState<{
    path: string;
    isObsidian: boolean;
    isGitRepo: boolean;
    entryCount: number;
  } | null>(null);

  useEffect(() => {
    if (step === 'create' && !parentDir) {
      // 进入新建步骤时预填一次目录选择
      void (async () => {
        try {
          const picked = await invoke('vault:pickDirectory');
          if (picked) setParentDir(picked);
        } catch {
          /* 用户取消或失败，保持未选择 */
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const runOpen = async (path: string) => {
    setBusy(true);
    setError(null);
    setInspectResult(null);
    setInspecting(path);
    try {
      // 先检查目录类型（是否为 Obsidian、是否已有 Git）
      const inspection = await invoke('vault:inspect', { path });
      setInspectResult({
        path: inspection.path,
        isObsidian: inspection.isObsidian,
        isGitRepo: inspection.isGitRepo,
        entryCount: inspection.entryCount,
      });
      // 已有 Git → 直接打开
      if (inspection.isGitRepo) {
        await invoke('vault:open', { path });
        return;
      }
      // 无 Git → 显示确认对话框（pendingGitInitPath 触发 UI）
      setPendingGitInitPath(path);
      setBusy(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (
        'code' in (e as object) &&
        (e as { code?: string }).code === 'GIT_INITIALIZATION_REQUIRED'
      ) {
        setPendingGitInitPath(path);
        setError(null);
      } else {
        setError(message);
      }
      setBusy(false);
    } finally {
      setInspecting(null);
    }
  };

  const confirmGitInitialization = async (): Promise<void> => {
    if (!pendingGitInitPath) return;
    setBusy(true);
    setError(null);
    try {
      await invoke('vault:open', { path: pendingGitInitPath, initGit: true });
      setPendingGitInitPath(null);
      setInspectResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const runCreate = async () => {
    if (!parentDir) {
      setError('请先选择存放位置');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await invoke('vault:create', { parentDir, name, initGit: createWithGit });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const pickAgain = async () => {
    try {
      const picked = await invoke('vault:pickDirectory');
      if (picked) setParentDir(picked);
    } catch {
      /* ignore */
    }
  };

  const removeRecent = async (path: string) => {
    try {
      await invoke('vault:removeRecent', { path });
      onRecentsChanged();
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      data-testid="onboarding"
      className="flex h-full items-center justify-center bg-background p-6"
    >
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground">
            N
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            欢迎使用 NexNote
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            本地优先的知识库：块编辑 × 双链 × Git × AI
          </p>
        </div>

        {inspecting && (
          <p
            data-testid="onboarding-inspecting"
            className="mb-4 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
          >
            <Loader2 className="size-3.5 animate-spin" />
            正在检测 {inspecting} …
          </p>
        )}

        {error && (
          <p
            data-testid="onboarding-error"
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}

        {pendingGitInitPath && (
          <section
            data-testid="git-init-confirmation"
            className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            <p className="font-medium">
              此文件夹还不是 Git 仓库
            </p>
            {inspectResult?.isObsidian && (
              <p className="mt-1 text-xs text-muted-foreground">
                检测到 Obsidian vault（.obsidian 目录）。NexNote 不会修改你的 Obsidian 配置，
                仅添加 .nexnote/ 和 .git。
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              是否在 <code className="break-all">{pendingGitInitPath}</code> 中初始化 Git？
              这会创建 .git、.gitignore 和初始提交；仅在你确认后执行。
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmGitInitialization()}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {busy ? '初始化中…' : '初始化 Git 并打开'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPendingGitInitPath(null);
                  setInspectResult(null);
                }}
                className="rounded border px-3 py-1.5 text-xs hover:bg-accent"
              >
                取消
              </button>
            </div>
          </section>
        )}

        {step === 'choose' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <OptionCard
              icon={FolderPlus}
              title="新建知识库"
              desc="创建一个空的本地 vault"
              onClick={() => setStep('create')}
            />
            <OptionCard
              icon={FolderOpen}
              title="打开本地文件夹"
              desc="选择已有文件夹作为 vault"
              disabled={busy}
              onClick={async () => {
                try {
                  const picked = await invoke('vault:pickDirectory');
                  if (picked) await runOpen(picked);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            />
            <OptionCard
              icon={CloudDownload}
              title="克隆远程仓库"
              desc="支持 GitHub/GitLab 等 HTTPS 或 SSH 仓库"
              onClick={() => setStep('clone')}
            />

            {recent.length > 0 && (
              <section className="col-span-full mt-2">
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <History className="size-3.5" />
                  最近打开
                </h2>
                <ul className="overflow-hidden rounded-lg border">
                  {recent.slice(0, 5).map((entry) => (
                    <li
                      key={entry.path}
                      className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent/40"
                    >
                      <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runOpen(entry.path)}
                        className="min-w-0 flex-1 text-left"
                        title={entry.path}
                      >
                        <span className="block truncate font-medium">{entry.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {entry.path}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`移除 ${entry.name}`}
                        title="从最近列表移除"
                        onClick={() => void removeRecent(entry.path)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {step === 'clone' && (
          <CloneRemoteStep onSuccess={() => undefined} onBack={() => setStep('choose')} />
        )}
        {step === 'create' && (
          <div className="rounded-xl border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep('choose')}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="返回"
              >
                <ArrowLeft className="size-4" />
              </button>
              <h2 className="text-sm font-semibold">新建知识库</h2>
            </div>

            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">名称</label>
            <input
              data-testid="vault-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="我的知识库"
              className="mb-4 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />

            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              存放位置
            </label>
            <div className="mb-5 flex items-center gap-2">
              <span className="flex h-9 min-w-0 flex-1 items-center truncate rounded-md border bg-muted/50 px-3 text-xs text-muted-foreground">
                {parentDir ?? '未选择'}
              </span>
              <button
                type="button"
                onClick={() => void pickAgain()}
                className="h-9 shrink-0 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
              >
                选择位置…
              </button>
            </div>

            <label className="mb-5 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={createWithGit}
                onChange={(e) => setCreateWithGit(e.target.checked)}
                className="size-3.5"
              />
              同时初始化 Git（推荐：自动版本跟踪）
            </label>

            <button
              type="button"
              data-testid="create-vault-button"
              disabled={busy || !parentDir || name.trim().length === 0}
              onClick={() => void runCreate()}
              className={cn(
                'flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground',
                'hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? '创建中…' : '创建知识库'}
            </button>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              将在所选位置创建同名文件夹与 .nexnote/ 配置目录
              {createWithGit ? '，并初始化 Git（首次提交）。' : '，暂不初始化 Git。'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function OptionCard({
  icon: Icon,
  title,
  desc,
  badge,
  disabled,
  onClick,
}: {
  icon: typeof FolderPlus;
  title: string;
  desc: string;
  badge?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'hover:border-ring/50 hover:bg-accent/40 transition-colors',
      )}
    >
      <div className="flex w-full items-center justify-between">
        <Icon className="size-5 text-muted-foreground" />
        {badge && (
          <span className="rounded-full border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {badge}
          </span>
        )}
      </div>
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs leading-relaxed text-muted-foreground">{desc}</span>
    </button>
  );
}
