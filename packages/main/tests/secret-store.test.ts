import { describe, expect, it } from 'vitest';
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

  it('fails closed when native entry construction fails', () => {
    const vault = createSecretVault(() => { throw new Error('keychain unavailable'); });
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
