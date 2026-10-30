// ────────────────────────────────────────────────────────────────
// The trusted side of an invocation (P04 WP-4.2; G4 §1.3.2): who asks,
// the server-derived trigger, the lineage of a nested run, the caller's
// permission ceiling and budget. Never read from a request body.
// ────────────────────────────────────────────────────────────────

import { GeneratorAIError } from '@generatorai/shared';
import type { InvocationErrorCode, InvocationIssue, InvocationTrigger, RunPermissionMode } from '@generatorai/workflow-spec';

export interface InvocationPrincipal {
  kind: 'device' | 'service_account' | 'local' | 'system';
  id: string;
  /** The principal's scopes (`system` holds every one). */
  scopes: readonly string[];
}

/** A nested run's parent: where it sits in the run tree. */
export interface InvocationLineage {
  rootRunId: string;
  parentRunId?: string;
  parentStageRunId?: string;
  /** The PARENT run's depth (a root run is 0). */
  depth: number;
  /** Definition ids of every ancestor, for recursion checks. */
  ancestryDefinitionIds: string[];
}

export interface InvocationContext {
  principal: InvocationPrincipal;
  /** Server-derived (G4 §1.3.3): the route from the principal, in-process callers from what they are. */
  trigger: InvocationTrigger;
  lineage?: InvocationLineage;
  /** The most a caller may grant (a chat's or a stage's own mode, an automation's declared mode). */
  callerPermissionCeiling?: RunPermissionMode;
  /** What is left of the caller's budget. */
  budget?: { remainingChildRuns?: number };
  /** The `Idempotency-Key` header (wins over `body.idempotencyKey`). */
  idempotencyKey?: string;
  /** In-process callers that retry: the attempt number, part of the derived key. */
  attempt?: number;
  /** The request arrived over loopback (bypass then needs no `admin:settings`). */
  loopback?: boolean;
  /**
   * A sub-workflow child with `workspace: inherit` (P05 §4.2): it runs in
   * the parent run's workspace; its own mounts and post-processing are
   * skipped (the parent commits).
   */
  inheritWorkspace?: { fromRunId: string; workspaceId: string };
  /**
   * Who may answer the run's completion reviews (P06, G4 §2.3): `human`
   * (default) or `invoker` — the agent that started it, through
   * `respond_workflow_approval`. In-process callers only; never from a body.
   */
  approvalDelegate?: 'human' | 'invoker';
  /** The chat workspace a `from_chat_branch` run was cut from (G4 §2.6). */
  parentWorkspaceId?: string;
}

const HTTP_STATUS: Record<InvocationErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 409,
  DEPTH_LIMIT: 422,
  RECURSION: 422,
  BUDGET_EXHAUSTED: 422,
  PERMISSION_ESCALATION: 403,
  PERMISSION_GATING_UNSUPPORTED: 422,
  CODEBASE_REQUIRED: 422,
  DRAFT_NOT_RUNNABLE: 409,
  FORBIDDEN_SCOPE: 403,
  CONFLICT: 409,
  ENGINE_UNAVAILABLE: 503,
};

/** A refused invocation: one code, a message, and the issues behind it (`{error: {code, message, issues}}`). */
export class InvocationError extends GeneratorAIError {
  readonly category = 'validation' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = false;
  readonly httpStatus: number;
  constructor(
    code: InvocationErrorCode,
    message: string,
    readonly issues: InvocationIssue[] = [],
  ) {
    super(message, code);
    this.httpStatus = HTTP_STATUS[code];
  }
}

export function issue(code: string, path: Array<string | number>, message: string, severity: InvocationIssue['severity'] = 'error'): InvocationIssue {
  return { code, path, message, severity };
}
