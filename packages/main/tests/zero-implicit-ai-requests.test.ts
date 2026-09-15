import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AiStore } from '../src/ai/ai-store';
import { AiService } from '../src/ai/ai-service';
import { createProviderRequestSpy, startMockOpenAiServer, type MockOpenAiServer } from '../src/ai/testing';
import type { SecretVault } from '../src/ai/secret-store';
import { LinkIndexService } from '../src/indexer/index-service';
import { RetrievalService } from '../src/retrieval/retrieval-service';

const roots: string[] = [];
let mock: MockOpenAiServer;

afterAll(async () => mock.close());
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

beforeAll(async () => {
  mock = await startMockOpenAiServer({ embeddingDimensions: 2 });
});

function fakeVault(): SecretVault {
  const secrets = new Map<string, string>();
  return {
    available: true,
    put: (account, secret) => void secrets.set(account, secret),
    get: (account) => secrets.get(account) ?? null,
    delete: (account) => void secrets.delete(account),
  };
}

async function makeVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'nexnote-zero-ai-'));
  roots.push(root);
  await writeFile(path.join(root, 'page.md'), '# Page\n\nordinary editing content\n', 'utf8');
  return root;
}

async function configuredAi() {
  const stateFile = await mkdtemp(path.join(tmpdir(), 'nexnote-zero-ai-profile-'));
  roots.push(stateFile);
  const spy = createProviderRequestSpy(mock.url);
  const ai = new AiService({
    store: new AiStore(path.join(stateFile, 'ai.json'), fakeVault()),
    sendEvent: () => undefined,
    fetchImpl: spy.fetch,
  });
  const baseUrl = `${mock.url}/v1`;
  const credentialToken = ai.submitCredential('sk-test-only', baseUrl);
  const { id } = ai.saveProfile(undefined, {
    name: 'request spy provider',
    kind: 'openai-compatible',
    baseUrl,
    defaultModel: 'gpt-4o-mini',
    credentialToken,
  });
  ai.setDefaultProfile(id);
  // Default profile is the fallback embedding target; profile setup itself is network-free.
  expect(spy.count()).toBe(0);
  return { ai, spy };
}

describe('DEV-030 零隐式 AI 请求门禁', () => {
  it('普通编辑场景矩阵不发往 provider（包括索引防抖后）', async () => {
    const { spy } = await configuredAi();
    const root = await makeVault();
    const index = new LinkIndexService(undefined, () => undefined);
    index.setRoot(root);

    const ordinaryScenarios: Array<[string, () => void | Promise<void>]> = [
      ['输入 / 删除 / 粘贴 / 撤销重做 / 自动保存', async () => {
        await writeFile(path.join(root, 'page.md'), '# Page\n\nedited then restored\n', 'utf8');
        index.updateFile('page.md');
      }],
      ['H1 改名', async () => {
        await writeFile(path.join(root, 'page.md'), '# Renamed\n\ncontent\n', 'utf8');
        index.updateFile('page.md');
      }],
      ['普通搜索与页面浏览', () => {
        index.search('content');
        index.jumpTo('Renamed');
        index.pageSummary('page.md');
        index.backlinks('page.md');
      }],
      ['Tab 切换、打开编辑器/dock/预览（无主进程 AI IPC）', () => undefined],
    ];
    for (const [name, perform] of ordinaryScenarios) {
      await perform();
      await new Promise((resolve) => setTimeout(resolve, 260)); // pass index debounce boundary
      expect(spy.count(), name).toBe(0);
    }
    index.close();
  });

  it('文件索引回调不会隐式启动语义索引或 embedding', async () => {
    const { ai, spy } = await configuredAi();
    const root = await makeVault();
    const index = new LinkIndexService(undefined, () => undefined);
    const retrieval = new RetrievalService({ index, embedder: ai });
    index.setRoot(root); // full rebuild invokes onIndexed, but production no longer calls retrieval.invalidate.
    index.updateFile('page.md');
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(spy.paths()).toEqual([]);
    retrieval.close();
    index.close();
  });

  it('显式 AI 操作仍允许且仅产生预期 provider 请求', async () => {
    const { ai, spy } = await configuredAi();
    await ai.chatCompletion({ messages: [{ role: 'user', content: 'hello' }] });
    await ai.embedWithMetadata(['semantic query']);
    expect(spy.paths()).toEqual(['/v1/chat/completions', '/v1/embeddings']);
  });
});
