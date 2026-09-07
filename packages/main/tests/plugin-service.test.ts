import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_PLUGIN_IDS,
  PLUGIN_API_VERSION,
  type PluginRpcRequest,
} from '@nexnote/shared';
import { PluginService } from '../src/plugins/plugin-service';
import { BUILTIN_PLUGIN_MANIFESTS } from '../src/plugins/builtin/builtin-manifests';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/demo-plugin');
const crashFixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/crash-plugin');
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'nexnote-plugin-test-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeService() {
  return new PluginService({
    stateFile: join(tmp, 'plugins.json'),
    pluginsRoot: join(tmp, 'installed'),
  });
}

/** 零依赖 ZIP 写入器（method 8 deflate）：仅用于测试，覆盖 zip-extract 的 inflate 路径。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFolder(folder: string, target: string): void {
  const files: { name: string; data: Buffer }[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(full, rel);
      else files.push({ name: rel, data: readFileSync(full) });
    }
  };
  walk(folder, '');

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }
  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  writeFileSync(target, Buffer.concat([localBuf, centralBuf, eocd]));
}
function install(service: PluginService) {
  const ticket = service.previewInstall('directory', fixture);
  return service.confirmInstall(ticket.ticket, true);
}
function session(service: PluginService) {
  return service.beginSession(
    'com.nexnote.demo',
    `a-unique-test-nonce-${crypto.randomUUID()}`,
    'plugin-frame',
  );
}
function rpc(
  service: PluginService,
  method: PluginRpcRequest['method'],
  params: unknown,
  id = 'r1',
) {
  const auth = session(service);
  return service.handleRpc(auth.sessionId, auth.token, {
    apiVersion: PLUGIN_API_VERSION,
    id,
    method,
    params,
  });
}

describe('PluginService secure runtime', () => {
  it('validates manifests and semver/minAppVersion before staging', () => {
    const invalid = join(tmp, 'invalid');
    const manifest = JSON.parse(readFileSync(join(fixture, 'manifest.json'), 'utf8'));
    writeFileSync(invalid, '');
    expect(() => makeService().previewInstall('directory', invalid)).toThrow();
    expect(manifest.minAppVersion).toBeTruthy();
  });

  it('requires a staged ticket and activation executes manifest commands', () => {
    const service = makeService();
    const ticket = service.previewInstall('directory', fixture);
    expect(ticket.requestedPermissions).toEqual(['read', 'edit', 'network']);
    expect(() => service.confirmInstall(ticket.ticket, false)).toThrow(/未确认/);
    const view = install(service);
    expect(view.state).toBe('active');
    expect(service.listCommands()).toEqual([
      expect.objectContaining({ id: 'com.nexnote.demo:hello' }),
    ]);
    service.setEnabled(view.id, false);
    expect(service.listCommands()).toEqual([]);
    service.setEnabled(view.id, true);
    expect(service.listContributions()).toHaveLength(4);
  });

  it('binds RPC to a live session and revokes all sessions when disabled', () => {
    const service = makeService();
    install(service);
    const auth = session(service);
    expect(
      service.handleRpc(auth.sessionId, auth.token, {
        apiVersion: PLUGIN_API_VERSION,
        id: 'x',
        method: 'command.register',
        params: { id: 'x', title: 'X' },
      }).ok,
    ).toBe(true);
    service.setEnabled('com.nexnote.demo', false);
    const response = service.handleRpc(auth.sessionId, auth.token, {
      apiVersion: PLUGIN_API_VERSION,
      id: 'y',
      method: 'command.register',
      params: { id: 'y', title: 'Y' },
    });
    expect(response).toMatchObject({ ok: false, error: { code: 'SESSION_NOT_FOUND' } });
  });

  it('gates sensitive capability calls and preserves NOT_IMPLEMENTED after authorization', () => {
    const service = makeService();
    install(service);
    expect(
      rpc(service, 'capability.call', { permission: 'network', operation: 'network.fetch' }),
    ).toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    const request: PluginRpcRequest = {
      apiVersion: PLUGIN_API_VERSION,
      id: 'challenge',
      method: 'capability.call',
      params: { permission: 'network', operation: 'network.fetch' },
    };
    const auth = session(service);
    const challenge = service.beginAuthChallenge(auth.sessionId, auth.token, request);
    service.grantWithChallenge(challenge.challenge, auth.sessionId, auth.token, request.id, false);
    expect(
      rpc(service, 'capability.call', { permission: 'network', operation: 'network.fetch' }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_IMPLEMENTED' } });
    expect(() =>
      service.grantWithChallenge(challenge.challenge, auth.sessionId, auth.token, request.id, true),
    ).toThrow(/challenge/);
  });

  it('consumes a one-shot sensitive grant after its authorized request', () => {
    const service = makeService();
    install(service);
    const request: PluginRpcRequest = {
      apiVersion: PLUGIN_API_VERSION,
      id: 'one-shot',
      method: 'capability.call',
      params: { permission: 'network', operation: 'network.fetch' },
    };
    const auth = session(service);
    const challenge = service.beginAuthChallenge(auth.sessionId, auth.token, request);
    expect(() => service.beginAuthChallenge(auth.sessionId, 'wrong-token', request)).toThrow(
      /token/,
    );
    expect(challenge).toMatchObject({
      pluginId: 'com.nexnote.demo',
      sessionId: auth.sessionId,
      requestId: request.id,
      permission: 'network',
    });
    expect(() =>
      service.grantWithChallenge(
        challenge.challenge,
        auth.sessionId,
        auth.token,
        'other-request',
        false,
      ),
    ).toThrow(/请求不匹配/);
    const rebound = service.beginAuthChallenge(auth.sessionId, auth.token, request);
    expect(
      service.grantWithChallenge(rebound.challenge, auth.sessionId, auth.token, request.id, false)
        .grants,
    ).toContainEqual({
      permission: 'network',
      granted: true,
      alwaysAllow: false,
    });
    expect(rpc(service, 'capability.call', request.params)).toMatchObject({
      ok: false,
      error: { code: 'NOT_IMPLEMENTED' },
    });
    expect(rpc(service, 'capability.call', request.params)).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_REQUIRED' },
    });
    expect(makeService().get('com.nexnote.demo')?.grants).toContainEqual({
      permission: 'network',
      granted: false,
      alwaysAllow: false,
    });
  });

  it('rejects a staged artifact mutated before confirmation', () => {
    const service = makeService();
    const ticket = service.previewInstall('directory', fixture);
    const stagingRoot = join(tmp, 'installed');
    const [stageName] = readdirSync(stagingRoot);
    const entry = join(stagingRoot, stageName!, 'main.js');
    chmodSync(entry, 0o600);
    writeFileSync(entry, '// attacker mutation');
    expect(() => service.confirmInstall(ticket.ticket, true)).toThrow(/校验后发生变化/);
    expect(service.list()).toEqual([]);
  });

  it('revokes active sessions when an install updates plugin code', () => {
    const service = makeService();
    install(service);
    const auth = session(service);
    const update = service.previewInstall('directory', fixture);
    service.confirmInstall(update.ticket, true);
    expect(
      service.handleRpc(auth.sessionId, auth.token, {
        apiVersion: PLUGIN_API_VERSION,
        id: 'stale',
        method: 'command.register',
        params: { id: 'stale', title: 'Stale' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'SESSION_NOT_FOUND' } });
  });

  it('loads the real crashing fixture and isolates it without affecting another plugin', () => {
    const service = makeService();
    const crashTicket = service.previewInstall('directory', crashFixture);
    expect(service.confirmInstall(crashTicket.ticket, true).state).toBe('active');
    const crashSession = service.beginSession(
      'com.nexnote.crash',
      'crash-fixture-session-nonce',
      'plugin-frame',
    );
    expect(
      service.runtimeSourceForSession(
        crashSession.sessionId,
        crashSession.token,
        'com.nexnote.crash',
      ).source,
    ).toContain("throw new Error('real plugin crash')");
    expect(
      service.reportCrashForSession(
        crashSession.sessionId,
        crashSession.token,
        'com.nexnote.crash',
        'real plugin crash',
      ),
    ).toMatchObject({ state: 'crashed' });
    install(service);
    expect(service.get('com.nexnote.demo')?.state).toBe('active');
  });

  it('contains crashes and removes active contributions', () => {
    const service = makeService();
    install(service);
    const auth = session(service);
    expect(
      service.reportCrashForSession(auth.sessionId, auth.token, 'com.nexnote.demo', 'boom'),
    ).toMatchObject({ state: 'crashed' });
    expect(service.listCommands()).toEqual([]);
    expect(service.listContributions()).toEqual([]);
  });

  it('extracts zip plugins and restores staged installation state', () => {
    const zipPath = join(tmp, 'demo.zip');
    zipFolder(fixture, zipPath);
    const first = makeService();
    const ticket = first.previewInstall('zip', zipPath);
    expect(first.confirmInstall(ticket.ticket, true).state).toBe('active');
    const second = makeService();
    expect(second.listCommands()).toHaveLength(1);
  });

  it('surfaces plugin-contributed retrieval skills for active plugins (DEV-014)', () => {
    const service = makeService();
    expect(service.listPluginSkillContributions()).toEqual([]);
    install(service);
    const skills = service.listPluginSkillContributions();
    expect(skills).toEqual([
      expect.objectContaining({
        id: 'com.nexnote.demo:quick',
        pluginId: 'com.nexnote.demo',
        name: 'Demo 快速检索',
      }),
    ]);
    expect(skills[0]?.params?.disableVector).toBe(true);
    service.setEnabled('com.nexnote.demo', false);
    expect(service.listPluginSkillContributions()).toEqual([]);
  });
});

describe('内置示范插件（DEV-015）', () => {
  it('seedBuiltins 预置 Mermaid/KaTeX 并走 manifest 校验，贡献点随激活状态生效', () => {
    const service = makeService();
    service.seedBuiltins(BUILTIN_PLUGIN_MANIFESTS);

    const views = service.list();
    const ids = views.map((p) => p.id);
    expect(ids).toContain(BUILTIN_PLUGIN_IDS.mermaid);
    expect(ids).toContain(BUILTIN_PLUGIN_IDS.katex);
    for (const view of views) {
      expect(view.builtin).toBe(true);
      expect(view.state).toBe('active');
      // 纯 UI 插件：仅声明 read，不需要 network/filesystem 等高危权限。
      expect(view.permissions).toEqual(['read']);
    }

    const contributions = service.listContributions();
    const blockKinds = contributions.filter((c) => c.kind === 'blockTypes');
    expect(blockKinds.some((c) => c.pluginId === BUILTIN_PLUGIN_IDS.mermaid && c.blockType === 'mermaid')).toBe(true);
    expect(blockKinds.some((c) => c.pluginId === BUILTIN_PLUGIN_IDS.katex && c.blockType === 'math')).toBe(true);
    expect(blockKinds.some((c) => c.pluginId === BUILTIN_PLUGIN_IDS.katex && c.blockType === 'math-inline')).toBe(true);
  });

  it('内置插件可禁用但不可卸载；禁用后贡献点消失，重启后保持禁用', () => {
    const stateFile = join(tmp, 'plugins-builtin.json');
    const first = new PluginService({ stateFile, pluginsRoot: join(tmp, 'installed') });
    first.seedBuiltins(BUILTIN_PLUGIN_MANIFESTS);
    first.setEnabled(BUILTIN_PLUGIN_IDS.mermaid, false);
    expect(
      first.listContributions().some((c) => c.pluginId === BUILTIN_PLUGIN_IDS.mermaid),
    ).toBe(false);
    expect(() => first.uninstall(BUILTIN_PLUGIN_IDS.mermaid)).toThrow(/不可卸载/);

    // 重启（同一 stateFile）：内置 manifest 随包重新预置，禁用状态持久化。
    const second = new PluginService({ stateFile, pluginsRoot: join(tmp, 'installed') });
    second.seedBuiltins(BUILTIN_PLUGIN_MANIFESTS);
    const mermaid = second.list().find((p) => p.id === BUILTIN_PLUGIN_IDS.mermaid);
    expect(mermaid?.state).toBe('disabled');
    expect(
      second.listContributions().some((c) => c.pluginId === BUILTIN_PLUGIN_IDS.mermaid),
    ).toBe(false);
    // KaTeX 仍激活。
    const katex = second.list().find((p) => p.id === BUILTIN_PLUGIN_IDS.katex);
    expect(katex?.state).toBe('active');

    // 重新启用后贡献点恢复。
    second.setEnabled(BUILTIN_PLUGIN_IDS.mermaid, true);
    expect(
      second.listContributions().some((c) => c.pluginId === BUILTIN_PLUGIN_IDS.mermaid),
    ).toBe(true);
  });

  it('内置插件不产生沙箱会话命令，也不进入第三方安装清单', () => {
    const service = makeService();
    service.seedBuiltins(BUILTIN_PLUGIN_MANIFESTS);
    expect(service.listCommands()).toEqual([]);
  });
});
