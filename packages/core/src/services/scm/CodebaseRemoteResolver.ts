// ────────────────────────────────────────────────────────────────
// CodebaseRemoteResolver — a project codebase → its host repository and the
// connected account's provider, or the reason there is none.
//
// One resolution for every "talk to the host about this codebase" caller:
// the project PR / issue routes and the agent's GitHub tools. Every failure
// is phrased for the user (link a remote, connect an account), never a bare
// error, and `host` is set only when the fix is "connect this host" — the
// routes answer that one with 409 SCM_NOT_CONNECTED.
// ────────────────────────────────────────────────────────────────

import type { ProjectCodebase } from '@generatorai/shared';
import { parseRepoSlug, type ISourceControlProvider } from '@generatorai/source-control';
import { redactTokens } from './redact.js';

export interface CodebaseRemoteDeps {
  git: { getRemoteUrl(repoDir: string): Promise<string | null> };
  registry: { providerFor(host: string): ISourceControlProvider | null };
}

export interface RepoSlugRef {
  owner: string;
  repo: string;
  host: string;
}

export type ResolvedCodebaseRemote =
  | { ok: true; repoDir: string; slug: RepoSlugRef; provider: ISourceControlProvider }
  | { ok: false; reason: string; host?: string };

/** Where a codebase's git repository actually lives on this host. */
export function codebaseRepoDir(codebase: Pick<ProjectCodebase, 'clonePath' | 'localPath'>): string | null {
  return codebase.clonePath || codebase.localPath || null;
}

export class CodebaseRemoteResolver {
  constructor(private readonly deps: CodebaseRemoteDeps) {}

  async resolve(codebase: Pick<ProjectCodebase, 'clonePath' | 'localPath'>): Promise<ResolvedCodebaseRemote> {
    const repoDir = codebaseRepoDir(codebase);
    if (!repoDir) return { ok: false, reason: 'This codebase has no local checkout yet' };

    let remoteUrl: string | null = null;
    try {
      remoteUrl = await this.deps.git.getRemoteUrl(repoDir);
    } catch (err) {
      return { ok: false, reason: redactTokens(err instanceof Error ? err.message : String(err)) };
    }
    if (!remoteUrl) return { ok: false, reason: 'No git remote configured' };

    const slug = parseRepoSlug(remoteUrl);
    if (!slug) return { ok: false, reason: 'The git remote is not a recognisable repository URL' };

    const provider = this.deps.registry.providerFor(slug.host);
    if (!provider) {
      return {
        ok: false,
        host: slug.host,
        reason: `Remote host ${slug.host} is not connected — connect it in Settings → Source Control`,
      };
    }
    return { ok: true, repoDir, slug: { owner: slug.owner, repo: slug.repo, host: slug.host }, provider };
  }
}
