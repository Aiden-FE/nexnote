/**
 * DEV-007 配套：克隆远程仓库向导（仅作为 OnboardingWizard 的内联组件），
 * 把原"即将推出"占位卡片换为可执行的三步流程。
 */
import { useRef, useState } from 'react';
import { ArrowLeft, CloudDownload, Loader2 } from 'lucide-react';
import { invoke } from '../lib/ipc';

interface CloneStepProps {
  onSuccess(): void;
  onBack(): void;
}

export function CloneRemoteStep({ onSuccess, onBack }: CloneStepProps) {
  const [url, setUrl] = useState('https://github.com/');
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // generation guard: discard late results after the user navigated away mid-clone.
  const runGen = useRef(0);

  const pickTarget = async (): Promise<void> => {
    const gen = runGen.current;
    try {
      const dir = await invoke('vault:pickDirectory');
      if (gen === runGen.current && dir) setTarget(dir);
    } catch (e) {
      if (gen === runGen.current) setError(e instanceof Error ? e.message : String(e));
    }
  };

  const run = async (): Promise<void> => {
    if (!url.trim() || !target) return;
    setBusy(true);
    setError(null);
    const gen = ++runGen.current;
    try {
      // 预检查远端可达性，获取一次性授权 token（sender 绑定 + TTL）
      const preflight = await invoke('vault:clonePreflight', {
        url: url.trim(),
        parentDir: target,
      });
      if (gen !== runGen.current) return;
      if (!preflight.reachable || !preflight.preflightToken) {
        throw new Error(preflight.error ?? '远端不可达');
      }
      await invoke('vault:clone', {
        url: url.trim(),
        parentDir: target,
        preflightToken: preflight.preflightToken,
      });
      if (gen === runGen.current) onSuccess();
    } catch (e) {
      if (gen !== runGen.current) return; // user already navigated away
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            runGen.current += 1; // invalidate any in-flight picker/clone before navigating
            onBack();
          }}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="返回"
        >
          <ArrowLeft className="size-4" />
        </button>
        <CloudDownload className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">克隆远程仓库</h2>
      </div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        远程地址（HTTPS 或 SSH）
      </label>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://github.com/owner/repo.git"
        className="mb-4 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
      />
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">克隆到…</label>
      <div className="mb-5 flex items-center gap-2">
        <span className="flex h-9 min-w-0 flex-1 items-center truncate rounded-md border bg-muted/50 px-3 text-xs text-muted-foreground">
          {target ?? '未选择'}
        </span>
        <button
          type="button"
          onClick={() => void pickTarget()}
          className="h-9 shrink-0 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
        >
          选择位置…
        </button>
      </div>
      {error && (
        <p
          data-testid="onboarding-error"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy || !url.trim() || !target}
        onClick={() => void run()}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? '克隆中…' : '克隆并打开'}
      </button>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        首次绑定远程时会执行 <code className="rounded bg-muted px-1">git ls-remote</code> 授权预检；
        请确保 SSH key / HTTPS 凭证已就绪。
      </p>
    </div>
  );
}
