/**
 * 密钥保险库：密钥明文只在此层存在（主进程内存），落盘前必经 encrypt。
 * 生产实现 = Electron safeStorage（macOS Keychain / Windows Credential Manager /
 * Linux libsecret 的加密材料）。密钥材料由系统钥匙串保管，JSON 中只存加密 blob。
 *
 * 安全契约：
 * - 系统凭据存储不可用时，**决不**降级到 JSON 明文。
 * - encrypt/decrypt 直接抛 SecretStorageUnavailableError，由上层决定失败策略。
 * - 向导 candidate 测试路径不经过 store/vault，密钥只在单次请求内存中存在。
 */

export interface SecretVault {
  /** 系统加密是否可用 */
  readonly available: boolean;
  encrypt(plain: string): string;
  decrypt(blob: string): string;
}

/** 与 Electron.safeStorage 兼容的最小接口（测试用假实现替换）。 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /**
   * Electron safeStorage 自 22 版本起暴露的 backend 探测。
   * 已知值：'basic_text' | 'keychain' | 'libsecret' | 'dpapi' | 'unknown' | 'gnome_libsecret'。
   * 'basic_text' 在 Linux 上代表无系统凭据存储、明文 XOR 加密——不得作为 keychain 信任。
   */
  getSelectedStorageBackend?(): string;
}

/**
 * 系统凭据存储不可用错误：明确的失败信号。
 * 上层（AiStore / IPC handler）应捕获并向用户展示：请启用系统钥匙串。
 */
export class SecretStorageUnavailableError extends Error {
  readonly code = 'SECRET_STORAGE_UNAVAILABLE';

  constructor() {
    super('系统凭据存储不可用，无法安全保存 API Key；请启用系统钥匙串后重试');
    this.name = 'SecretStorageUnavailableError';
  }
}

class SafeStorageVault implements SecretVault {
  constructor(private readonly safeStorage: SafeStorageLike) {}

  get available(): boolean {
    try {
      if (!this.safeStorage.isEncryptionAvailable()) return false;
      // Linux 下 basic_text backend 等同于明文伪装加密，fail-closed。
      const backend = this.safeStorage.getSelectedStorageBackend?.();
      if (backend === 'basic_text') return false;
      return true;
    } catch {
      return false;
    }
  }

  encrypt(plain: string): string {
    // blob 前缀标记加密格式，未来算法迁移可区分
    return `enc:v1:${this.safeStorage.encryptString(plain).toString('base64')}`;
  }

  decrypt(blob: string): string {
    if (!blob.startsWith('enc:v1:')) {
      throw new Error('密钥 blob 格式无法识别');
    }
    return this.safeStorage.decryptString(Buffer.from(blob.slice('enc:v1:'.length), 'base64'));
  }
}

/**
 * 不可用 vault：safeStorage 不可用时的占位实现。
 * available=false，且 encrypt/decrypt 一律抛 SecretStorageUnavailableError。
 * 目的：fail-closed —— 密钥绝不能以明文落到 JSON。
 */
export class UnavailableSecretVault implements SecretVault {
  readonly available = false;

  encrypt(_plain: string): string {
    throw new SecretStorageUnavailableError();
  }

  decrypt(_blob: string): string {
    throw new SecretStorageUnavailableError();
  }
}

/** 生产工厂：safeStorage 可用 → SafeStorageVault；否则 fail-closed → UnavailableSecretVault。 */
export function createSecretVault(safeStorage: SafeStorageLike): SecretVault {
  const vault = new SafeStorageVault(safeStorage);
  return vault.available ? vault : new UnavailableSecretVault();
}
