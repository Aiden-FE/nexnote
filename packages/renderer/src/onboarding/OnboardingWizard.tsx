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

interface OnboardingWizardProps {
  recent: RecentVaultEntry[];
  /** vault:open/create 成功后由主进程广播 vault:changed，App 自行切换视图；这里仅刷新 recent。 */
  onRecentsChanged: () => void;
}

type Step = 'choose' | 'create';

/** 首启动向导：三选一（新建空 vault / 打开本地文件夹 / 克隆远程仓库占位）。 */
export function OnboardingWizard({ recent, onRecentsChanged }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('我的知识库');
  const [parentDir, setParentDir] = useState<string | null>(null);

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
    try {
      await invoke('vault:open', { path });
      // 成功后主进程广播 vault:changed → App 切到工作区
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
      await invoke('vault:create', { parentDir, name });
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

        {error && (
          <p
            data-testid="onboarding-error"
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
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
              desc="DEV-007 提供克隆能力"
              badge="即将推出"
              disabled
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
              将在所选位置创建同名文件夹与 .nexnote/ 配置目录；Git 初始化（自动 git init +
              首次提交）由 DEV-007 接入。
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
