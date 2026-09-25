// @generatorai/workflow-testkit — whole-run workflow tests on a fake model.
// `engine.ts` is the engine-neutral facade; `adapters/v1.ts` holds everything
// specific to today's engine. The characterisation suite (P00 WP-0.2) lives
// in `__tests__/current-engine/`.

export {
  createTestEngine,
  type TestEngine,
  type RunHandle,
  type RunCommands,
} from './engine.js';
export {
  DEFAULT_TIMING,
  type TestEngineOptions,
  type TestEngineTiming,
  type RunSnapshot,
  type StageSnapshot,
  type CapturedEvent,
  type LogLine,
  type ApproveBody,
  type RestartOptions,
  type RunCommand,
  type CommandResult,
  type EngineAdapter,
  type AdapterContext,
  type AdapterFactory,
} from './types.js';
export { createV1Adapter } from './adapters/v1.js';
export { createV2Adapter, v2Adapter, type V2AdapterOptions } from './adapters/v2.js';
export {
  ScriptedFauxHarness,
  ScriptBook,
  classifyPrompt,
  defaultReply,
  WORK_TURN_KINDS,
  type Turn,
  type TurnKind,
  type ScriptSource,
  type ScriptedToolCall,
  type HarnessErrorLike,
  type HarnessCall,
  type StageKey,
} from './harness.js';
export { RealClock, VirtualClock, type TestClock } from './clock.js';
export { toGraph, stageKeyFor, type WorkflowSpecJson, type StageSpec, type EdgeSpec, type EdgeType } from './definitions.js';
