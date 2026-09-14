// ────────────────────────────────────────────────────────────────
// redactTokens — strip VCS host credentials out of user-facing text
// ────────────────────────────────────────────────────────────────
//
// Git and the `gh` CLI happily echo a remote URL (which may embed a token)
// or an API error body back through stderr. Every string this feature puts
// into a response — error messages above all — goes through here first.

/** GitHub token shapes: `ghp_/gho_/ghu_/ghs_/ghr_…` and fine-grained `github_pat_…`. */
const TOKEN_RE = /gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}/g;

/** Replace anything that looks like a host token with `***`. */
export function redactTokens(value: string): string {
  if (!value) return value;
  return value.replace(TOKEN_RE, '***');
}
