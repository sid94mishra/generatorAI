/** Provider ids accepted by persisted chat, workflow and reusable-agent configuration. */
export const HARNESS_PROVIDER_IDS = ['copilot', 'claude-agent', 'codex', 'opencode', 'acp'] as const;
export type HarnessProviderId = (typeof HARNESS_PROVIDER_IDS)[number];

/** Union across providers; model pickers should still use the live model's supported levels. */
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
