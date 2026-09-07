import { randomBytes } from 'node:crypto';

const MAX_TOKENS_PER_SENDER = 8;
const TTL_MS = 5 * 60 * 1000; // 5 分钟

interface ClonePreflightToken {
  token: string;
  senderId: number;
  createdAt: number;
  /** URL 与 targetDir 在创建时校验并冻结；clone 实际执行时必须完全一致。 */
  url: string;
  targetDir: string;
  consumed: boolean;
}

/**
 * Clone 预授权令牌库。
 * 安全模型：
 * - 预检查（preflight）完成后才发放令牌，令牌一次性使用。
 * - 令牌与 sender 绑定：只有发起 preflight 的 sender 能消费。
 * - TTL 过期自动失效。
 * - 每 sender 最多 8 个令牌，防止内存膨胀。
 * - 消费即销毁（revoke on consume）；sender 关闭时其所有令牌同步销毁。
 */
export class VaultCloneController {
  private readonly tokens = new Map<string, ClonePreflightToken>();
  private readonly bySender = new Map<number, Set<string>>();

  /**
   * 预检查通过后，生成一个一次性令牌。
   * url / targetDir 会随令牌绑定，消费时必须完全一致，防止中间人替换。
   */
  createToken(senderId: number, url: string, targetDir: string): string {
    this.sweepExpired();
    const senderTokens = this.bySender.get(senderId);
    if (senderTokens && senderTokens.size >= MAX_TOKENS_PER_SENDER) {
      // 超出上限：驱逐最旧的
      const oldest = this.findOldestForSender(senderId);
      if (oldest) this.revoke(oldest);
    }
    const token = randomBytes(24).toString('base64url');
    const entry: ClonePreflightToken = {
      token,
      senderId,
      createdAt: Date.now(),
      url,
      targetDir,
      consumed: false,
    };
    this.tokens.set(token, entry);
    const set = this.bySender.get(senderId) ?? new Set<string>();
    set.add(token);
    this.bySender.set(senderId, set);
    return token;
  }

  /**
   * 消费令牌：验证 sender、TTL、未消费、url 与 targetDir 完全匹配。
   * 成功消费后令牌立即销毁。
   */
  consume(
    token: string,
    senderId: number,
    url: string,
    targetDir: string,
  ): { ok: true } | { ok: false; reason: string } {
    this.sweepExpired();
    const entry = this.tokens.get(token);
    if (!entry) return { ok: false, reason: 'INVALID_TOKEN' };
    if (entry.senderId !== senderId) return { ok: false, reason: 'SENDER_MISMATCH' };
    if (entry.consumed) return { ok: false, reason: 'ALREADY_CONSUMED' };
    if (Date.now() - entry.createdAt > TTL_MS) {
      this.revoke(token);
      return { ok: false, reason: 'EXPIRED' };
    }
    if (entry.url !== url || entry.targetDir !== targetDir) {
      return { ok: false, reason: 'PARAM_MISMATCH' };
    }
    entry.consumed = true;
    this.revoke(token);
    return { ok: true };
  }

  /** sender 关闭时调用：销毁该 sender 的所有令牌。 */
  disposeSender(senderId: number): void {
    const set = this.bySender.get(senderId);
    if (!set) return;
    for (const token of set) this.tokens.delete(token);
    this.bySender.delete(senderId);
  }

  private revoke(token: string): void {
    const entry = this.tokens.get(token);
    if (!entry) return;
    this.tokens.delete(token);
    const set = this.bySender.get(entry.senderId);
    if (set) {
      set.delete(token);
      if (set.size === 0) this.bySender.delete(entry.senderId);
    }
  }

  private findOldestForSender(senderId: number): string | null {
    const set = this.bySender.get(senderId);
    if (!set) return null;
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const token of set) {
      const entry = this.tokens.get(token);
      if (entry && entry.createdAt < oldestTime) {
        oldest = token;
        oldestTime = entry.createdAt;
      }
    }
    return oldest;
  }

  private sweepExpired(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    for (const [token, entry] of this.tokens) {
      if (now - entry.createdAt > TTL_MS) toDelete.push(token);
    }
    for (const token of toDelete) this.revoke(token);
  }

  /** 仅测试用：返回当前令牌数。 */
  _size(): number {
    return this.tokens.size;
  }
}
