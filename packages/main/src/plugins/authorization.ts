import { randomBytes } from 'node:crypto';
import { tCurrent } from '@nexnote/shared';
import type { PluginAuthChallenge, PluginRpcRequest, PluginSessionToken } from '@nexnote/shared';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthSession {
  sessionId: string;
  pluginId: string;
  origin: string;
  issuedAt: number;
  expiresAt: number;
  /** 对应一次性 token（短时）。 */
  token: string;
  /** 已消费过的 nonce 集合，重复 init 防御。 */
  consumedNonces: Set<string>;
}

const SESSION_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_TTL_MS = 60 * 1000;

function newSecret(): string {
  return randomBytes(24).toString('hex');
}

export class AuthorizationManager {
  private readonly sessions = new Map<string, AuthSession>();
  private readonly tokens = new Map<string, AuthSession>();
  private readonly challenges = new Map<string, PluginAuthChallenge>();

  beginSession(
    pluginId: string,
    nonce: string,
    origin: string,
    now = Date.now(),
  ): PluginSessionToken {
    if (!nonce || nonce.length < 16) {
      throw new AuthError(tCurrent('plugin.auth.INVALID_NONCE'), 'INVALID_NONCE');
    }
    if (origin !== 'plugin-frame') {
      throw new AuthError(tCurrent('plugin.auth.INVALID_ORIGIN'), 'INVALID_ORIGIN');
    }
    for (const session of this.sessions.values()) {
      if (session.consumedNonces.has(nonce)) {
        throw new AuthError(tCurrent('plugin.auth.NONCE_REUSED'), 'NONCE_REUSED');
      }
    }
    const sessionId = newSecret().slice(0, 16);
    const token = newSecret();
    const session: AuthSession = {
      sessionId,
      pluginId,
      origin,
      issuedAt: now,
      expiresAt: now + SESSION_TTL_MS,
      token,
      consumedNonces: new Set([nonce]),
    };
    this.sessions.set(sessionId, session);
    this.tokens.set(token, session);
    return {
      token,
      pluginId,
      sessionId,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * 校验 token / 提取会话；不允许单独相信 pluginId。
   * expiresAt 之前的会话才合法。
   */
  verifySession(
    sessionId: string,
    token: string,
    pluginId?: string,
    now = Date.now(),
  ): AuthSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new AuthError(tCurrent('plugin.auth.SESSION_NOT_FOUND'), 'SESSION_NOT_FOUND');
    if (session.token !== token)
      throw new AuthError(tCurrent('plugin.auth.SESSION_TOKEN_MISMATCH'), 'SESSION_TOKEN_MISMATCH');
    if (pluginId !== undefined && session.pluginId !== pluginId) {
      throw new AuthError(tCurrent('plugin.auth.SESSION_PLUGIN_MISMATCH'), 'SESSION_PLUGIN_MISMATCH');
    }
    if (session.expiresAt < now) {
      this.revokeSession(sessionId);
      throw new AuthError(tCurrent('plugin.auth.SESSION_EXPIRED'), 'SESSION_EXPIRED');
    }
    return session;
  }

  revokeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.tokens.delete(session.token);
  }

  revokeAllForPlugin(pluginId: string): void {
    for (const [id, session] of this.sessions) {
      if (session.pluginId === pluginId) this.revokeSession(id);
    }
  }

  beginChallenge(
    sessionId: string,
    token: string,
    pluginId: string,
    request: PluginRpcRequest,
    now = Date.now(),
  ): PluginAuthChallenge {
    this.verifySession(sessionId, token, pluginId);
    const challenge = randomBytes(16).toString('hex');
    this.challenges.set(challenge, {
      challenge,
      pluginId,
      permission: (request.params as { permission?: unknown })?.permission as never,
      request,
      sessionId,
      requestId: request.id,
      issuedAt: now,
      expiresAt: now + CHALLENGE_TTL_MS,
    });
    return this.challenges.get(challenge)!;
  }

  consumeChallenge(
    challenge: string,
    options: { expectedSessionId?: string; expectedRequestId?: string; token?: string } = {},
    now = Date.now(),
  ): PluginAuthChallenge {
    const record = this.challenges.get(challenge);
    if (!record)
      throw new AuthError(tCurrent('plugin.auth.CHALLENGE_NOT_FOUND'), 'CHALLENGE_NOT_FOUND');
    this.challenges.delete(challenge);
    if (record.expiresAt < now)
      throw new AuthError(tCurrent('plugin.auth.CHALLENGE_EXPIRED'), 'CHALLENGE_EXPIRED');
    if (options.expectedSessionId && record.sessionId !== options.expectedSessionId) {
      throw new AuthError(tCurrent('plugin.auth.CHALLENGE_SESSION_MISMATCH'), 'CHALLENGE_SESSION_MISMATCH');
    }
    if (options.expectedRequestId && record.requestId !== options.expectedRequestId) {
      throw new AuthError(tCurrent('plugin.auth.CHALLENGE_REQUEST_MISMATCH'), 'CHALLENGE_REQUEST_MISMATCH');
    }
    if (options.token !== undefined) {
      const session = this.sessions.get(record.sessionId);
      if (!session || session.token !== options.token) {
        throw new AuthError(tCurrent('plugin.auth.CHALLENGE_TOKEN_MISMATCH'), 'CHALLENGE_TOKEN_MISMATCH');
      }
    }
    return record;
  }

  rejectChallenge(challenge: string, now = Date.now()): void {
    const record = this.challenges.get(challenge);
    if (!record || record.expiresAt < now) return;
    this.challenges.delete(challenge);
  }
}
