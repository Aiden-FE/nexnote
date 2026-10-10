import { afterEach, describe, expect, it } from 'vitest';
import { setCurrentLanguage } from '@nexnote/shared';
import {
  createSecretVault,
  decryptLegacySafeStorage,
  KeyringSecretVault,
  SecretStorageUnavailableError,
  type KeyringEntryLike,
  type SafeStorageLike,
} from '../src/ai/secret-store';

function fakeEntries(): { factory: (account: string) => KeyringEntryLike; values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    factory: (account) => ({
      setPassword: (secret) => values.set(account, secret),
      getPassword: () => values.get(account) ?? null,
      deleteCredential: () => values.delete(account),
    }),
  };
}

const legacySafe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (value) => value.toString(),
  getSelectedStorageBackend: () => 'OSCrypt',
};

describe('SecretVault', () => {
  it('stores, retrieves, and deletes credentials through a native entry', () => {
    const fake = fakeEntries();
    const vault = new KeyringSecretVault(fake.factory);
    vault.put('account', 'secret');
    expect(vault.get('account')).toBe('secret');
    vault.delete('account');
    expect(vault.get('account')).toBeNull();
  });

  it('fails closed when native entry construction fails', async () => {
    const vault = await createSecretVault(() => { throw new Error('keychain unavailable'); });
    expect(vault.available).toBe(false);
    expect(() => vault.put('account', 'secret')).toThrow(SecretStorageUnavailableError);
  });

  it('decrypts legacy safeStorage payloads only when OSCrypt is available', () => {
    const blob = `enc:v1:${Buffer.from('legacy-secret').toString('base64')}`;
    expect(decryptLegacySafeStorage(blob, legacySafe)).toBe('legacy-secret');
    expect(() => decryptLegacySafeStorage(blob, { ...legacySafe, getSelectedStorageBackend: () => 'basic_text' }))
      .toThrow(SecretStorageUnavailableError);
  });
});

describe('ADR-0023 secret store message language authority', () => {
  afterEach(() => setCurrentLanguage('zh-CN'));

  it('renders the unavailable / unrecognized-blob messages in the active language', () => {
    setCurrentLanguage('en-US');
    expect(new SecretStorageUnavailableError().message).toBe(
      'The system credential store is unavailable, so the API key cannot be saved safely; enable the system keychain and try again',
    );
    expect(() => decryptLegacySafeStorage('not-a-legacy-blob', legacySafe)).toThrow(
      'Unrecognized legacy credential blob',
    );

    setCurrentLanguage('zh-CN');
    expect(new SecretStorageUnavailableError().message).toBe(
      '系统凭据存储不可用，无法安全保存 API Key；请启用系统钥匙串后重试',
    );
    expect(() => decryptLegacySafeStorage('not-a-legacy-blob', legacySafe)).toThrow(
      '无法识别的 legacy credential blob',
    );
  });
});
