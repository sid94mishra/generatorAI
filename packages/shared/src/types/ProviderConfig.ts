/** Provider ids accepted by persisted chat, workflow and reusable-agent configuration. */
export const HARNESS_PROVIDER_IDS = ['copilot', 'claude-agent', 'codex', 'opencode', 'acp'] as const;
export type HarnessProviderId = (typeof HARNESS_PROVIDER_IDS)[number];

/** What every client calls each provider (server statuses, pickers, settings, mobile). */
export const HARNESS_PROVIDER_LABELS: Record<HarnessProviderId, string> = {
  copilot: 'GitHub Copilot',
  // The provider is the Claude Agent SDK (Claude Code), not the raw Anthropic API.
  'claude-agent': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  acp: 'ACP Agent',
};

/** A provider's display name; the synthetic test provider and unknown ids fall back to readable text. */
export function harnessProviderLabel(id: string): string {
  if (id === 'faux') return 'Faux (test)';
  return (HARNESS_PROVIDER_LABELS as Record<string, string | undefined>)[id] ?? id;
}

/**
 * How far each provider is tested (D-131). `stable` providers are served to
 * every client by default; `experimental` ones are hidden by the server until
 * an admin reveals them (Settings › Model providers, or
 * `GENERATORAI_EXPERIMENTAL_PROVIDERS=opencode,acp`).
 */
export type HarnessProviderStability = 'stable' | 'experimental';
export const HARNESS_PROVIDER_STABILITY: Record<HarnessProviderId, HarnessProviderStability> = {
  'claude-agent': 'stable',
  codex: 'stable',
  copilot: 'stable',
  opencode: 'experimental',
  acp: 'experimental',
};

/** Union across providers; model pickers should still use the live model's supported levels. */
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
