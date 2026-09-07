import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  PluginAuditRecord,
  PluginAuthChallenge,
  PluginCommandView,
  PluginContributionKind,
  PluginContributionView,
  PluginInstallTicket,
  PluginManifest,
  PluginPermission,
  PluginPermissionGrant,
  PluginRpcRequest,
  PluginRpcResponse,
  PluginSessionToken,
  PluginView,
  PluginSkillContribution,
  SkillParams,
} from '@nexnote/shared';
import { PLUGIN_API_VERSION } from '@nexnote/shared';
import { AuthorizationManager } from './authorization';
import {
  assertStageUnchanged,
  stageArtifact,
  toInstallTicket,
} from './artifact-intake';
import {
  assertHostCompatible,
  CONTRIBUTION_KINDS,
  PERMISSIONS,
  validateManifest,
} from './manifest-validator';

const DEFAULT_GRANTED: readonly PluginPermission[] = ['read', 'edit'];
const MANIFEST_FILE = 'manifest.json';
const MAX_AUDIT = 300;
const MAX_PLUGIN_SOURCE_BYTES = 1_048_576;

export class PluginError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PluginError';
  }
}

interface GrantState {
  granted: boolean;
  alwaysAllow: boolean;
}

interface InstalledPlugin {
  manifest: PluginManifest;
  /** 已固化的 staging 目录（只读快照）。 */
  source: { type: 'directory' | 'zip'; path: string };
  enabled: boolean;
  grants: Map<PluginPermission, GrantState>;
  state: PluginView['state'];
  lastError?: string;
  commands: Map<string, PluginCommandView>;
  lifecycle: { initialized: boolean; active: boolean };
  /** confirm 时固化的入口源码；runtime 不再重读可变路径。 */
  approvedSource?: string;
}

interface PersistedPlugin {
  source: { type: 'directory' | 'zip'; path: string };
  enabled: boolean;
  grants: Record<string, GrantState>;
}

interface PersistedState {
  version: 1;
  plugins: PersistedPlugin[];
}

interface StageCache {
  manifest: PluginManifest;
  artifactHash: string;
  stagingPath: string;
  source: 'directory' | 'zip';
  mainRel: string;
  requestedPermissions: PluginPermission[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contributionCounts(manifest: PluginManifest): Record<PluginContributionKind, number> {
  return Object.fromEntries(
    CONTRIBUTION_KINDS.map((kind) => [kind, manifest.contributions?.[kind]?.length ?? 0]),
  ) as Record<PluginContributionKind, number>;
}

export interface PluginServiceOptions {
  stateFile?: string;
  pluginsRoot?: string;
  hostVersion?: string;
}

export class PluginService {
  private readonly plugins = new Map<string, InstalledPlugin>();
  private readonly audit: PluginAuditRecord[] = [];
  private readonly stateFile: string;
  private readonly pluginsRoot: string;
  private readonly hostVersion: string;
  private readonly auth: AuthorizationManager;
  private readonly tickets = new Map<string, StageCache>();
  revision = 0;
  private seq = 0;

  constructor(options: PluginServiceOptions = {}) {
    this.stateFile = options.stateFile ?? '';
    this.pluginsRoot = options.pluginsRoot ?? '';
    this.hostVersion = options.hostVersion ?? '0.1.0';
    this.auth = new AuthorizationManager();
    if (this.pluginsRoot && !existsSync(this.pluginsRoot)) {
      mkdirSync(this.pluginsRoot, { recursive: true });
    }
    this.restore();
  }

  list(): PluginView[] {
    return [...this.plugins.values()].map((plugin) => this.toView(plugin));
  }

  get(pluginId: string): PluginView | null {
    const plugin = this.plugins.get(pluginId);
    return plugin ? this.toView(plugin) : null;
  }

  listCommands(): PluginCommandView[] {
    return [...this.plugins.values()].flatMap((plugin) => [...plugin.commands.values()]);
  }

  listContributions(): PluginContributionView[] {
    return [...this.plugins.values()]
      .filter((plugin) => plugin.state === 'active')
      .flatMap((plugin) =>
        CONTRIBUTION_KINDS.flatMap((kind) =>
          (plugin.manifest.contributions?.[kind] ?? []).map((entry) => ({
            ...entry,
            scopedId: `${plugin.manifest.id}:${entry.id}`,
            pluginId: plugin.manifest.id,
            kind,
          })),
        ),
      );
  }

  listAudit(pluginId?: string): PluginAuditRecord[] {
    return pluginId ? this.audit.filter((r) => r.pluginId === pluginId) : [...this.audit];
  }

  /** DEV-014：活跃插件声明的检索 Skill（受约束的参数化策略，由宿主安全执行）。 */
  listPluginSkillContributions(): Array<{
    id: string;
    name: string;
    description?: string;
    pluginId: string;
    params?: SkillParams;
  }> {
    return [...this.plugins.values()]
      .filter((plugin) => plugin.state === 'active')
      .flatMap((plugin) =>
        (plugin.manifest.skills ?? []).map((skill: PluginSkillContribution) => ({
          id: `${plugin.manifest.id}:${skill.id}`,
          name: skill.name ?? skill.id,
          ...(skill.description ? { description: skill.description } : {}),
          pluginId: plugin.manifest.id,
          params: skill.params as SkillParams | undefined,
        })),
      );
  }

  previewInstall(source: 'directory' | 'zip', path: string): PluginInstallTicket {
    if (!this.pluginsRoot) throw new PluginError('缺少 pluginsRoot，无法执行 preview', 'NO_ROOT');
    const stage = stageArtifact(source, path, this.pluginsRoot);
    assertHostCompatible(stage.manifest, this.hostVersion);
    this.tickets.set(stage.ticket, {
      manifest: stage.manifest,
      artifactHash: stage.artifactHash,
      stagingPath: stage.stagingPath,
      source: stage.source,
      mainRel: stage.mainRel,
      requestedPermissions: stage.requestedPermissions,
    });
    const existing = this.plugins.get(stage.manifest.id)?.manifest;
    this.record(stage.manifest.id, 'install.preview', true, undefined, 'previewed');
    return toInstallTicket(stage, existing);
  }

  confirmInstall(ticket: string, accept: boolean): PluginView {
    const stage = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!stage) throw new PluginError('安装票据已过期或不存在', 'TICKET_NOT_FOUND');
    if (!accept) {
      this.record(stage.manifest.id, 'install.reject', false, undefined, 'user declined');
      rmSync(stage.stagingPath, { recursive: true, force: true });
      throw new PluginError('用户未确认安装', 'INSTALL_NOT_ACCEPTED');
    }
    const approvedSource = assertStageUnchanged(stage).toString('utf8');
    return this.activateFromStage(stage, approvedSource);
  }

  uninstall(pluginId: string): void {
    const plugin = this.require(pluginId);
    this.auth.revokeAllForPlugin(pluginId);
    this.deactivate(plugin);
    this.unload(plugin);
    this.plugins.delete(pluginId);
    rmSync(plugin.source.path, { recursive: true, force: true });
    this.record(pluginId, 'install.uninstall', true);
    this.persist();
  }

  setEnabled(pluginId: string, enabled: boolean): PluginView {
    const plugin = this.require(pluginId);
    if (plugin.state === 'crashed') {
      throw new PluginError('已崩溃的插件需要先卸载再重装', 'PLUGIN_CRASHED');
    }
    plugin.enabled = enabled;
    if (enabled) this.activate(plugin);
    else {
      this.auth.revokeAllForPlugin(pluginId);
      this.deactivate(plugin);
    }
    this.persist();
    return this.toView(plugin);
  }

  beginAuthChallenge(
    sessionId: string,
    token: string,
    request: PluginRpcRequest,
  ): PluginAuthChallenge {
    const session = this.auth.verifySession(sessionId, token);
    const plugin = this.require(session.pluginId);
    if (!plugin.enabled) throw new PluginError('插件未启用', 'PLUGIN_DISABLED');
    if (plugin.state !== 'active') throw new PluginError('插件未激活', 'PLUGIN_NOT_ACTIVE');
    return this.auth.beginChallenge(sessionId, token, session.pluginId, request);
  }

  grantWithChallenge(
    challenge: string,
    sessionId: string,
    token: string,
    requestId: string,
    alwaysAllow: boolean,
  ): PluginView {
    const record = this.auth.consumeChallenge(challenge, {
      expectedSessionId: sessionId,
      expectedRequestId: requestId,
      token,
    });
    const plugin = this.require(record.pluginId);
    plugin.grants.set(record.permission, { granted: true, alwaysAllow });
    this.record(
      plugin.manifest.id,
      'permission.grant',
      true,
      record.permission,
      alwaysAllow ? 'always-allow' : 'one-shot',
    );
    this.persist();
    return this.toView(plugin);
  }

  revokePermission(pluginId: string, permission: PluginPermission): PluginView {
    const plugin = this.require(pluginId);
    if (!plugin.manifest.permissions.includes(permission)) {
      throw new PluginError('权限未在 manifest 中声明', 'PERMISSION_UNDECLARED');
    }
    plugin.grants.set(permission, { granted: false, alwaysAllow: false });
    this.record(plugin.manifest.id, 'permission.revoke', true, permission);
    this.persist();
    return this.toView(plugin);
  }

  rejectAuthChallenge(challenge: string, reason?: string): void {
    this.auth.rejectChallenge(challenge);
    this.record('?', 'permission.reject', false, undefined, reason);
  }

  beginSession(pluginId: string, nonce: string, origin: string): PluginSessionToken {
    const plugin = this.require(pluginId);
    if (!plugin.enabled) throw new PluginError('插件未启用', 'PLUGIN_DISABLED');
    if (plugin.state !== 'active') throw new PluginError('插件未激活', 'PLUGIN_NOT_ACTIVE');
    return this.auth.beginSession(pluginId, nonce, origin);
  }

  closeSession(sessionId: string, token: string): void {
    this.auth.verifySession(sessionId, token);
    this.auth.revokeSession(sessionId);
  }

  runtimeSourceForSession(
    sessionId: string,
    token: string,
    pluginId: string,
  ): { pluginId: string; source: string } {
    this.auth.verifySession(sessionId, token, pluginId);
    const plugin = this.require(pluginId);
    if (plugin.state !== 'active') throw new PluginError('插件未激活', 'PLUGIN_NOT_ACTIVE');
    return { pluginId, source: this.readSource(plugin) };
  }

  reportCrashForSession(
    sessionId: string,
    token: string,
    pluginId: string,
    message: string,
  ): PluginView {
    const session = this.auth.verifySession(sessionId, token, pluginId);
    const plugin = this.require(pluginId);
    plugin.state = 'crashed';
    plugin.enabled = false;
    plugin.lastError = message.slice(0, 500);
    this.deactivate(plugin);
    this.record(pluginId, 'runtime.crash', false, undefined, plugin.lastError);
    this.auth.revokeSession(session.sessionId);
    this.persist();
    return this.toView(plugin);
  }

  runCommand(pluginId: string, commandId: string, payload: unknown): unknown {
    const plugin = this.require(pluginId);
    if (plugin.state !== 'active') throw new PluginError('插件未激活', 'PLUGIN_NOT_ACTIVE');
    this.record(pluginId, 'command.run', true, undefined, commandId);
    return { pluginId, commandId, payload };
  }

  handleRpc(sessionId: string, token: string, request: PluginRpcRequest): PluginRpcResponse {
    return this.respond(request, () => this.dispatchRpc(sessionId, token, request));
  }

  private dispatchRpc(sessionId: string, token: string, request: PluginRpcRequest): unknown {
    const session = this.auth.verifySession(sessionId, token);
    const plugin = this.require(session.pluginId);
    if (plugin.state !== 'active') throw new PluginError('插件未激活', 'PLUGIN_NOT_ACTIVE');
    if (request.apiVersion !== PLUGIN_API_VERSION) {
      throw new PluginError(`插件 API 版本不兼容（需要 ${PLUGIN_API_VERSION}）`, 'API_VERSION_MISMATCH');
    }
    switch (request.method) {
      case 'command.register': {
        this.requirePermission(plugin, 'read', request.method);
        const params = request.params as { id?: unknown; title?: unknown; keywords?: unknown };
        if (typeof params?.id !== 'string' || typeof params?.title !== 'string') {
          throw new PluginError('command.register 参数无效', 'BAD_RPC_PARAMS');
        }
        const id = `${plugin.manifest.id}:${params.id}`;
        plugin.commands.set(id, {
          id,
          pluginId: plugin.manifest.id,
          title: params.title,
          ...(Array.isArray(params.keywords)
            ? { keywords: params.keywords.filter((k): k is string => typeof k === 'string') }
            : {}),
        });
        this.persist();
        return { id };
      }
      case 'transact': {
        this.requirePermission(plugin, 'edit', request.method);
        const params = request.params as { expectedRevision?: unknown; intent?: unknown };
        if (
          !isRecord(params.intent) ||
          typeof params.intent.type !== 'string' ||
          !Number.isInteger(params.expectedRevision)
        ) {
          throw new PluginError('transact 参数无效', 'BAD_RPC_PARAMS');
        }
        if (params.expectedRevision !== this.revision) {
          throw new PluginError('文档 revision 已变化，请重新读取后重试', 'REVISION_CONFLICT');
        }
        this.revision += 1;
        return { revision: this.revision };
      }
      case 'capability.call': {
        const params = request.params as { permission?: unknown; operation?: unknown };
        const permission = params.permission as PluginPermission;
        if (!PERMISSIONS.includes(permission) || typeof params.operation !== 'string') {
          throw new PluginError('capability.call 参数无效', 'BAD_RPC_PARAMS');
        }
        this.requirePermission(plugin, permission, params.operation);
        this.consumeOneShotGrant(plugin, permission);
        throw new PluginError(`能力尚未实现: ${params.operation}`, 'NOT_IMPLEMENTED');
      }
      case 'permission.request': {
        const params = request.params as { permission?: unknown };
        const permission = params.permission as PluginPermission;
        if (!PERMISSIONS.includes(permission)) throw new PluginError('请求了未知权限', 'BAD_RPC_PARAMS');
        if (!plugin.manifest.permissions.includes(permission)) {
          this.record(plugin.manifest.id, 'permission.request', false, permission, 'manifest 未声明');
          throw new PluginError('权限未在 manifest 中声明', 'PERMISSION_UNDECLARED');
        }
        const state = plugin.grants.get(permission);
        this.record(plugin.manifest.id, 'permission.request', state?.granted === true, permission);
        if (state?.granted !== true) {
          throw new PluginError(`需要用户授权 ${permission}`, 'PERMISSION_REQUIRED');
        }
        return { granted: true, alwaysAllow: state.alwaysAllow };
      }
      default:
        throw new PluginError(`未知 RPC 方法: ${String(request.method)}`, 'UNKNOWN_METHOD');
    }
  }

  private activateFromStage(stage: StageCache, approvedSource: string): PluginView {
    const existing = this.plugins.get(stage.manifest.id);
    this.auth.revokeAllForPlugin(stage.manifest.id);
    const previous: InstalledPlugin =
      existing ?? this.emptyPlugin(stage.manifest, { type: stage.source, path: stage.stagingPath });
    previous.manifest = stage.manifest;
    previous.source = { type: stage.source, path: stage.stagingPath };
    previous.approvedSource = approvedSource;
    previous.lifecycle = { initialized: false, active: false };
    previous.state = 'loaded';
    this.plugins.set(stage.manifest.id, previous);
    this.initialize(previous);
    previous.enabled = true;
    this.activate(previous);
    this.record(previous.manifest.id, 'install.confirm', true, undefined, stage.artifactHash.slice(0, 16));
    this.persist();
    return this.toView(previous);
  }

  private emptyPlugin(
    manifest: PluginManifest,
    source: { type: 'directory' | 'zip'; path: string },
  ): InstalledPlugin {
    const grants = new Map<PluginPermission, GrantState>(
      manifest.permissions.map((permission) => [
        permission,
        { granted: DEFAULT_GRANTED.includes(permission), alwaysAllow: false },
      ]),
    );
    return {
      manifest,
      source,
      enabled: false,
      grants,
      state: 'loaded',
      commands: new Map(),
      lifecycle: { initialized: false, active: false },
    };
  }

  private require(pluginId: string): InstalledPlugin {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new PluginError(`插件不存在: ${pluginId}`, 'PLUGIN_NOT_FOUND');
    return plugin;
  }

  private requirePermission(plugin: InstalledPlugin, permission: PluginPermission, operation: string): void {
    if (!plugin.manifest.permissions.includes(permission)) {
      this.record(plugin.manifest.id, 'permission.request', false, permission, 'undeclared');
      throw new PluginError(`权限未在 manifest 中声明: ${permission}`, 'PERMISSION_UNDECLARED');
    }
    const state = plugin.grants.get(permission);
    if (state?.granted !== true) {
      this.record(plugin.manifest.id, 'permission.request', false, permission, operation);
      throw new PluginError(`需要用户授权 ${permission}`, 'PERMISSION_REQUIRED');
    }
    this.record(plugin.manifest.id, 'permission.request', true, permission, operation);
  }

  private consumeOneShotGrant(plugin: InstalledPlugin, permission: PluginPermission): void {
    const state = plugin.grants.get(permission);
    if (!state?.granted || state.alwaysAllow) return;
    plugin.grants.set(permission, { granted: false, alwaysAllow: false });
    this.record(plugin.manifest.id, 'permission.consume', true, permission, 'one-shot');
    this.persist();
  }

  private initialize(plugin: InstalledPlugin): void {
    if (plugin.lifecycle.initialized) return;
    try {
      this.readSource(plugin);
      plugin.lifecycle.initialized = true;
      this.record(plugin.manifest.id, 'lifecycle.initialize', true);
    } catch (error) {
      plugin.state = 'crashed';
      plugin.lastError = (error as Error).message.slice(0, 500);
      this.record(plugin.manifest.id, 'lifecycle.initialize', false, undefined, plugin.lastError);
      throw new PluginError(plugin.lastError ?? 'initialize failed', 'PLUGIN_CRASHED');
    }
  }

  private activate(plugin: InstalledPlugin): void {
    if (!plugin.enabled || plugin.lifecycle.active) return;
    this.initialize(plugin);
    plugin.commands.clear();
    for (const contribution of plugin.manifest.contributions?.commands ?? []) {
      const id = `${plugin.manifest.id}:${contribution.id}`;
      plugin.commands.set(id, { ...contribution, id, pluginId: plugin.manifest.id });
    }
    plugin.state = 'active';
    plugin.lifecycle.active = true;
    this.record(plugin.manifest.id, 'lifecycle.activate', true);
  }

  private deactivate(plugin: InstalledPlugin): void {
    if (!plugin.lifecycle.active) return;
    plugin.commands.clear();
    plugin.lifecycle.active = false;
    if (plugin.state !== 'crashed') plugin.state = 'disabled';
    this.record(plugin.manifest.id, 'lifecycle.deactivate', true);
  }

  private unload(plugin: InstalledPlugin): void {
    this.deactivate(plugin);
    if (!plugin.lifecycle.initialized) return;
    plugin.lifecycle.initialized = false;
    this.record(plugin.manifest.id, 'lifecycle.unload', true);
  }

  private readSource(plugin: InstalledPlugin): string {
    const source = plugin.approvedSource ?? readFileSync(join(plugin.source.path, plugin.manifest.main), 'utf8');
    if (source.length > MAX_PLUGIN_SOURCE_BYTES) {
      throw new PluginError('插件入口超过 1 MiB 资源限制', 'PLUGIN_RESOURCE_LIMIT');
    }
    return source;
  }

  private record(
    pluginId: string,
    operation: string,
    allowed: boolean,
    permission?: PluginPermission,
    detail?: string,
  ): void {
    this.audit.unshift({
      id: `audit-${++this.seq}`,
      pluginId,
      operation,
      permission,
      allowed,
      detail,
      at: Date.now(),
    });
    if (this.audit.length > MAX_AUDIT) this.audit.length = MAX_AUDIT;
  }

  private respond(request: PluginRpcRequest, body: () => unknown): PluginRpcResponse {
    try {
      return { apiVersion: PLUGIN_API_VERSION, id: request.id, ok: true, data: body() };
    } catch (error) {
      const err = error as { code?: string; message?: string };
      return {
        apiVersion: PLUGIN_API_VERSION,
        id: request.id,
        ok: false,
        error: { code: err.code ?? 'PLUGIN_ERROR', message: (err.message ?? String(error)).slice(0, 500) },
      };
    }
  }

  private toView(plugin: InstalledPlugin): PluginView {
    const grants: PluginPermissionGrant[] = plugin.manifest.permissions.map((permission) => {
      const state = plugin.grants.get(permission);
      return {
        permission,
        granted: state?.granted === true,
        alwaysAllow: state?.alwaysAllow === true,
      };
    });
    return {
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      ...(plugin.manifest.description ? { description: plugin.manifest.description } : {}),
      state: plugin.state,
      permissions: plugin.manifest.permissions,
      grants,
      contributionCounts: contributionCounts(plugin.manifest),
      ...(plugin.lastError ? { lastError: plugin.lastError } : {}),
    };
  }

  private persist(): void {
    if (!this.stateFile) return;
    const persisted: PersistedState = {
      version: 1,
      plugins: [...this.plugins.values()].map((plugin) => ({
        source: plugin.source,
        enabled: plugin.enabled,
        grants: Object.fromEntries(plugin.grants),
      })),
    };
    writeFileSync(this.stateFile, JSON.stringify(persisted, null, 2));
  }

  private restore(): void {
    if (!this.stateFile || !existsSync(this.stateFile)) return;
    try {
      const data = JSON.parse(readFileSync(this.stateFile, 'utf8')) as PersistedState;
      if (data.version !== 1) return;
      for (const saved of data.plugins) {
        if (!existsSync(saved.source.path)) continue;
        const manifest = this.loadManifestFromSource(saved.source.path);
        assertHostCompatible(manifest, this.hostVersion);
        const plugin: InstalledPlugin = {
          manifest,
          source: saved.source,
          enabled: saved.enabled,
          grants: new Map(Object.entries(saved.grants) as [PluginPermission, GrantState][]),
          state: 'loaded',
          commands: new Map(),
          lifecycle: { initialized: false, active: false },
        };
        this.plugins.set(manifest.id, plugin);
        if (plugin.enabled) this.activate(plugin);
      }
    } catch {
      // 损坏的状态文件视为空
    }
  }

  private loadManifestFromSource(stagingPath: string): PluginManifest {
    return validateManifest(JSON.parse(readFileSync(join(stagingPath, MANIFEST_FILE), 'utf8')));
  }
}
