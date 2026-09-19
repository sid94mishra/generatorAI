// The desktop shell can only see the embedded server's failure as text on its
// stderr, so the one string it keys off is pinned here together with the real
// message `EncryptedFileSecretStore` produces.

import { describe, expect, it } from 'vitest';
import { isVaultIntegrityFailure } from '../server-manager';

const realServerOutput =
  'Fatal: Failed to start server: SecretStoreError: Secret system/token-signing-seed ' +
  'failed integrity verification. The vault may have been tampered with, or the ' +
  'key-encryption key changed.';

describe('isVaultIntegrityFailure', () => {
  it('recognises the server message for a vault it cannot decrypt', () => {
    expect(isVaultIntegrityFailure(realServerOutput)).toBe(true);
  });

  it('ignores ordinary server output', () => {
    expect(isVaultIntegrityFailure('[Secrets] Using secret backend "env-key"')).toBe(false);
    expect(isVaultIntegrityFailure('Server listening on 127.0.0.1:54387')).toBe(false);
  });
});
