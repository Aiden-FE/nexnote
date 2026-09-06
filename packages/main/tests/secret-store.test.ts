import { describe, expect, it } from 'vitest';
import {
  UnavailableSecretVault,
  createSecretVault,
  SecretStorageUnavailableError,
  type SafeStorageLike,
} from '../src/ai/secret-store';

const fakeSafe = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(plain).reverse(),
  decryptString: (buf) => Buffer.from(buf).reverse().toString(),
});

describe('SecretVault（密钥安全存储）', () => {
  it('safeStorage 可用时 createSecretVault 返回可用 vault（encrypt/decrypt 往返一致）', () => {
    const vault = createSecretVault(fakeSafe(true));
    expect(vault.available).toBe(true);
    const blob = vault.encrypt('hello secret');
    expect(blob.startsWith('enc:v1:')).toBe(true);
    expect(blob).not.toContain('hello secret'); // 密文不包含明文
    expect(vault.decrypt(blob)).toBe('hello secret');
  });

  it('safeStorage 不可用时 createSecretVault 返回 UnavailableSecretVault（available=false）', () => {
    const vault = createSecretVault(fakeSafe(false));
    expect(vault.available).toBe(false);
    expect(vault).toBeInstanceOf(UnavailableSecretVault);
  });

  it('UnavailableSecretVault.encrypt 抛 SECRET_STORAGE_UNAVAILABLE（决不写入明文）', () => {
    const v = new UnavailableSecretVault();
    expect(() => v.encrypt('my-key')).toThrow(SecretStorageUnavailableError);
    try {
      v.encrypt('my-key');
    } catch (e) {
      expect((e as SecretStorageUnavailableError).code).toBe('SECRET_STORAGE_UNAVAILABLE');
    }
  });

  it('UnavailableSecretVault.decrypt 抛 SECRET_STORAGE_UNAVAILABLE', () => {
    const v = new UnavailableSecretVault();
    expect(() => v.decrypt('anything')).toThrow(SecretStorageUnavailableError);
  });

  it('Linux basic_text backend 即使声称可加密也 fail-closed', () => {
    const vault = createSecretVault({
      ...fakeSafe(true),
      getSelectedStorageBackend: () => 'basic_text',
    });
    expect(vault.available).toBe(false);
    expect(vault).toBeInstanceOf(UnavailableSecretVault);
  });

  it('safeStorage backend 探测抛错时当作不可用', () => {
    const vault = createSecretVault({
      ...fakeSafe(true),
      getSelectedStorageBackend: () => {
        throw new Error('backend unavailable');
      },
    });
    expect(vault.available).toBe(false);
  });

  it('safeStorage.isEncryptionAvailable 抛错时当作不可用', () => {
    const broken: SafeStorageLike = {
      isEncryptionAvailable: () => {
        throw new Error('keychain crashed');
      },
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    };
    const vault = createSecretVault(broken);
    expect(vault.available).toBe(false);
  });

  it('SafeStorageVault.decrypt 不能识别的 blob 格式抛错', () => {
    const vault = createSecretVault(fakeSafe(true));
    expect(() => vault.decrypt('not-a-real-blob')).toThrow(/格式无法识别/);
  });
});
