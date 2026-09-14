// ────────────────────────────────────────────────────────────────
// providerFactory — build a provider instance for one account
// ────────────────────────────────────────────────────────────────
//
// The extension point for future hosts: implement `ISourceControlProvider`
// and add a case here keyed by `SourceControlProviderId`.

import type { ILogger } from '@generatorai/shared';
import { GitHubProvider } from './GitHubProvider.js';
import type { IScmHttpClient, IScmProcessRunner, ISourceControlProvider } from './ports.js';
import type { SourceControlProviderId } from './types.js';

export interface ProviderFactoryDeps {
  http: IScmHttpClient;
  logger: ILogger;
  processRunner?: IScmProcessRunner;
}

/** Construct the provider for `id` with one account's credentials. */
export function createProvider(
  id: SourceControlProviderId,
  creds: { token?: string; host?: string },
  deps: ProviderFactoryDeps,
): ISourceControlProvider {
  switch (id) {
    case 'github':
      return new GitHubProvider(
        deps.http,
        deps.logger,
        { token: creds.token, host: creds.host, allowCliFallback: true },
        deps.processRunner,
      );
    default:
      throw new Error(`Unknown source-control provider: ${String(id)}`);
  }
}
