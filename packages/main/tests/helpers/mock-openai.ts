/** Mock OpenAI 服务器单一实现位于 src/ai/testing.ts（smoke 与单测共用）。 */
export { startMockOpenAiServer } from '../../src/ai/testing';
export type { MockOpenAiServer, MockServerOptions, RecordedRequest } from '../../src/ai/testing';
