// Engine v2 (P03 WP-3.5/3.6): the executor, the per-run actor and the
// supervisor that hosts them, with its timers, lease reaper, outbox and
// lifecycle effects, plus the stage conversation API (P03b).
export {
  StageExecutor,
  journalEpoch,
  DEFAULT_EXECUTOR_TIMING,
  type StageExecutorDeps,
  type ExecutorTiming,
  type LaunchRequest,
  type AbortReason,
  type StageArtifactReader,
  type StageFrameState,
} from './StageExecutor.js';
export {
  StageConversationService,
  type StageConversationServiceDeps,
  type StageMessage,
  type StageSendOutcome,
  type StageGateAnswer,
} from './StageConversationService.js';
export { StageConversationError, type StageConversationErrorCode } from './StageConversationError.js';
export {
  chooseStrategies,
  extractStructured,
  lastJsonBlock,
  checkOutputContract,
  validateAgainstSchema,
  repairMessage,
  createSubmitOutputTool,
  SUBMIT_OUTPUT_TOOL_NAME,
  type ExtractionStrategy,
  type OutputContractInput,
  type TurnOutputs,
  type ContractResult,
  type StrategyChoice,
} from './OutputExtractor.js';
export { describeRule, evaluateOutputRule, extractJsonValue, type RuleContext } from './outputRules.js';
export { RunActor, stateHash, type ProcessResult, type DecideRecord, type RunActorDeps } from './RunActor.js';
export {
  RunSupervisor,
  EngineLockedError,
  DEFAULT_SUPERVISOR_TIMING,
  type RunSupervisorDeps,
  type SupervisorTiming,
  type CommandResult,
} from './RunSupervisor.js';
export { TimerService, type ScheduledTimer } from './TimerService.js';
export { LeaseReaper, inFlightIsSafe } from './LeaseReaper.js';
export { OutboxDispatcher, type OutboxPublisher } from './OutboxDispatcher.js';
export { EffectsDispatcher } from './EffectsDispatcher.js';
export { DefaultRunLifecycle, PrepareError, type RunLifecycle, type RunLifecycleDeps } from './RunLifecycle.js';
