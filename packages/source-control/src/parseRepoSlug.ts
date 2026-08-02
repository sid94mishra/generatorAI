// ────────────────────────────────────────────────────────────────
// parseRepoSlug — extract { owner, repo } from a git remote URL
// ────────────────────────────────────────────────────────────────

export interface RepoSlug {
  owner: string;
  repo: string;
  /** Host (e.g. `github.com`, `ghe.acme.com`). */
  host: string;
}

/**
 * Parse a git remote URL into an owner/repo/host slug.
 * Handles HTTPS (`https://github.com/o/r.git`), SSH
 * (`git@github.com:o/r.git`), and `ssh://` forms. Returns null when the URL
 * isn't a recognizable repo URL.
 */
export function parseRepoSlug(remoteUrl: string): RepoSlug | null {
  if (!remoteUrl) return null;
  const url = remoteUrl.trim();

  // scp-like SSH: git@host:owner/repo(.git)
  const scp = url.match(/^[^@]+@([^:]+):([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (scp) {
    return { host: scp[1]!, owner: scp[2]!, repo: scp[3]! };
  }

  // https:// or ssh:// URLs
  try {
    const normalized = url.startsWith('ssh://') || url.startsWith('http')
      ? url
      : `https://${url}`;
    const parsed = new URL(normalized);
    const segments = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
    if (segments.length < 2) return null;
    const owner = segments[segments.length - 2]!;
    let repo = segments[segments.length - 1]!;
    repo = repo.replace(/\.git$/, '');
    if (!owner || !repo) return null;
    return { host: parsed.hostname, owner, repo };
  } catch {
    return null;
  }
}
