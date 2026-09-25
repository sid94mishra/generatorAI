// ────────────────────────────────────────────────────────────────
// @generatorai/sdk/internal — ADVANCED / UNSTABLE surface
//
// ⚠️  Everything exported here is the raw core service graph: the service
//     classes the facades wrap, the repository ports, the DAG utilities, and
//     the CoreServices container type. It is exposed for power users who need
//     to compose the engine directly (custom transports, bespoke wiring, tests).
//
// ⚠️  This surface is NOT covered by the SDK's semver contract. It can change —
//     including breaking changes — in any MINOR release. If you depend on it,
//     pin an exact SDK version. The stable, supported API is the facades on the
//     `GeneratorAI` instance (`ai.workflows`, `ai.chat`, …) exported from the
//     package root. See API-STABILITY.md.
// ────────────────────────────────────────────────────────────────

// ── Core Services container ──
export type { CoreServices, CoreServicesInputs } from '@generatorai/core';

// ── Repository / infrastructure ports (custom implementations) ──
export type {
  ISessionRepository,
  IEventRepository,
  IChatMessageRepository,
  IArtifactRepository,
  IChatRepository,
  IWorkflowDefinitionRepository,
  IStageDefinitionRepository,
  IStageEdgeRepository,
  IWorkflowRunRepository,
  IStageRunRepository,
  IScriptRunner,
  IHttpClient,
  ISandboxProvider,
  ISequenceAllocator,
} from '@generatorai/core';

// ── Service classes (advanced composition) ──
export {
  WorkflowOrchestrator,
  StreamBroker,
  ProjectService,
  CodebaseService,
  WorktreeService,
  ProjectConfigService,
  WorkspaceManager,
  HitlService,
  WorkflowScriptLoader,
  CustomToolRegistry,
  InMemoryMcpHub,
} from '@generatorai/core';

export type {
  StreamScope,
  StreamEventHandler,
  WorkspaceManagerConfig,
  ScriptMetadata,
  LoadedScript,
} from '@generatorai/core';

// ── DAG utilities ──
export {
  buildDAG,
  validateDAG,
  topologicalSort,
  getExecutionLayers,
  evaluateCondition,
} from '@generatorai/core';
