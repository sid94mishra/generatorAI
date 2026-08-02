import { describe, it, expect } from 'vitest';

import { credentialFailure } from '../HarnessRegistry.js';

/**
 * Regression coverage for "logged-in provider reported as logged out".
 *
 * The probe used to be:
 *
 *   const tokenSource = account.tokenSource ?? 'none';
 *   const hasKey = !!account.apiKeySource && account.apiKeySource !== 'none';
 *   if (tokenSource === 'none' && !hasKey) -> "Not logged in"
 *
 * which treats an ABSENT field as proof of being logged out. The Claude SDK's
 * initialization result reports `{ email, organization, subscriptionType,
 * apiProvider }` and never populates `tokenSource`/`apiKeySource`, so a fully
 * authenticated Claude Enterprise account was marked "Not logged in", had its
 * model catalog emptied, and was locked out of the model picker.
 */
describe('credentialFailure', () => {
  it('accepts the real Claude Enterprise account shape (no tokenSource at all)', () => {
    expect(
      credentialFailure({
        email: 'user@example.com',
        organization: 'Example Org',
        subscriptionType: 'Claude Enterprise',
        apiProvider: 'firstParty',
      }),
    ).toBeUndefined();
  });

  it('treats an explicit tokenSource=none with no identity as logged out', () => {
    expect(credentialFailure({ tokenSource: 'none' })).toMatch(/not logged in/i);
  });

  it('does NOT treat an empty probe as logged out', () => {
    // "The CLI told us nothing" is not evidence of anything. Falling back to
    // the catalog verdict is the safe read.
    expect(credentialFailure({})).toBeUndefined();
  });

  it('accepts an explicit token source', () => {
    expect(credentialFailure({ tokenSource: 'oauth' })).toBeUndefined();
  });

  it('accepts an API key even when tokenSource says none', () => {
    // Key-based auth is legitimate; the token channel being unused is normal.
    expect(
      credentialFailure({ tokenSource: 'none', apiKeySource: 'ANTHROPIC_API_KEY' }),
    ).toBeUndefined();
  });

  it('ignores an apiKeySource of "none"', () => {
    expect(credentialFailure({ tokenSource: 'none', apiKeySource: 'none' })).toMatch(
      /not logged in/i,
    );
  });

  it.each([
    ['email', { email: 'a@b.c' }],
    ['organization', { organization: 'Acme' }],
    ['subscriptionType', { subscriptionType: 'Pro' }],
    ['apiProvider', { apiProvider: 'firstParty' }],
  ])('treats a named %s as proof a credential resolved', (_label, account) => {
    // The CLI could not have named any of these without resolving a credential,
    // so each one individually overrides a stale `tokenSource: 'none'`.
    expect(credentialFailure({ tokenSource: 'none', ...account })).toBeUndefined();
  });
});
