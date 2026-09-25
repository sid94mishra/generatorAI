// FROZEN COPY for migration v55 (README R-3, RV-33). Copied from
// packages/workflow-spec/src (P01 review fixes). Never edit: v55 converts
// legacy rows into exactly these shapes and validates them with this copy of
// the validator; the live spec package may move on.

// ────────────────────────────────────────────────────────────────
// Stage error taxonomy (G5 §3.1) as data.
//
// `retry.retryOn` names these codes, so the enum lives with the schemas.
// The classifier that maps thrown errors onto them is engine code (P03).
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

export const ERROR_CLASSES = ['transient', 'deterministic', 'repairable', 'interrupted'] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

/** Every stage error code with its class. Adding a code is one row here. */
export const STAGE_ERROR_CODE_CLASS = {
  rate_limited: 'transient',
  overloaded: 'transient',
  provider_5xx: 'transient',
  transport: 'transient',
  provider_crashed: 'transient',
  idle_timeout: 'transient',
  attempt_timeout: 'transient',
  auth: 'deterministic',
  model_not_found: 'deterministic',
  quota_exhausted: 'deterministic',
  context_overflow: 'deterministic',
  max_turns: 'deterministic',
  budget_exceeded: 'deterministic',
  config_invalid: 'deterministic',
  agent_not_found: 'deterministic',
  agent_disabled: 'deterministic',
  pre_run_hook_abort: 'deterministic',
  rejected_by_human: 'deterministic',
  pause_expired: 'deterministic',
  condition_error: 'deterministic',
  queue_timeout: 'deterministic',
  output_schema: 'repairable',
  validation_rule: 'repairable',
  missing_artifact: 'repairable',
  process_restart_unsafe: 'interrupted',
  lease_expired: 'interrupted',
} as const satisfies Record<string, ErrorClass>;

export type StageErrorCode = keyof typeof STAGE_ERROR_CODE_CLASS;
export const STAGE_ERROR_CODES = Object.keys(STAGE_ERROR_CODE_CLASS) as [StageErrorCode, ...StageErrorCode[]];

export const StageErrorCodeSchema = z
  .enum(STAGE_ERROR_CODES)
  .describe('A classified stage error code (see the error taxonomy); its class decides the default action');

/** The codes of one class, in declaration order. */
export function errorCodesOfClass(cls: ErrorClass): StageErrorCode[] {
  return STAGE_ERROR_CODES.filter((code) => STAGE_ERROR_CODE_CLASS[code] === cls);
}
