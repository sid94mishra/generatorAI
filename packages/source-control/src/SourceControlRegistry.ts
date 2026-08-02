// ────────────────────────────────────────────────────────────────
// SourceControlRegistry — resolves the active provider from config
// ────────────────────────────────────────────────────────────────

import type { ISourceControlProvider } from './ports.js';
import type { ActiveProvider, SourceControlProviderId } from './types.js';

/**
 * Holds the set of available providers and the active selection. When the
 * active provider is `none`, `getActiveProvider()` returns null and callers
 * should treat host operations (PRs) as disabled.
 */
export class SourceControlRegistry {
  private readonly providers = new Map<SourceControlProviderId, ISourceControlProvider>();
  private active: ActiveProvider = 'none';

  register(provider: ISourceControlProvider): void {
    this.providers.set(provider.id, provider);
  }

  setActive(provider: ActiveProvider): void {
    this.active = provider;
  }

  getActive(): ActiveProvider {
    return this.active;
  }

  /** The active provider instance, or null when disabled / unavailable. */
  getActiveProvider(): ISourceControlProvider | null {
    if (this.active === 'none') return null;
    return this.providers.get(this.active) ?? null;
  }

  getProvider(id: SourceControlProviderId): ISourceControlProvider | null {
    return this.providers.get(id) ?? null;
  }

  listProviderIds(): SourceControlProviderId[] {
    return [...this.providers.keys()];
  }
}
