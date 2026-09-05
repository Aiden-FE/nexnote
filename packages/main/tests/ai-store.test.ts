import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiStore } from '../src/ai/ai-store';
import type { SecretVault } from '../src/ai/secret-store';

/**
 * fake safeStorage：模拟 Electron 系统钥匙串（加密材料在"钥匙串"里，
 * JSON 只存加密 blob）。用 ROT13 表示"加密"足够验证隔离语义。
 */
function fakeSafeStorageVault(): SecretVault {
  const rot = (s: string): string =>
    s.replace(/[a-zA-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) + 13 - (c <= 'Z' ? 65 : 97)) % 26) + (c <= 'Z' ? 65 : 97)));
  return {
    available: true,
    encrypt: (p) => `enc:v1:${btoa(rot(p))}`,
    decrypt: (b) => rot(atob(b.slice('enc:v1:'.length))),
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
    expect(view.keyStorage).toBe('safestorage');
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
    expect(raw).toContain('enc:v1:');
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

  it('safeStorage 不可用时回退 plain 标记', () => {
    const plain = new AiStore(path.join(tmp, 'ai2.json'), {
      available: false,
      encrypt: (p) => `plain:${p}`,
      decrypt: (b) => b.slice('plain:'.length),
    });
    const saved = plain.saveProfile(undefined, input);
    const view = plain.getState().profiles[0]!;
    expect(view.keyStorage).toBe('plain');
    expect(plain.getApiKey(saved.id)).toBe('sk-very-secret-123');
  });

  it('校验：非法 base-url / 空名称 / 空模型拒绝', () => {
    expect(() => store.saveProfile(undefined, { ...input, baseUrl: 'ftp://x' })).toThrow(/http/);
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
    expect(state.defaultProfileId).toBeNull();
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
    expect(state.embeddingGeneration).toBe(1); // 首次设置 embedding 即 generation 1
    expect(state.embeddingFingerprint).toBe(`${b.id}:text-embedding-3-small:auto:cosine`);

    // 无关变更不增 generation
    store.setFeatureAssignment('chat', { profileId: a.id, model: 'gpt-4o-mini' });
    expect(store.getState().embeddingGeneration).toBe(1);

    // 维度探测回写 → 指纹变化 → generation+1（= 索引需重建）
    store.recordEmbeddingDimensions(1536);
    state = store.getState();
    expect(state.embeddingGeneration).toBe(2);
    expect(state.embeddingFingerprint).toBe(`${b.id}:text-embedding-3-small:1536:cosine`);

    // 切换 embedding 模型 → generation+1
    store.setFeatureAssignment('embedding', { profileId: b.id, model: 'text-embedding-3-large' });
    expect(store.getState().embeddingGeneration).toBe(3);

    // 置空 → 指纹清空（generation 仍递增）
    store.setFeatureAssignment('embedding', null);
    state = store.getState();
    expect(state.embeddingFingerprint).toBeNull();
    expect(state.embeddingGeneration).toBe(4);
  });

  it('导出捆绑不含密钥；导入按名称合并（密钥永不导入）', () => {
    const a = store.saveProfile(undefined, input);
    store.setFeatureAssignment('chat', { profileId: a.id, model: 'gpt-4o-mini' });
    const bundle = store.exportBundle();
    const json = JSON.stringify(bundle);
    expect(json).not.toContain('sk-very-secret-123');
    expect(json).not.toContain('keyBlob');
    expect(bundle.profiles[0]!.name).toBe('Mock 网关');
    expect(bundle.features.chat).toEqual({ name: 'Mock 网关', model: 'gpt-4o-mini' });
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

  it('损坏 JSON 回退默认（不抛错）', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(tmp, 'ai5.json'), '{broken', 'utf8');
    const s = new AiStore(path.join(tmp, 'ai5.json'), secrets);
    expect(s.getState().needsOnboarding).toBe(true);
  });
});
