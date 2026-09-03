// ────────────────────────────────────────────────────────────────
// The chat-surface e2e tests (tui-e2e.test.tsx's "TUI · chat surface" suite,
// chat-probe.test.ts) exercise a real chat with real history and a real
// model catalog — they are developer probes against a live, already-running
// GeneratorAI server, not hermetic CI tests. Building a fake or in-process
// real server for them was considered and explicitly deferred (see
// docs/CLI_TUI_PARITY_TRACKER.md, Phase 1 backlog) in favor of the smaller,
// honest fix: skip cleanly with a visible reason when nothing is listening,
// rather than fail with a raw "fetch failed" that looks like a product bug.
//
// This still "just works" for a developer running `pnpm dev:server` locally
// on the default port — the probe is a real reachability check, not just an
// env var — while making an unattended CI run report SKIPPED instead of
// FAILED for a dependency it was never going to have.
// ────────────────────────────────────────────────────────────────

/** Fast, best-effort: never throws, never waits longer than `timeoutMs`. */
export async function probeLiveServer(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}
