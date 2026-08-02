// ────────────────────────────────────────────────────────────────
// SourceControlService — single entry point for VCS-host (PR) operations
// ────────────────────────────────────────────────────────────────
//
// Ties the pluggable source-control provider registry to the local git
// client: resolves owner/repo from the repo's remote, the head branch from
// the working copy, then delegates PR creation/listing to the active
// provider. When no provider is enabled it throws ProviderNotConfiguredError.

import type { ILogger } from '@generatorai/shared';
import type { IGitClient } from '@generatorai/git';
import {
  ProviderNotConfiguredError,
  SourceControlError,
  parseRepoSlug,
  type SourceControlRegistry,
  type PullRequest,
  type ChecksSummary,
  type ActiveProvider,
} from '@generatorai/source-control';

export interface CreatePrParams {
  repoDir: string;
  title: string;
  body?: string;
  base?: string;
  head?: string;
  draft?: boolean;
}

export class SourceControlService {
  constructor(
    private readonly registry: SourceControlRegistry,
    private readonly git: IGitClient,
    private readonly logger: ILogger,
  ) {}

  getActiveProviderId(): ActiveProvider {
    return this.registry.getActive();
  }

  async isEnabled(): Promise<boolean> {
    const provider = this.registry.getActiveProvider();
    if (!provider) return false;
    try {
      return await provider.isConfigured();
    } catch {
      return false;
    }
  }

  /** Create a PR for a local repo directory using the active provider. */
  async createPullRequest(params: CreatePrParams): Promise<PullRequest> {
    const provider = this.registry.getActiveProvider();
    if (!provider) {
      throw new ProviderNotConfiguredError();
    }

    const slug = await this.resolveSlug(params.repoDir);
    const head = params.head ?? (await this.git.currentBranch(params.repoDir));
    if (!head) {
      throw new SourceControlError(
        `Cannot determine the head branch for ${params.repoDir} (detached HEAD?)`,
      );
    }

    const pr = await provider.createPullRequest({
      owner: slug.owner,
      repo: slug.repo,
      host: slug.host,
      head,
      base: params.base,
      title: params.title,
      body: params.body,
      draft: params.draft,
      repoDir: params.repoDir,
    });
    this.logger.info(`[SCM] Created PR #${pr.number} for ${slug.owner}/${slug.repo}: ${pr.url}`);
    return pr;
  }

  /** List PRs for the repo backing `repoDir`. */
  async listPullRequests(repoDir: string): Promise<PullRequest[]> {
    const provider = this.registry.getActiveProvider();
    if (!provider) throw new ProviderNotConfiguredError();
    const slug = await this.resolveSlug(repoDir);
    return provider.listPullRequests({ owner: slug.owner, repo: slug.repo, host: slug.host });
  }

  /** Status checks summary for a PR number. */
  async getStatusChecks(repoDir: string, prNumber: number): Promise<ChecksSummary> {
    const provider = this.registry.getActiveProvider();
    if (!provider) throw new ProviderNotConfiguredError();
    const slug = await this.resolveSlug(repoDir);
    return provider.getStatusChecks({
      owner: slug.owner,
      repo: slug.repo,
      host: slug.host,
      number: prNumber,
    });
  }

  private async resolveSlug(
    repoDir: string,
  ): Promise<{ owner: string; repo: string; host: string }> {
    const remote = await this.git.getRemoteUrl(repoDir);
    if (!remote) {
      throw new SourceControlError(`No git remote configured for ${repoDir}`);
    }
    const slug = parseRepoSlug(remote);
    if (!slug) {
      throw new SourceControlError(`Could not parse a repo slug from remote: ${remote}`);
    }
    return slug;
  }
}
