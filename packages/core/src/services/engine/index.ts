// Engine v2 (P03 WP-3.5/3.6): the executor, the per-run actor and the
// supervisor that hosts them, with its timers, lease reaper, outbox and
// lifecycle effects. Wired only through tests and the testkit until the
// part-3 cutover (WP-3.7).
export {
  StageExecutor,
  journalEpoch,
  DEFAULT_EXECUTOR_TIMING,
  type StageExecutorDeps,
  type ExecutorTiming,
  type LaunchRequest,
  type AbortReason,
} from './StageExecutor.js';
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
