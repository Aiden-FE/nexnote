import type { AiProviderKind, ConnectionTestResult } from '@nexnote/shared';

export interface AiConnectionTestInputs {
  kind: AiProviderKind;
  baseUrl: string;
  apiKey: string;
}

/** 规范化连接输入，用于绑定一次测试结果；任一安全相关输入变化都会产生不同签名。 */
export function connectionTestSignature(inputs: AiConnectionTestInputs): string {
  return JSON.stringify({
    kind: inputs.kind,
    baseUrl: inputs.baseUrl.trim(),
    apiKey: inputs.apiKey,
  });
}

/** 只有 reachable 且测试签名仍与当前输入一致，才允许进入模型步骤或保存。 */
export function isConnectionTestCurrent(
  result: ConnectionTestResult | null,
  testedSignature: string | null,
  current: AiConnectionTestInputs,
): boolean {
  return !!result?.reachable && testedSignature === connectionTestSignature(current);
}
