import { randomUUID } from 'node:crypto';
export interface SecretVault {
  readonly available: boolean;
  put(account: string, secret: string): void;
  get(account: string): string | null;
  delete(account: string): void;
}

export class SecretStorageUnavailableError extends Error {
  readonly code = 'SECRET_STORAGE_UNAVAILABLE';
  constructor() {
    super('系统凭据存储不可用，无法安全保存 API Key；请启用系统钥匙串后重试');
    this.name = 'SecretStorageUnavailableError';
  }
}

/** Narrow interface used by migration and tests; safeStorage is never used for new writes. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?: () => string;
}

export interface KeyringEntryLike {
  setPassword(password: string): void;
  getPassword(): string | null;
  deleteCredential(): boolean;
}

const SERVICE = 'NexNote AI Provider Credentials';
const ACCOUNT_PREFIX = 'nexnote-ai-';

export class KeyringSecretVault implements SecretVault {
  readonly available: boolean;
  constructor(
    private readonly entryFactory: (account: string) => KeyringEntryLike = (account) => {
      throw new Error(`keyring unavailable: ${SERVICE}/${account}`);
    },
  ) {
    try {
      // Verify the native credential backend itself, without writing a credential. Construction
      // alone can succeed even when Keychain/Credential Manager/libsecret is unavailable.
      this.entryFactory(`${ACCOUNT_PREFIX}probe`).getPassword();
      this.available = true;
    } catch {
      this.available = false;
    }
  }
  put(account: string, secret: string): void {
    if (!this.available) throw new SecretStorageUnavailableError();
    try {
      this.entryFactory(account).setPassword(secret);
    } catch {
      throw new SecretStorageUnavailableError();
    }
  }
  get(account: string): string | null {
    if (!this.available) throw new SecretStorageUnavailableError();
    try {
      return this.entryFactory(account).getPassword();
    } catch {
      // Never return a potentially stale/corrupt value.
      return null;
    }
  }
  delete(account: string): void {
    if (!this.available) throw new SecretStorageUnavailableError();
    try {
      this.entryFactory(account).deleteCredential();
    } catch {
      throw new SecretStorageUnavailableError();
    }
  }
}

export class UnavailableSecretVault implements SecretVault {
  readonly available = false;
  put(): void {
    throw new SecretStorageUnavailableError();
  }
  get(): string | null {
    throw new SecretStorageUnavailableError();
  }
  delete(): void {
    throw new SecretStorageUnavailableError();
  }
}

/** Returns an opaque account id; the JSON store must never contain the secret itself. */
export function newSecretAccount(): string {
  return `${ACCOUNT_PREFIX}${randomUUID()}`;
}

export async function createSecretVault(
  entryFactory?: (account: string) => KeyringEntryLike,
): Promise<SecretVault> {
  if (entryFactory) {
    try {
      return new KeyringSecretVault(entryFactory);
    } catch {
      return new UnavailableSecretVault();
    }
  }
  try {
    const { Entry } = await import('@napi-rs/keyring');
    return new KeyringSecretVault((account) => new Entry(SERVICE, account));
  } catch {
    return new UnavailableSecretVault();
  }
}

/** Decrypts only legacy safeStorage blobs, for one-time migration. */
export function decryptLegacySafeStorage(blob: string, safeStorage: SafeStorageLike): string {
  if (!blob.startsWith('enc:v1:')) throw new Error('无法识别的 legacy credential blob');
  if (!safeStorage.isEncryptionAvailable()) throw new SecretStorageUnavailableError();
  const backend = safeStorage.getSelectedStorageBackend?.();
  if (backend && backend !== 'OSCrypt') throw new SecretStorageUnavailableError();
  return safeStorage.decryptString(Buffer.from(blob.slice('enc:v1:'.length), 'base64'));
}
