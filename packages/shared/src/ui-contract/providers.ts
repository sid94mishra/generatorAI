// ────────────────────────────────────────────────────────────────
// Agent providers (harness types) and their display names — the same words
// the server's `harnessTypeLabel` uses, so a provider is named identically in
// the model picker, the transcript's empty state and settings (web + mobile).
// ────────────────────────────────────────────────────────────────

export const HARNESS_PROVIDERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'copilot', label: 'GitHub Copilot' },
  { id: 'claude-agent', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'acp', label: 'ACP Agent' },
];

/** Human label for a harness/agent provider id; the id itself when unknown. */
export function harnessProviderLabel(id: string): string {
  return HARNESS_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}
