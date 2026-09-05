/**
 * 密钥保险库：密钥明文只在此层存在（主进程内存），落盘前必经 encrypt。
 * 生产实现 = Electron safeStorage（macOS Keychain / Windows Credential Manager /
 * Linux libsecret 的加密材料）。密钥材料由系统钥匙串保管，JSON 中只存加密 blob。
 * safeStorage 不可用（无钥匙串的 Linux 等）时回退明文存储并在 Profile 上标记
 * keyStorage='plain'（渲染层可见该标记以提示用户）。
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
}

class SafeStorageVault implements SecretVault {
  constructor(private readonly safeStorage: SafeStorageLike) {}

  get available(): boolean {
    try {
      return this.safeStorage.isEncryptionAvailable();
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

/** 明文回退（无钥匙串环境）。available=false 时由 AiStore 决定标记。 */
export class PlainTextVault implements SecretVault {
  get available(): boolean {
    return false;
  }

  encrypt(plain: string): string {
    return `plain:${plain}`;
  }

  decrypt(blob: string): string {
    if (!blob.startsWith('plain:')) throw new Error('密钥 blob 格式无法识别');
    return blob.slice('plain:'.length);
  }
}

/** 生产工厂：优先 safeStorage，不可用则明文回退。 */
export function createSecretVault(safeStorage: SafeStorageLike): SecretVault {
  const vault = new SafeStorageVault(safeStorage);
  return vault.available ? vault : new PlainTextVault();
}
