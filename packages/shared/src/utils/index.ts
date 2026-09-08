// Shared utilities

export * from './pairingCode.js';

// Composer caret insertion — shared by the web and mobile dictation
// composers (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C.2). Pure
// data-in/data-out, no DOM and no React, which is exactly why it can live
// here and be used from React Native as-is.
export { insertTextAtCaret, CaretInsertionSequencer } from './insertAtCaret.js';
export type { CaretInsertResult } from './insertAtCaret.js';

// Dictation stitching — spacing, sentence case and "scratch that" between
// one utterance and the next. Same reasoning: pure, DOM-free, used by the
// server-side formatter and by both composers.
export {
  SCRATCH_THAT,
  applyScratchCommand,
  splitScratchCommand,
  stripLocaleTags,
  dictationSeparator,
  continueCase,
  stitchDictation,
} from './dictationText.js';
export type { StitchResult } from './dictationText.js';

export {
  evaluateBlocklist,
  buildBlocklist,
  normaliseAppText,
  executableBasename,
  DEFAULT_COMPUTER_USE_BLOCKLIST,
} from './computerUseBlocklist.js';
export type {
  ComputerUseBlocklist,
  BlocklistCandidate,
  BlocklistVerdict,
  BlocklistOptions,
} from './computerUseBlocklist.js';

// Runtime-agnostic helpers live in `pure.ts` so the client entry
// (`@generatorai/shared/client`) can re-export them without dragging in the
// server-only modules below.
export { generateId, deepMerge, sleep, interpolateVariables } from './pure.js';

export { parseBatchData, resolveIterationVariables, buildIterationLabel } from './batchDataParser.js';
export {
  matchesHostPattern,
  matchesAnyHostPattern,
  isLoopbackHost,
  isLinkLocalHost,
  isDefaultBlockedHost,
  isNavigationAllowed,
} from './hostMatcher.js';
export type { NavigationVerdict } from './hostMatcher.js';
export {
  validateCronExpression,
  isValidTimezone,
  getNextCronRun,
  countCronRunsBetween,
} from './cron.js';
export type { ParsedCron, CronValidation } from './cron.js';
export {
  SECRET_MASK,
  makeSecretRef,
  isSecretRef,
  parseSecretRefValue,
  isSensitiveKey,
} from './secretRefs.js';
