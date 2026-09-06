import { describe, expect, it } from 'vitest';
import type { ConnectionTestResult } from '@nexnote/shared';
import {
  connectionTestSignature,
  isConnectionTestCurrent,
} from '../../renderer/src/features/ai/ai-wizard-test-state';

const passing: ConnectionTestResult = {
  reachable: true,
  capabilities: { chat: true, streaming: true, embeddings: true, tools: true },
  models: ['gpt-4o-mini'],
  latencyMs: 1,
};

const inputs = {
  kind: 'openai-compatible' as const,
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-one',
};

describe('AI setup wizard connection-test invalidation', () => {
  it('当前输入与通过测试签名一致时有效', () => {
    expect(isConnectionTestCurrent(passing, connectionTestSignature(inputs), inputs)).toBe(true);
  });

  it.each([
    ['kind', { ...inputs, kind: 'azure-openai' as const }],
    ['baseUrl', { ...inputs, baseUrl: 'https://other.example.com/v1' }],
    ['apiKey', { ...inputs, apiKey: 'sk-two' }],
  ])('%s 变化会使通过测试失效', (_field, changed) => {
    expect(isConnectionTestCurrent(passing, connectionTestSignature(inputs), changed)).toBe(false);
  });

  it('连接失败或无测试结果时始终无效', () => {
    const signature = connectionTestSignature(inputs);
    expect(isConnectionTestCurrent({ ...passing, reachable: false }, signature, inputs)).toBe(
      false,
    );
    expect(isConnectionTestCurrent(null, signature, inputs)).toBe(false);
  });

  it('baseUrl 前后空白不导致误失效（与主进程规范化一致）', () => {
    const padded = { ...inputs, baseUrl: `  ${inputs.baseUrl}/  ` };
    // 尾 slash 属于实际 URL 变化；仅验证纯空白规范化
    const whitespaceOnly = { ...inputs, baseUrl: `  ${inputs.baseUrl}  ` };
    expect(isConnectionTestCurrent(passing, connectionTestSignature(inputs), whitespaceOnly)).toBe(
      true,
    );
    expect(isConnectionTestCurrent(passing, connectionTestSignature(inputs), padded)).toBe(false);
  });
});
