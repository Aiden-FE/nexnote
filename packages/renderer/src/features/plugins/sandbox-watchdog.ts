export const PLUGIN_HEARTBEAT_TIMEOUT_MS = 2_000;

/** iframe heartbeat 判断保持为纯逻辑，浏览器与单测使用同一实现。 */
export class SandboxHeartbeatWatchdog {
  private lastBeat: number;
  constructor(
    now: number,
    readonly timeoutMs = PLUGIN_HEARTBEAT_TIMEOUT_MS,
  ) {
    this.lastBeat = now;
  }
  beat(now: number): void {
    this.lastBeat = now;
  }
  expired(now: number): boolean {
    return now - this.lastBeat > this.timeoutMs;
  }
}
