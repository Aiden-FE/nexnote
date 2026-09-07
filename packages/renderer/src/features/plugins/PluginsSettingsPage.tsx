import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, PackageOpen, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import type {
  PluginAuditRecord,
  PluginInstallTicket,
  PluginPermission,
  PluginView,
} from '@nexnote/shared';
import { invoke } from '../../lib/ipc';
import { cn } from '../../lib/utils';

interface PendingInstall {
  ticket: PluginInstallTicket;
  path: string;
}

export function PluginsSettingsPage() {
  const [plugins, setPlugins] = useState<PluginView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingInstall | null>(null);
  const [audit, setAudit] = useState<PluginAuditRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revokeChallenge, setRevokeChallenge] = useState<{
    challenge: string;
    permission: PluginPermission;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke('plugins:list');
      setPlugins(list);
      setSelectedId((current) =>
        current && list.some((p) => p.id === current) ? current : (list[0]?.id ?? null),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadAudit = useCallback(async (pluginId: string) => {
    setAudit(await invoke('plugins:listAuditLog', { pluginId, limit: 50 }).catch(() => []));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadAudit(selectedId);
    }
  }, [selectedId, loadAudit]);

  const selected = plugins?.find((plugin) => plugin.id === selectedId) ?? null;

  return (
    <div className="space-y-4 text-sm" data-testid="plugins-settings">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold tracking-tight">插件</h2>
        <button
          type="button"
          onClick={() => void refresh()}
          title="刷新"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void chooseSource('directory')}
          data-testid="plugin-install-directory"
          className="ml-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
        >
          <FolderOpen className="size-3.5" />
          从文件夹安装…
        </button>
        <button
          type="button"
          onClick={() => void chooseSource('zip')}
          data-testid="plugin-install-zip"
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent"
        >
          <PackageOpen className="size-3.5" />从 zip 安装…
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {pending && (
        <div data-testid="plugin-install-preview" className="rounded-lg border bg-card p-3">
          <p className="font-medium">
            安装确认：{pending.ticket.manifest.name}{' '}
            <span className="text-xs text-muted-foreground">
              v{pending.ticket.manifest.version} · {pending.ticket.manifest.id}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {pending.ticket.manifest.description ?? '（无描述）'}
          </p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            sha256 {pending.ticket.artifactHash.slice(0, 16)}…
          </p>
          <div className="mt-2 flex items-start gap-1.5 text-xs">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium">新增能力清单</p>
              <p className="text-muted-foreground">
                {pending.ticket.requestedPermissions.length
                  ? pending.ticket.requestedPermissions.join('、')
                  : '无新增权限'}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            签名：MVP 尚未启用验证（票据 sha256 已固化内容）
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void confirm(true)}
              data-testid="plugin-install-confirm"
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
            >
              确认安装并激活
            </button>
            <button
              type="button"
              onClick={() => void confirm(false)}
              className="rounded-md border px-3 py-1.5 text-xs"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {plugins === null ? (
        <p className="text-muted-foreground">加载中…</p>
      ) : plugins.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          尚未安装插件。从本地文件夹或 zip 安装第一个插件。
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-[240px_1fr]">
          <ul className="space-y-1" data-testid="plugin-list">
            {plugins.map((plugin) => (
              <li key={plugin.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(plugin.id)}
                  className={cn(
                    'w-full rounded-md px-2.5 py-2 text-left',
                    plugin.id === selectedId ? 'bg-accent' : 'hover:bg-accent/50',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm">
                    <span className="truncate">{plugin.name}</span>
                    {plugin.builtin && (
                      <span
                        className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary"
                        data-testid="plugin-builtin-badge"
                      >
                        内置
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    v{plugin.version} · {stateLabel(plugin.state)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <div className="rounded-lg border bg-card p-3" data-testid="plugin-detail">
              <div className="flex items-center gap-2">
                <p className="font-medium">{selected.name}</p>
                <span className="text-xs text-muted-foreground">v{selected.version}</span>
                {selected.builtin && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                    内置插件
                  </span>
                )}
                <label className="ml-auto flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.state === 'active'}
                    onChange={(e) => void toggle(selected.id, e.target.checked)}
                    data-testid={`plugin-toggle-${selected.id}`}
                  />
                  启用
                </label>
                {!selected.builtin && (
                  <button
                    type="button"
                    onClick={() => void uninstall(selected.id)}
                    data-testid="plugin-uninstall"
                    title="卸载"
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              {selected.builtin && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  随应用内置的示范插件，可禁用但不可卸载；禁用后对应块类型从斜杠菜单移除，已有笔记内容保留为纯文本源码。
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {selected.description ?? '（无描述）'}
              </p>
              {selected.lastError && (
                <p className="mt-1 text-xs text-destructive">最近错误：{selected.lastError}</p>
              )}
              <p className="mt-3 text-xs font-medium">贡献点</p>
              <p className="text-xs text-muted-foreground">
                commands {selected.contributionCounts.commands} · menus{' '}
                {selected.contributionCounts.menus} · views {selected.contributionCounts.views} ·
                blockTypes {selected.contributionCounts.blockTypes}
              </p>
              <p className="mt-3 text-xs font-medium">权限</p>
              <ul className="mt-1 space-y-1">
                {selected.grants.map((grant) => (
                  <li key={grant.permission} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-[11px]">{grant.permission}</span>
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px]',
                        grant.granted
                          ? 'bg-emerald-500/15 text-emerald-600'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {grant.granted ? (grant.alwaysAllow ? '始终允许' : '已允许') : '未授权'}
                    </span>
                    {!selected.builtin && (
                      <button
                        type="button"
                        onClick={() => void prepareRevoke(selected.id, grant.permission)}
                        data-testid={`plugin-revoke-${grant.permission}`}
                        className="ml-auto text-muted-foreground hover:text-foreground hover:underline"
                      >
                        revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {revokeChallenge && (
                <div
                  className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs"
                  data-testid="plugin-revoke-challenge"
                >
                  <p>
                    确认撤销 <code>{revokeChallenge.permission}</code> 授权？
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void doRevoke()}
                      className="rounded bg-destructive px-2 py-1 text-[11px] text-destructive-foreground"
                    >
                      确认撤销
                    </button>
                    <button
                      type="button"
                      onClick={() => setRevokeChallenge(null)}
                      className="rounded border px-2 py-1 text-[11px]"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
              <p className="mt-3 text-xs font-medium">RPC 审计（最近 50 条）</p>
              <ul
                className="mt-1 max-h-40 space-y-0.5 overflow-auto font-mono text-[10px] text-muted-foreground"
                data-testid="plugin-audit"
              >
                {audit.map((record) => (
                  <li key={record.id} className={record.allowed ? '' : 'text-destructive'}>
                    {new Date(record.at).toLocaleTimeString()} {record.operation}{' '}
                    {record.permission ?? ''} {record.allowed ? '✓' : '✗'} {record.detail ?? ''}
                  </li>
                ))}
                {!audit.length && <li>（暂无记录）</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );

  async function chooseSource(source: 'directory' | 'zip'): Promise<void> {
    setError(null);
    const picked = await invoke('plugins:pickSource', { source });
    const path = picked.path;
    if (!path) return;
    try {
      const ticket = await invoke('plugins:installPreview', { source, path });
      setPending({ ticket, path });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirm(accept: boolean): Promise<void> {
    if (!pending) return;
    try {
      await invoke('plugins:confirmInstall', { ticket: pending.ticket.ticket, accept });
      setPending(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggle(pluginId: string, enabled: boolean): Promise<void> {
    await invoke('plugins:setEnabled', { pluginId, enabled }).catch((e: Error) =>
      setError(e.message),
    );
    await refresh();
    if (selectedId) await loadAudit(selectedId);
  }

  async function uninstall(pluginId: string): Promise<void> {
    await invoke('plugins:uninstall', { pluginId }).catch((e: Error) => setError(e.message));
    setSelectedId(null);
    setRevokeChallenge(null);
    await refresh();
  }

  async function prepareRevoke(pluginId: string, permission: PluginPermission): Promise<void> {
    setRevokeChallenge({ challenge: pluginId, permission });
  }

  async function doRevoke(): Promise<void> {
    if (!revokeChallenge) return;
    try {
      await invoke('plugins:revokePermission', {
        pluginId: revokeChallenge.challenge,
        permission: revokeChallenge.permission,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setRevokeChallenge(null);
    await refresh();
    if (selectedId) await loadAudit(selectedId);
  }
}

function stateLabel(state: PluginView['state']): string {
  return state === 'active'
    ? '已激活'
    : state === 'loaded'
      ? '已加载'
      : state === 'disabled'
        ? '已停用'
        : '已崩溃';
}
