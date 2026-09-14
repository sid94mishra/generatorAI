// ────────────────────────────────────────────────────────────────
// RepoReadinessService — "can this mount commit / push / open a PR?"
// ────────────────────────────────────────────────────────────────
//
// One read-only pass over a repo directory producing the shared
// `RepoReadiness`: repo/remote/branch/default-branch/dirty/ahead-behind/merge
// state from git, the matching connected account from the registry, and the
// open PR for the branch when the host is connected.
//
// Every "can't" carries a user-facing reason (doc §3). Nothing here throws:
// a git probe that fails degrades to its default so the UI still renders.

import type { ILogger, RepoReadiness, SourceControlSettings } from '@generatorai/shared';
import type { IGitClient } from '@generatorai/git';
import { parseRepoSlug, type SourceControlRegistry } from '@generatorai/source-control';

export interface RepoReadinessDeps {
  git: IGitClient;
  registry: SourceControlRegistry;
  logger: ILogger;
  /** Live settings (for `defaultBase`). */
  settings: () => SourceControlSettings;
}

// ── Reason strings. These are user-facing contract (doc §3) — do not reword. ──
export const REASON_NOT_A_REPO = 'Not a git repository';
export const REASON_NOTHING_TO_COMMIT = 'Nothing to commit';
export const REASON_MERGE_IN_PROGRESS = 'Merge in progress — resolve conflicts first';
export const REASON_NO_REMOTE_PUSH = 'No git remote configured';
export const REASON_NO_REMOTE_PR = 'No git remote';
export const REASON_DETACHED = 'Detached HEAD';
export const REASON_NOTHING_TO_PROPOSE =
  'Nothing to open a PR from (branch has no commits ahead of base)';

export function notConnectedReason(host: string): string {
  return `Remote host ${host} is not connected — connect it in Settings → Source Control`;
}

export class RepoReadinessService {
  constructor(private readonly deps: RepoReadinessDeps) {}

  async readiness(input: { repoDir: string; alias: string }): Promise<RepoReadiness> {
    const { repoDir, alias } = input;
    const { git } = this.deps;

    const isRepo = await this.safe(() => git.isGitRepo(repoDir), false);
    if (!isRepo) {
      return {
        alias,
        repoDir,
        isRepo: false,
        hasRemote: false,
        connected: false,
        branch: null,
        detached: false,
        defaultBranch: null,
        onDefaultBranch: false,
        dirty: false,
        changedFiles: 0,
        ahead: null,
        behind: null,
        hasUpstream: false,
        mergeInProgress: false,
        conflictedFiles: [],
        openPullRequest: null,
        can: { commit: false, push: false, pullRequest: false },
        reasons: {
          commit: REASON_NOT_A_REPO,
          push: REASON_NOT_A_REPO,
          pullRequest: REASON_NOT_A_REPO,
        },
      };
    }

    const remoteUrl = await this.safe(() => git.getRemoteUrl(repoDir), null);
    const hasRemote = Boolean(remoteUrl);
    const slug = remoteUrl ? parseRepoSlug(remoteUrl) : null;
    const account = slug ? this.deps.registry.accountFor(slug.host) : null;
    const connected = slug ? this.deps.registry.providerFor(slug.host) !== null : false;

    const branch = await this.safe(() => git.currentBranch(repoDir), null);
    const detached = await this.safe(() => git.isDetached(repoDir), false);
    const settingsBase = this.deps.settings().defaultBase;
    const defaultBranch =
      (await this.safe(() => git.defaultBranch(repoDir), null)) ?? settingsBase ?? null;
    const onDefaultBranch = branch !== null && branch === defaultBranch;

    const changed = await this.safe(() => git.changedFilesSummary(repoDir), []);
    const changedFiles = changed.length;
    const dirty = changedFiles > 0;

    const upstream = branch ? await this.safe(() => git.upstreamOf(repoDir, branch), null) : null;
    const hasUpstream = upstream !== null;
    let ahead: number | null = null;
    let behind: number | null = null;
    if (branch && upstream) {
      const counts = await this.safe(() => git.aheadBehind(repoDir, branch, upstream), null);
      ahead = counts?.ahead ?? null;
      behind = counts?.behind ?? null;
    } else if (branch && defaultBranch && hasRemote) {
      // No upstream yet (a freshly cut branch): compare against the remote
      // default branch so "ahead" is still meaningful for the PR decision.
      const counts = await this.safe(
        () => git.aheadBehind(repoDir, branch, `origin/${defaultBranch}`),
        null,
      );
      ahead = counts?.ahead ?? null;
      behind = counts?.behind ?? null;
    }

    // Commits this branch would bring into the base — the number a PR is
    // actually about. `ahead` above is relative to the upstream (an already
    // pushed work branch reads 0/0 there while still being ahead of main).
    let aheadOfBase: number | null = null;
    if (branch && defaultBranch && hasRemote && branch !== defaultBranch) {
      const counts = await this.safe(
        () => git.aheadBehind(repoDir, branch, `origin/${defaultBranch}`),
        null,
      );
      aheadOfBase = counts?.ahead ?? null;
    }

    const mergeInProgress = await this.safe(() => git.mergeInProgress(repoDir), false);
    const conflictedFiles = await this.safe(() => git.unmergedFiles(repoDir), []);

    let openPullRequest: RepoReadiness['openPullRequest'] = null;
    if (connected && slug && branch) {
      try {
        const provider = this.deps.registry.providerFor(slug.host);
        openPullRequest =
          (await provider?.findOpenPullRequestForHead(slug.owner, slug.repo, branch, slug.host)) ??
          null;
      } catch (err) {
        this.deps.logger.debug(
          `[SCM] Could not look up the open PR for ${branch}: ${err instanceof Error ? err.message : String(err)}`,
        );
        openPullRequest = null;
      }
    }

    // ── can / reasons ──
    const can = { commit: true, push: true, pullRequest: true };
    const reasons: RepoReadiness['reasons'] = {};

    if (mergeInProgress) {
      // Takes priority over "nothing to commit": the merge must be finished first.
      can.commit = false;
      reasons.commit = REASON_MERGE_IN_PROGRESS;
    } else if (!dirty) {
      can.commit = false;
      reasons.commit = REASON_NOTHING_TO_COMMIT;
    }

    if (!hasRemote) {
      can.push = false;
      reasons.push = REASON_NO_REMOTE_PUSH;
    }

    if (!hasRemote) {
      can.pullRequest = false;
      reasons.pullRequest = REASON_NO_REMOTE_PR;
    } else if (!connected) {
      can.pullRequest = false;
      reasons.pullRequest = notConnectedReason(slug?.host ?? 'unknown');
    } else if (detached) {
      can.pullRequest = false;
      reasons.pullRequest = REASON_DETACHED;
    } else if (!dirty && !openPullRequest && nothingToPropose(branch === defaultBranch, ahead, aheadOfBase)) {
      can.pullRequest = false;
      reasons.pullRequest = REASON_NOTHING_TO_PROPOSE;
    }

    return {
      alias,
      repoDir,
      isRepo: true,
      hasRemote,
      ...(remoteUrl ? { remoteUrl } : {}),
      ...(slug ? { slug } : {}),
      ...(account ? { providerId: account.provider, accountId: account.id } : {}),
      connected,
      branch,
      detached,
      defaultBranch,
      onDefaultBranch,
      dirty,
      changedFiles,
      ahead,
      behind,
      hasUpstream,
      mergeInProgress,
      conflictedFiles,
      openPullRequest,
      can,
      reasons,
    };
  }

  /** Run a git probe, degrading to `fallback` instead of failing the whole call. */
  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.deps.logger.debug(
        `[SCM] Readiness probe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    }
  }
}

/**
 * On the default branch only unpushed local commits can seed a PR (the flow
 * cuts a work branch from them); elsewhere it is the commits ahead of the
 * remote base. An unknown count never blocks — the flow re-checks.
 */
function nothingToPropose(onDefault: boolean, ahead: number | null, aheadOfBase: number | null): boolean {
  if (onDefault) return ahead === 0;
  return aheadOfBase === 0;
}
