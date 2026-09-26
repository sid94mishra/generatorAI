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
  check_launch_failed: 'deterministic',
  check_failed: 'deterministic',
  loop_body_failed: 'deterministic',
  loop_exit_fail: 'deterministic',
  loop_limit: 'deterministic',
  loop_wall_clock: 'deterministic',
  loop_carry_too_large: 'deterministic',
  restore_failed: 'deterministic',
  map_items_invalid: 'deterministic',
  map_too_large: 'deterministic',
  map_duplicate_item_key: 'deterministic',
  map_tolerance_exceeded: 'deterministic',
  mount_fork_failed: 'deterministic',
  item_setup_failed: 'deterministic',
  merge_conflict: 'deterministic',
  merge_failed: 'deterministic',
  map_winner_failed: 'deterministic',
  expansion_invalid: 'deterministic',
  expansion_failed: 'deterministic',
  subworkflow_start_failed: 'deterministic',
  subworkflow_output_drift: 'deterministic',
  subworkflow_failed: 'deterministic',
  wait_timeout: 'deterministic',
  output_schema: 'repairable',
  validation_rule: 'repairable',
  judge_below_threshold: 'repairable',
  missing_artifact: 'repairable',
  process_restart_unsafe: 'interrupted',
  lease_expired: 'interrupted',
} as const satisfies Record<string, ErrorClass>;

export type StageErrorCode = keyof typeof STAGE_ERROR_CODE_CLASS;
export const STAGE_ERROR_CODES = Object.keys(STAGE_ERROR_CODE_CLASS) as [StageErrorCode, ...StageErrorCode[]];

export const StageErrorCodeSchema = z
  .enum(STAGE_ERROR_CODES)
  .describe('A classified stage error code (see the error taxonomy); its class decides the default action');
