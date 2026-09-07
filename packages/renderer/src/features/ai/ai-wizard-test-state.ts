import type { AiProviderKind, ConnectionTestResult } from '@nexnote/shared';

export interface AiConnectionTestInputs {
  kind: AiProviderKind;
  baseUrl: string;
  /** Model/deployment is part of the target being preflighted (especially Azure). */
  defaultModel: string;
  /** Opaque in-memory credential revision; the key itself is never serialized into state/signatures. */
  credentialRevision: number;
}

/** Bind a test to its complete provider target without serializing an API key into React state. */
export function connectionTestSignature(inputs: AiConnectionTestInputs): string {
  return JSON.stringify({
    kind: inputs.kind,
    baseUrl: inputs.baseUrl.trim(),
    defaultModel: inputs.defaultModel.trim(),
    credentialRevision: inputs.credentialRevision,
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
