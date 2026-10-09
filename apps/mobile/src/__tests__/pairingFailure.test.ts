import { describe, expect, it } from 'vitest';

import { CERTIFICATE_MISMATCH_MESSAGE, LOCAL_NETWORK_HINT, classifyPairingFailure, shouldAutoRetryPairing } from '../services/auth/pairingFailure';

describe('classifyPairingFailure', () => {
  it('treats transport failures as retryable with the local-network hint', () => {
    for (const error of [
      new TypeError('Network request failed'),
      new Error('Could not verify the paired server identity. http://192.168.1.20:3100 is unreachable'),
      Object.assign(new Error('No reachable endpoint. Tried: direct (timeout)'), { name: 'NoReachableEndpointError' }),
      Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
    ]) {
      const failure = classifyPairingFailure(error);
      expect(failure).toEqual({ kind: 'network', message: LOCAL_NETWORK_HINT, retryable: true });
    }
  });

  it('names a refused certificate, a denied Local Network and a plain-HTTP offer (MD-202)', () => {
    expect(classifyPairingFailure(Object.assign(new Error('Could not verify the paired server identity.'), { problem: 'certificate-changed' }))).toEqual({
      kind: 'certificate',
      message: CERTIFICATE_MISMATCH_MESSAGE,
      retryable: false,
    });
    expect(classifyPairingFailure(Object.assign(new Error('Network request failed'), { problem: 'local-network-denied' }))).toMatchObject({
      kind: 'local-network',
      retryable: true,
    });
    const insecure = Object.assign(new Error('http://192.168.1.2:3100 is not encrypted.'), { name: 'InsecureEndpointError' });
    expect(classifyPairingFailure(insecure)).toMatchObject({ kind: 'insecure', retryable: false });
  });

  it('never retries a server rejection', () => {
    expect(classifyPairingFailure(new Error('Pairing failed: pairing token expired'))).toEqual({
      kind: 'rejected',
      message: 'Pairing failed: pairing token expired',
      retryable: false,
    });
  });

  it('never retries an identity change, even when an endpoint was unreachable', () => {
    const error = Object.assign(new Error('The server identity at this address changed.'), {
      name: 'HostIdentityChangedError',
    });
    expect(classifyPairingFailure(error)).toMatchObject({ kind: 'identity', retryable: false });
  });

  it('passes unknown errors through unchanged and not retryable', () => {
    expect(classifyPairingFailure(new Error('Secure Enclave full'))).toMatchObject({
      kind: 'rejected',
      message: 'Secure Enclave full',
      retryable: false,
    });
  });
});

describe('shouldAutoRetryPairing', () => {
  const network = classifyPairingFailure(new TypeError('Network request failed'));
  const base = { failure: network, autoRetried: false, interrupted: true, appState: 'active' };

  it('retries once the app is active again after the permission prompt', () => {
    expect(shouldAutoRetryPairing(base)).toBe(true);
  });

  it('waits while the prompt is still up', () => {
    expect(shouldAutoRetryPairing({ ...base, appState: 'inactive' })).toBe(false);
  });

  it('does not retry twice, uninterrupted attempts, or non-network failures', () => {
    expect(shouldAutoRetryPairing({ ...base, autoRetried: true })).toBe(false);
    expect(shouldAutoRetryPairing({ ...base, interrupted: false })).toBe(false);
    expect(
      shouldAutoRetryPairing({ ...base, failure: classifyPairingFailure(new Error('Pairing failed: nope')) }),
    ).toBe(false);
    expect(shouldAutoRetryPairing({ ...base, failure: null })).toBe(false);
  });
});
