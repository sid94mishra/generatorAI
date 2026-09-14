// ────────────────────────────────────────────────────────────────
// SourceControlRegistry — connected accounts → provider instances
// ────────────────────────────────────────────────────────────────
//
// Users can connect several accounts (multiple GitHub logins, one or more
// Enterprise hosts). Each account owns one provider instance built with that
// account's credentials. A repo picks its account by matching the remote
// host, falling back to the default account.
//
// The `register` / `setActive` / `getActive` / `getProvider` /
// `listProviderIds` methods are the pre-accounts API. They are kept so the
// existing env-token wiring in `apps/server/src/composition-root.ts` and
// `SourceControlConfigService` keep compiling while they are rewired:
//   * `register(provider)` stores a single "bare" provider that
//     `getActiveProvider()` returns **only when no accounts are registered**;
//   * `setActive('none')` disables that bare provider (accounts are
//     unaffected — they are explicit connections);
//   * `getActive()` reports `'github'` whenever a usable provider exists.

import type { SourceControlAccount } from '@generatorai/shared';
import type { ISourceControlProvider } from './ports.js';
import type { ActiveProvider, SourceControlProviderId } from './types.js';

/**
 * Hostname of an account, parsed leniently: `https://ghe.acme.com/api/v3/` →
 * `ghe.acme.com`. Accounts without a host are on the provider's public host.
 */
export function hostFromAccount(account: SourceControlAccount): string {
  return normalizeHost(account.host);
}

/** `https://GHE.acme.com/api/v3/` → `ghe.acme.com`; empty → `github.com`. */
export function normalizeHost(hostOrSlug: string | { host: string } | undefined): string {
  const raw = typeof hostOrSlug === 'string' ? hostOrSlug : hostOrSlug?.host;
  if (!raw) return 'github.com';
  const trimmed = raw.trim();
  if (!trimmed) return 'github.com';
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const withoutUser = withoutScheme.replace(/^[^/@]*@/, '');
  const hostname = (withoutUser.split('/')[0] ?? '').replace(/\/+$/, '').toLowerCase();
  if (!hostname) return 'github.com';
  return hostname.replace(/^www\./, '');
}

interface Entry {
  account: SourceControlAccount;
  provider: ISourceControlProvider;
}

export class SourceControlRegistry {
  private readonly entries = new Map<string, Entry>();
  private defaultAccountId: string | null = null;

  /** Legacy single-provider slot (see the header comment). */
  private bareProvider: ISourceControlProvider | null = null;
  private bareActive: ActiveProvider = 'none';

  // ── Accounts ──

  registerAccount(account: SourceControlAccount, provider: ISourceControlProvider): void {
    this.entries.set(account.id, { account, provider });
    if (!this.defaultAccountId) this.defaultAccountId = account.id;
  }

  removeAccount(id: string): void {
    this.entries.delete(id);
    if (this.defaultAccountId === id) {
      this.defaultAccountId = this.entries.keys().next().value ?? null;
    }
  }

  listAccounts(): SourceControlAccount[] {
    return [...this.entries.values()].map((e) => e.account);
  }

  getAccount(id: string): SourceControlAccount | null {
    return this.entries.get(id)?.account ?? null;
  }

  /** Provider for an account id. */
  providerForAccount(id: string): ISourceControlProvider | null {
    return this.entries.get(id)?.provider ?? null;
  }

  /**
   * Provider for a repo, matched by host. `hostOrSlug` is either a bare host
   * (`github.com`, `ghe.acme.com`) or a `{ host }` object (e.g. a RepoSlug).
   * Ties are broken by preferring the default account. Falls back to the
   * default account (else the first one) when nothing matches by host, and
   * returns null when no accounts are registered.
   */
  providerFor(hostOrSlug: string | { host: string }): ISourceControlProvider | null {
    return this.entryFor(hostOrSlug)?.provider ?? null;
  }

  /** Same matching as `providerFor`, returning the account. */
  accountFor(hostOrSlug: string | { host: string }): SourceControlAccount | null {
    return this.entryFor(hostOrSlug)?.account ?? null;
  }

  setDefault(id: string | null): void {
    if (id === null) {
      this.defaultAccountId = null;
      return;
    }
    if (this.entries.has(id)) this.defaultAccountId = id;
  }

  getDefaultAccountId(): string | null {
    return this.defaultAccountId;
  }

  private entryFor(hostOrSlug: string | { host: string }): Entry | null {
    if (this.entries.size === 0) return null;
    const wanted = normalizeHost(hostOrSlug);
    const matches = [...this.entries.values()].filter(
      (e) => hostFromAccount(e.account) === wanted,
    );
    if (matches.length > 0) {
      const preferred = matches.find((e) => e.account.id === this.defaultAccountId);
      return preferred ?? matches[0] ?? null;
    }
    return this.defaultEntry();
  }

  private defaultEntry(): Entry | null {
    if (this.defaultAccountId) {
      const entry = this.entries.get(this.defaultAccountId);
      if (entry) return entry;
    }
    return this.entries.values().next().value ?? null;
  }

  // ── Legacy shims (pre-accounts call sites) ──

  /**
   * Legacy: store the single env/config-configured provider. It is only used
   * by `getActiveProvider()` when no accounts have been registered.
   */
  register(provider: ISourceControlProvider): void {
    this.bareProvider = provider;
  }

  /** Legacy: `'none'` disables the bare provider. Accounts are unaffected. */
  setActive(active: ActiveProvider): void {
    this.bareActive = active;
  }

  /** Legacy: `'github'` when a usable provider exists, else `'none'`. */
  getActive(): ActiveProvider {
    return this.getActiveProvider() ? 'github' : 'none';
  }

  /** Legacy: the default account's provider, else the bare provider. */
  getActiveProvider(): ISourceControlProvider | null {
    const entry = this.defaultEntry();
    if (entry) return entry.provider;
    if (this.bareActive === 'none') return null;
    return this.bareProvider;
  }

  /** Legacy: look up by provider id across accounts and the bare provider. */
  getProvider(id: SourceControlProviderId): ISourceControlProvider | null {
    for (const entry of this.entries.values()) {
      if (entry.provider.id === id) return entry.provider;
    }
    if (this.bareProvider?.id === id && this.bareActive !== 'none') return this.bareProvider;
    return null;
  }

  /** Legacy: the distinct provider ids with at least one usable provider. */
  listProviderIds(): SourceControlProviderId[] {
    const ids = new Set<SourceControlProviderId>();
    for (const entry of this.entries.values()) ids.add(entry.provider.id);
    if (this.bareProvider && this.bareActive !== 'none') ids.add(this.bareProvider.id);
    return [...ids];
  }
}
