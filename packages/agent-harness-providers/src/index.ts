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

// ── Provider types (W41 — TYPE-ONLY: no provider module is loaded here) ──
//
// This block used to `export { CopilotProvider } from …` and so on for all six
// classes, directly under a comment warning that direct imports "bypass the
// dynamic-import/optional-dep pattern" — while doing exactly that. A static
// re-export is a static import: merely importing this barrel evaluated every
// provider module, and (before their own SDK imports were made dynamic) every
// provider SDK with them. `HarnessFactory`'s lazy loaders had nothing left to
// be lazy about, and W41's "boot loads zero provider SDK code" was false for
// all five providers in the BUILT output, not just in source.
//
// `export type` is erased by the compiler, so the names below still typecheck
// for consumers while `dist/index.js` contains no reference to them at all.
// To obtain an INSTANCE, use `createHarnessProvider()` — which is the
// documented path and now genuinely the only one through this barrel. To
// obtain a class, import its module directly (`@generatorai/agent-harness-providers/copilot`,
// `/claude-agent`, or a deep path) and accept that doing so loads it.
export type { CopilotProvider } from './providers/copilot/CopilotProvider.js';
export type { CopilotProviderOptions as CopilotProviderOptionsInternal } from './providers/copilot/CopilotProvider.js';
// W36 / P0-13 — per-workspace Copilot pool (one CLI process per cwd)
export type { WorkspacedCopilotPool } from './providers/copilot/WorkspacedCopilotPool.js';
export type { WorkspacedCopilotPoolOptions } from './providers/copilot/WorkspacedCopilotPool.js';
export type { ClaudeAgentProvider } from './providers/claude-agent/ClaudeAgentProvider.js';
export type { ClaudeAgentProviderOptions as ClaudeAgentProviderOptionsInternal } from './providers/claude-agent/types.js';

// W37 — Codex provider (JSON-RPC over stdio to `codex app-server`)
export type { CodexProvider } from './providers/codex/CodexProvider.js';
export type {
  CodexProviderOptions,
  CodexApprovalRequest,
  CodexApprovalDecision,
} from './types.js';

// W38 — OpenCode provider (HTTP+SSE to `opencode serve`)
export type { OpenCodeProvider } from './providers/opencode/OpenCodeProvider.js';
export type { OpenCodeProviderOptions } from './types.js';

// W39 — ACP breadth client (long-tail ACP-compliant agents)
export type { AcpProvider } from './providers/acp/AcpProvider.js';
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
  runFullConformance,
  type ConformanceScenario,
  type ConformanceScenarioSet,
} from './conformance/index.js';

// ── W45 — Protocol schemas ──
//
// All three protocols are now GENERATED from a real pinned upstream artifact
// by `pnpm generate:schemas`, and each emitted file records the artifact's
// sha256 so CI's `git diff --exit-code` turns upstream drift into a failing
// build rather than a runtime decode error.
//
//   ACP      → `@agentclientprotocol/sdk@1.4.0`'s own `schema/schema.json`,
//              resolved through the pinned dependency's exports map.
//   Codex    → `schemas/codex/codex_app_server_protocol.schemas.json`, produced
//              by `codex app-server generate-json-schema` from
//              `@openai/codex@0.151.0`. 686 definitions, including the whole
//              `thread/*` + `turn/*` v2 surface.
//   OpenCode → `schemas/opencode/openapi.json`, the OpenAPI 3.1 document
//              `opencode serve` publishes at `GET /doc` on `opencode-ai@1.18.25`.
//              472 schemas plus a derived operations table.
//
// The two committed artifacts replace hand-invented stand-ins that described
// vocabularies neither binary has ever spoken. See schemas/versions.json for
// the capture commands.
//
// Namespaced to keep the three flat namespaces apart: the artifacts define
// hundreds of unprefixed names (`Model`, `Session`, `RequestId`, `Part`) that
// would collide on a flat re-export.
export * as AcpProtocol from './protocol/acp.generated.js';
export * as CodexProtocol from './protocol/codex.generated.js';
export * as OpenCodeProtocol from './protocol/opencode.generated.js';

// The two tables worth reaching for directly: they are what a caller asserts
// against when it needs to know a route or method still exists upstream.
export { CODEX_METHODS } from './protocol/codex.generated.js';
export { OPENCODE_OPERATIONS } from './protocol/opencode.generated.js';

// ── W13 — Provider hardening primitives ──
// Fan-out bounds (per-item AND overall timeout), serialised approval gate,
// semantic cancellation with a grace budget, late-update generation guard,
// per-record byte cap, poison-pill downgrade, truncation execution latch and
// the append-only context ledger. Exported so callers outside this package —
// and the conformance suites — can reach them rather than each re-deriving a
// bounded fan-out.
export * from './hardening/index.js';
