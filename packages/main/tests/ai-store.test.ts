import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiStore } from '../src/ai/ai-store';
import { UnavailableSecretVault, type SecretVault } from '../src/ai/secret-store';

/**
 * fake safeStorage：模拟 Electron 系统钥匙串（加密材料在"钥匙串"里，
 * JSON 只存加密 blob）。用 ROT13 表示"加密"足够验证隔离语义。
 */
function fakeSafeStorageVault(): SecretVault {
  const values = new Map<string, string>();
  return {
    available: true,
    put: (account, secret) => values.set(account, secret),
    get: (account) => values.get(account) ?? null,
    delete: (account) => values.delete(account),
  };
}

let tmp: string;
let store: AiStore;
let secrets: SecretVault;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-ai-store-test-'));
  secrets = fakeSafeStorageVault();
  store = new AiStore(path.join(tmp, 'ai.json'), secrets);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const input = {
  name: 'Mock 网关',
  kind: 'openai-compatible' as const,
  baseUrl: 'https://api.example.com/v1/',
  defaultModel: 'gpt-4o-mini',
  apiKey: 'sk-very-secret-123',
};

describe('AiStore（Profile 存储 + 密钥安全）', () => {
  it('保存 Profile：密钥加密落盘、视图无明文、首个 Profile 自动成为默认', () => {
    const saved = store.saveProfile(undefined, input);
    expect(saved.id).toBeTruthy();
    const state = store.getState();
    expect(state.profiles).toHaveLength(1);
    expect(state.defaultProfileId).toBe(saved.id);
    expect(state.needsOnboarding).toBe(false);

    const view = state.profiles[0]!;
    expect(view.hasApiKey).toBe(true);
    expect(view.keyStorage).toBe('system-credential');
    expect(view.baseUrl).toBe('https://api.example.com/v1'); // 尾斜杠规范化

    // 密钥明文绝不出现在渲染层视图与持久化 JSON 中
    expect(JSON.stringify(state)).not.toContain('sk-very-secret-123');
    expect(JSON.stringify(view)).not.toContain('sk-very-secret-123');
  });

  it('落盘文件只含加密 blob（密钥不落明文）', async () => {
    store.saveProfile(undefined, input);
    const raw = await readFile(path.join(tmp, 'ai.json'), 'utf8');
    expect(raw).not.toContain('sk-very-secret-123');
    expect(raw).toContain('keyBlob');
    expect(raw).not.toContain('enc:v1:');
  });

  it('密钥可解密回明文（仅主进程 getApiKey 路径）', () => {
    const saved = store.saveProfile(undefined, input);
    expect(store.getApiKey(saved.id)).toBe('sk-very-secret-123');
  });

  it('编辑时 apiKey=undefined 保留原密钥；null 清除', () => {
    const saved = store.saveProfile(undefined, input);
    store.saveProfile(saved.id, { ...input, name: '改名', apiKey: undefined });
    expect(store.getApiKey(saved.id)).toBe('sk-very-secret-123');

    store.saveProfile(saved.id, { ...input, name: '改名', apiKey: null });
    expect(store.getApiKey(saved.id)).toBe('');
    expect(store.getState().profiles[0]!.hasApiKey).toBe(false);
  });

  it('safeStorage 不可用时 fail-closed：保存带密钥 Profile 直接失败，不落盘任何 key', async () => {
    const unavailable = new AiStore(path.join(tmp, 'ai2.json'), new UnavailableSecretVault());
    // 带密钥 → 明确失败（绝不写明文）
    expect(() => unavailable.saveProfile(undefined, input)).toThrow(/凭据存储不可用/);
    // Profile 也没被创建（save 是原子失败）
    expect(unavailable.getState().profiles).toHaveLength(0);
    // 落盘文件不存在或不含密钥
    const raw = await readFile(path.join(tmp, 'ai2.json'), 'utf8').catch(() => '');
    expect(raw).not.toContain('sk-very-secret-123');
    expect(raw).not.toContain('plain:');

    // 无密钥 Profile（本地 Ollama）仍可创建——密钥不是必填项
    const noKey = unavailable.saveProfile(undefined, { ...input, apiKey: null });
    expect(noKey.id).toBeTruthy();
    expect(unavailable.getState().profiles[0]!.hasApiKey).toBe(false);
  });

  it('遗留 plain: blob 加载时被清除（fail-closed 迁移）', () => {
    // 模拟旧版本写入的明文 blob
    const legacyJson = JSON.stringify({
      version: 1,
      profiles: [
        {
          id: 'legacy-id',
          name: 'Legacy',
          kind: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          defaultModel: 'gpt-4o-mini',
          params: {},
          keyBlob: 'plain:sk-legacy-secret',
          keyStorage: 'plain',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      defaultProfileId: 'legacy-id',
      features: { writing: null, chat: null, embedding: null },
      embeddingFingerprint: null,
      embeddingGeneration: 0,
    });
    const legacyPath = path.join(tmp, 'legacy.json');
    writeFileSync(legacyPath, legacyJson, 'utf8');
    const migrated = new AiStore(legacyPath, secrets);
    const view = migrated.getState().profiles[0]!;
    expect(view.hasApiKey).toBe(false); // 明文密钥被丢弃
    expect(view.keyStorage).toBe('system-credential');
    expect(migrated.getApiKey('legacy-id')).toBe('');
    const rewritten = readFileSync(legacyPath, 'utf8');
    expect(rewritten).not.toContain('sk-legacy-secret');
    expect(rewritten).not.toContain('plain:');
  });

  it('首个 local embedding 不会成为全局聊天默认；首个聊天 Profile 才会成为默认', () => {
    const local = store.saveProfile(undefined, {
      name: 'Local vectors',
      kind: 'local-embedding',
      baseUrl: 'local://embedding',
      defaultModel: 'local-hash-384',
      apiKey: null,
    });
    expect(store.getState().defaultProfileId).toBeNull();
    expect(() => store.setDefaultProfile(local.id)).toThrow(/不能作为全局聊天默认/);

    const chat = store.saveProfile(undefined, input);
    expect(store.getState().defaultProfileId).toBe(chat.id);
  });

  it('local embedding 仅接受精确 local://embedding 且禁止凭据', () => {
    const local = store.saveProfile(undefined, {
      ...input,
      kind: 'local-embedding',
      baseUrl: 'local://embedding',
      defaultModel: 'local-transformer',
      apiKey: null,
    });
    expect(local.baseUrl).toBe('local://embedding');
    expect(local.keyBlob).toBeNull();
    expect(() =>
      store.saveProfile(undefined, {
        ...input,
        kind: 'local-embedding',
        baseUrl: 'local://other',
        apiKey: null,
      }),
    ).toThrow(/local:\/\/embedding/);
    expect(() =>
      store.saveProfile(undefined, {
        ...input,
        kind: 'local-embedding',
        baseUrl: 'local://embedding',
      }),
    ).toThrow(/不接受凭据/);
  });

  it('网络 Profile 校验：非法 base-url / URL userinfo / 空名称 / 空模型拒绝', () => {
    expect(() => store.saveProfile(undefined, { ...input, baseUrl: 'ftp://x' })).toThrow(/http/);
    expect(() =>
      store.saveProfile(undefined, {
        ...input,
        baseUrl: 'https://user:password@api.example.com/v1',
      }),
    ).toThrow(/不得包含用户名\/密码/);
    expect(() => store.saveProfile(undefined, { ...input, name: '  ' })).toThrow(/名称/);
    expect(() => store.saveProfile(undefined, { ...input, defaultModel: '' })).toThrow(/模型/);
  });

  it('删除 Profile：级联清理分功能指定与默认', () => {
    const a = store.saveProfile(undefined, input);
    const b = store.saveProfile(undefined, { ...input, name: '第二个' });
    store.setDefaultProfile(a.id);
    store.setFeatureAssignment('chat', { profileId: a.id, model: 'gpt-4o-mini' });
    store.deleteProfile(a.id);
    const state = store.getState();
    expect(state.profiles.map((p) => p.id)).toEqual([b.id]);
    expect(state.defaultProfileId).toBe(b.id); // promote the remaining chat-capable Profile
    expect(state.features.chat).toBeNull();
  });

  it('分功能指定三处独立；embedding 指纹与 generation 变更检测', () => {
    const a = store.saveProfile(undefined, input);
    const b = store.saveProfile(undefined, { ...input, name: 'Embed 服务', apiKey: null });
    store.setFeatureAssignment('writing', { profileId: a.id, model: 'gpt-4o' });
    store.setFeatureAssignment('chat', { profileId: a.id, model: 'gpt-4o-mini' });
    store.setFeatureAssignment('embedding', { profileId: b.id, model: 'text-embedding-3-small' });

    let state = store.getState();
    expect(state.features.writing?.model).toBe('gpt-4o');
    expect(state.features.embedding?.profileId).toBe(b.id);
    expect(state.embeddingGeneration).toBe(2); // 默认跟随源 + 显式 embedding 指定各触发一次
    expect(state.embeddingFingerprint).toBe(`${b.id}:text-embedding-3-small:auto:cosine`);

    // 无关变更不增 generation
    store.setFeatureAssignment('chat', { profileId: a.id, model: 'gpt-4o-mini' });
    expect(store.getState().embeddingGeneration).toBe(2);

    // 维度探测回写 → 指纹变化 → generation+1（= 索引需重建）
    store.recordEmbeddingDimensions(1536);
    state = store.getState();
    expect(state.embeddingGeneration).toBe(3);
    expect(state.embeddingFingerprint).toBe(`${b.id}:text-embedding-3-small:1536:cosine`);

    // 切换 embedding 模型 → generation+1
    store.setFeatureAssignment('embedding', { profileId: b.id, model: 'text-embedding-3-large' });
    expect(store.getState().embeddingGeneration).toBe(4);

    // 置空 → 恢复跟随默认 Profile（generation 仍递增）
    store.setFeatureAssignment('embedding', null);
    state = store.getState();
    expect(state.embeddingFingerprint).toBe(`${a.id}:gpt-4o-mini:auto:cosine`);
    expect(state.embeddingGeneration).toBe(5);
  });

  it('导出捆绑不含密钥；导入按名称合并（密钥永不导入）', () => {
    const a = store.saveProfile(undefined, input);
    store.setFeatureAssignment('chat', { profileId: a.id, model: 'gpt-4o-mini' });
    const bundle = store.exportBundle();
    const json = JSON.stringify(bundle);
    expect(json).not.toContain('sk-very-secret-123');
    expect(json).not.toContain('keyBlob');
    expect(bundle.profiles[0]!.name).toBe('Mock 网关');
    expect(bundle.features.chat).toEqual({
      profileRef: a.id,
      name: 'Mock 网关',
      model: 'gpt-4o-mini',
    });
    expect(bundle.defaultProfileName).toBe('Mock 网关');

    // 落到新存储导入：同名覆盖（密钥不带入），分功能指定按名称恢复
    const other = new AiStore(path.join(tmp, 'ai3.json'), secrets);
    other.saveProfile(undefined, {
      name: 'Mock 网关',
      kind: 'openai-compatible',
      baseUrl: 'https://old.example.com/v1',
      defaultModel: 'old-model',
      apiKey: 'sk-other-secret',
    });
    const result = other.importBundle(bundle);
    expect(result.imported).toBe(1);
    const state = other.getState();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]!.baseUrl).toBe('https://api.example.com/v1'); // 被导出值覆盖
    expect(state.profiles[0]!.defaultModel).toBe('gpt-4o-mini');
    expect(state.features.chat?.model).toBe('gpt-4o-mini');
    // 同名导入保留既有密钥（sk-other-secret），不导入空密钥
    expect(state.profiles[0]!.hasApiKey).toBe(true);

    // 异名导入 = 新建，无密钥
    const fresh = new AiStore(path.join(tmp, 'ai4.json'), secrets);
    const r2 = fresh.importBundle(bundle);
    expect(r2.imported).toBe(1);
    expect(fresh.getState().profiles[0]!.hasApiKey).toBe(false);
  });

  it('重复 Profile 名称时，legacy name-only import 不恢复默认或功能指定', () => {
    store.saveProfile(undefined, input);
    store.saveProfile(undefined, {
      ...input,
      name: input.name,
      baseUrl: 'https://second.example.com/v1',
    });
    const result = store.importBundle({
      app: 'nexnote',
      kind: 'ai-profiles',
      version: 1,
      exportedAt: new Date().toISOString(),
      profiles: [],
      features: {
        chat: { name: input.name, model: 'gpt-4o-mini' },
        writing: null,
        embedding: null,
      },
      defaultProfileName: input.name,
    });
    expect(result.imported).toBe(0);
    expect(store.getState().features.chat).toBeNull();
    expect(store.getState().defaultProfileId).not.toBeNull(); // existing default remains untouched
  });

  it('export-scoped profile references restore duplicate-name assignments unambiguously', () => {
    const first = store.saveProfile(undefined, input);
    const second = store.saveProfile(undefined, {
      ...input,
      name: input.name,
      baseUrl: 'https://second.example.com/v1',
    });
    store.setFeatureAssignment('chat', { profileId: second.id, model: 'gpt-4o' });
    store.setDefaultProfile(second.id);
    const bundle = store.exportBundle();
    const target = new AiStore(path.join(tmp, 'ai-refs.json'), secrets);
    target.importBundle(bundle);
    expect(target.getState().features.chat?.model).toBe('gpt-4o');
    expect(target.getState().defaultProfileId).toBeTruthy();
    expect(first.id).not.toBe(second.id);
  });

  it('损坏 JSON 回退默认（不抛错）', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(tmp, 'ai5.json'), '{broken', 'utf8');
    const s = new AiStore(path.join(tmp, 'ai5.json'), secrets);
    expect(s.getState().needsOnboarding).toBe(true);
  });
});
