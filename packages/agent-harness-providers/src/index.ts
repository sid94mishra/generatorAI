// ────────────────────────────────────────────────────────────────
// @generatorai/agent-harness-providers
//
// Unified package housing all agent harness provider implementations,
// the HarnessProxy for runtime switching, and the factory for creating
// providers by type.
// ────────────────────────────────────────────────────────────────

// ── Factory & Proxy ──
export { createHarnessProvider, getAvailableProviders } from './HarnessFactory.js';
export { HarnessProxy } from './HarnessProxy.js';

// ── Multi-provider (run every installed provider side by side) ──
export {
  HarnessRegistry,
  ALL_HARNESS_TYPES,
  harnessTypeLabel,
  type HarnessProviderStatus,
  type HarnessRegistryOptions,
} from './HarnessRegistry.js';
export { MultiHarness, type ConversationOwnershipStore } from './MultiHarness.js';

// ── Types ──
export type {
  HarnessType,
  HarnessProviderConfig,
  CopilotProviderOptions,
  ClaudeAgentProviderOptions,
  HarnessFactoryOptions,
} from './types.js';

// ── Child-process environment isolation ──
// A harness runs model-authored tool calls, so its environment is built from
// an explicit allowlist rather than cloned from this process. See childEnv.ts.
export {
  buildHarnessEnv,
  isBlockedHarnessEnvVar,
  HARNESS_ENV_ALLOWLIST,
  type HarnessEnvOptions,
} from './childEnv.js';

// ── Provider direct exports (for advanced use cases) ──
// NOTE: Prefer using createHarnessProvider() over direct imports.
// Direct imports bypass the dynamic-import/optional-dep pattern.
export { CopilotProvider } from './providers/copilot/index.js';
export type { CopilotProviderOptions as CopilotProviderOptionsInternal } from './providers/copilot/index.js';
export { ClaudeAgentProvider } from './providers/claude-agent/index.js';
export type { ClaudeAgentProviderOptions as ClaudeAgentProviderOptionsInternal } from './providers/claude-agent/index.js';
