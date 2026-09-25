// @generatorai/workflow-testkit — whole-run workflow tests on a fake model.
// `engine.ts` is the facade; `adapters/v2.ts` holds everything specific to
// the engine. The scenario suite (T1–T8, P00 WP-0.2, flipped at the P03
// cutover) lives in `__tests__/engine/`.

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
