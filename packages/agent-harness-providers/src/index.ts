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
export {
  ProviderInstanceRegistry,
  type ProviderInstanceStore,
} from './ProviderInstanceRegistry.js';

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

// ── Orphan reaping (P0-14 / X-22) ──
export {
  reapOrphanedHarnessChildren,
  killOwnDescendants,
  startChildReaperHeartbeat,
  stopChildReaperHeartbeat,
  SPAWN_BOOT_ID,
  SPAWN_MARKER_ENV,
  PARENT_PID_ENV,
  type ServerLivenessRecord,
  type ReapResult,
} from './childRegistry.js';

// ── Provider direct exports (for advanced use cases) ──
// NOTE: Prefer using createHarnessProvider() over direct imports.
// Direct imports bypass the dynamic-import/optional-dep pattern.
export { CopilotProvider } from './providers/copilot/index.js';
export type { CopilotProviderOptions as CopilotProviderOptionsInternal } from './providers/copilot/index.js';
// W36 / P0-13 — per-workspace Copilot pool (one CLI process per cwd)
export { WorkspacedCopilotPool } from './providers/copilot/index.js';
export type { WorkspacedCopilotPoolOptions } from './providers/copilot/index.js';
export { ClaudeAgentProvider } from './providers/claude-agent/index.js';
export type { ClaudeAgentProviderOptions as ClaudeAgentProviderOptionsInternal } from './providers/claude-agent/index.js';

// W37 — Codex provider (JSON-RPC over stdio to `codex app-server`)
export { CodexProvider } from './providers/codex/index.js';
export type { CodexProviderOptions } from './types.js';

// W38 — OpenCode provider (HTTP+SSE to `opencode serve`)
export { OpenCodeProvider } from './providers/opencode/index.js';
export type { OpenCodeProviderOptions } from './types.js';

// W39 — ACP breadth client (long-tail ACP-compliant agents)
export { AcpProvider } from './providers/acp/index.js';
export type { AcpProviderOptions } from './types.js';

// ── W12 — Agent Host Supervisor ──
// Bounds concurrent provider spawns via execution/cold-start semaphores.
// In-process mode (Phase 3); out-of-process mode behind a flag (Phase 4).
export {
  AgentHostSupervisor,
  defaultAgentHostSupervisor,
  type AgentHostSupervisorOptions,
  type AgentHostSnapshot,
} from './AgentHostSupervisor.js';

// ── W44 — Faux provider & conformance suites ──
// Deterministic test double for IAgentHarness. Ship in the package (not test
// files) so any consumer's test suite can use it without path hacks.
export {
  FauxProvider,
  type FauxScriptEntry,
  type FauxTextEntry,
  type FauxToolCallEntry,
  type FauxToolErrorEntry,
  type FauxCompleteEntry,
  type FauxCancelledEntry,
  type FauxTruncatedEntry,
  type FauxErrorEntry,
  type FauxExhaustedEntry,
} from './providers/faux/FauxProvider.js';
export {
  runConversationLifecycleConformance,
  runToolCallConformance,
  runCancellationConformance,
  runTruncationConformance,
  runCapabilityDeclarationConformance,
} from './conformance/index.js';

// ── W45 — Generated protocol schemas ──
// AUTO-GENERATED types for ACP, OpenCode, and Codex protocols.
// L18: never hand-written — generated from pinned upstream artifacts.
// Regenerate with: pnpm generate:schemas
export * from './protocol/acp.generated.js';
export * from './protocol/opencode.generated.js';
export * from './protocol/codex.generated.js';
