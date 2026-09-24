// @generatorai/workflow-testkit — whole-run workflow tests on a fake model.
// See `engine.ts` for what is wired and what is not, and
// `__tests__/current-engine/` for the characterisation suite (P00 WP-0.2).

export {
  createTestEngine,
  DEFAULT_TIMING,
  type TestEngine,
  type TestEngineOptions,
  type TestEngineTiming,
  type RunHandle,
  type RunSnapshot,
  type StageSnapshot,
  type CapturedEvent,
  type LogLine,
  type RunCommands,
  type ApproveBody,
  type RestartOptions,
} from './engine.js';
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
export { toImportJson, type WorkflowSpecJson, type StageSpec, type EdgeSpec, type EdgeType } from './definitions.js';
