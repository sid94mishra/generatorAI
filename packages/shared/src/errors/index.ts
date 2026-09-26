// ────────────────────────────────────────────────────────────────
// Error Hierarchy — GeneratorAIError base + concrete subclasses
// ────────────────────────────────────────────────────────────────

import type { ValidationIssue, WorkflowDefinitionRecord } from '@generatorai/workflow-spec';

export type ErrorCategory =
  | 'harness'
  | 'network'
  | 'process'
  | 'storage'
  | 'validation'
  | 'state'
  | 'resource'
  | 'not_found'
  | 'hook'
  | 'user';

export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';

export abstract class GeneratorAIError extends Error {
  abstract readonly category: ErrorCategory;
  abstract readonly severity: ErrorSeverity;
  abstract readonly recoverable: boolean;
  readonly timestamp = Date.now();

  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// ── Harness Errors (provider-agnostic — applies to copilot, claude-agent, etc.) ──

export class HarnessConnectionError extends GeneratorAIError {
  readonly category = 'harness' as const;
  readonly severity = 'error' as const;
  readonly recoverable = true;
  constructor(message: string, public readonly provider?: string, cause?: Error) {
    super(message, 'HARNESS_CONNECTION', cause);
  }
}

export class HarnessSessionError extends GeneratorAIError {
  readonly category = 'harness' as const;
  readonly severity = 'error' as const;
  readonly recoverable = false;
  constructor(message: string, public readonly provider?: string, cause?: Error) {
    super(message, 'HARNESS_SESSION', cause);
  }
}

export class HarnessTimeoutError extends GeneratorAIError {
  readonly category = 'harness' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = true;
  constructor(message: string, public readonly provider?: string) {
    super(message, 'HARNESS_TIMEOUT');
  }
}

// ── Process Errors ──

export class GitError extends GeneratorAIError {
  readonly category = 'process' as const;
  readonly severity = 'error' as const;
  readonly recoverable = true;
  constructor(message: string, cause?: Error) {
    super(message, 'GIT_ERROR', cause);
  }
}

export class ScriptError extends GeneratorAIError {
  readonly category = 'process' as const;
  readonly severity = 'error' as const;
  readonly recoverable = false;
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message, 'SCRIPT_ERROR');
  }
}

export class ProcessNotFoundError extends GeneratorAIError {
  readonly category = 'process' as const;
  readonly severity = 'error' as const;
  readonly recoverable = false;
  constructor(message: string, cause?: Error) {
    super(message, 'PROCESS_NOT_FOUND', cause);
  }
}

// ── State Errors ──

export class InvalidTransitionError extends GeneratorAIError {
  readonly category = 'state' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = false;
  constructor(message: string) {
    super(message, 'INVALID_TRANSITION');
  }
}

// ── Validation Errors ──

export class ValidationError extends GeneratorAIError {
  readonly category = 'validation' as const;
  readonly severity = 'info' as const;
  readonly recoverable = false;
  constructor(
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message, 'VALIDATION_ERROR');
  }
}

/**
 * PD-17 — a run's permission mode cannot be enforced by a stage's provider
 * (a provider that never asks cannot hold `default` or `plan`). Refused at
 * run start instead of running the stage silently unattended.
 */
export class PermissionGatingUnsupportedError extends GeneratorAIError {
  readonly category = 'validation' as const;
  readonly severity = 'info' as const;
  readonly recoverable = false;
  constructor(message: string) {
    super(message, 'PERMISSION_GATING_UNSUPPORTED');
  }
}

export class SecurityError extends GeneratorAIError {
  readonly category = 'validation' as const;
  readonly severity = 'error' as const;
  readonly recoverable = false;
  constructor(message: string) {
    super(message, 'SECURITY_VIOLATION');
  }
}

// ── Resource Errors ──

export class NotFoundError extends GeneratorAIError {
  readonly category = 'not_found' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = false;
  constructor(resource: string, id: string) {
    super(`${resource} '${id}' not found`, 'NOT_FOUND');
  }
}

export class ResourceLimitError extends GeneratorAIError {
  readonly category = 'resource' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = true;
  constructor(message: string) {
    super(message, 'RESOURCE_LIMIT');
  }
}

export class ConflictError extends GeneratorAIError {
  /** Maps to HTTP 409 via ERROR_STATUS_MAP (category 'state'). */
  readonly category = 'state' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = false;
  constructor(message: string, cause?: Error) {
    super(message, 'CONFLICT', cause);
  }
}

// ── Hook Errors ──

export class HookTimeoutError extends GeneratorAIError {
  readonly category = 'hook' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = true;
  constructor(message: string) {
    super(message, 'HOOK_TIMEOUT');
  }
}

export class HookAbortError extends GeneratorAIError {
  readonly category = 'hook' as const;
  readonly severity = 'error' as const;
  readonly recoverable = false;
  constructor(message: string) {
    super(message, 'HOOK_ABORT');
  }
}

export class HookScriptError extends GeneratorAIError {
  readonly category = 'hook' as const;
  readonly severity = 'error' as const;
  readonly recoverable = false;
  constructor(message: string) {
    super(message, 'HOOK_SCRIPT_ERROR');
  }
}

export class HookHttpError extends GeneratorAIError {
  readonly category = 'hook' as const;
  readonly severity = 'error' as const;
  readonly recoverable = true;
  constructor(message: string) {
    super(message, 'HOOK_HTTP_ERROR');
  }
}

export class HookConfigError extends GeneratorAIError {
  readonly category = 'hook' as const;
  readonly severity = 'error' as const;
  readonly recoverable = false;
  constructor(message: string) {
    super(message, 'HOOK_CONFIG_ERROR');
  }
}

// ── Storage Errors ──

export class StorageError extends GeneratorAIError {
  readonly category = 'storage' as const;
  readonly severity = 'error' as const;
  readonly recoverable = false;
  constructor(message: string, cause?: Error) {
    super(message, 'STORAGE_ERROR', cause);
  }
}

// ── Catch-all ──

export class NetworkError extends GeneratorAIError {
  readonly category = 'network' as const;
  readonly severity = 'error' as const;
  readonly recoverable = true;
  constructor(message: string, cause?: Error) {
    super(message, 'NETWORK_ERROR', cause);
  }
}

// ── v2 New Errors ──

/**
 * A workflow document failed `validateWorkflow` (P01 WP-1.7). The server
 * answers 422 with the issues, each pointing at the field (JSON pointer)
 * and stage it is about, so a client can show it in place.
 */
export class WorkflowValidationError extends GeneratorAIError {
  readonly category = 'validation' as const;
  readonly severity = 'info' as const;
  readonly recoverable = false;
  constructor(
    message: string,
    public readonly issues: ValidationIssue[],
  ) {
    super(message, 'WORKFLOW_INVALID');
  }
}

/**
 * The caller lacks a scope the operation needs (403). Workflow definitions
 * raise it when a save adds or changes a command-bearing field (script and
 * function hooks, stdio MCP servers, scripts, `custom_script` rules) without
 * `admin:settings` (W-34).
 */
export class InsufficientScopeError extends GeneratorAIError {
  readonly category = 'validation' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = false;
  readonly httpStatus = 403;
  constructor(
    message: string,
    public readonly requiredScope: string,
  ) {
    super(message, 'INSUFFICIENT_SCOPE');
  }
}

/**
 * A graph save carried a stale `expectedRevision`: someone else saved first.
 * The server answers 409 with the current record so the client can offer to
 * reload or overwrite.
 */
export class RevisionConflictError extends GeneratorAIError {
  readonly category = 'state' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = true;
  constructor(
    message: string,
    public readonly current: WorkflowDefinitionRecord,
  ) {
    super(message, 'REVISION_CONFLICT');
  }
}

export class DAGValidationError extends GeneratorAIError {
  readonly category = 'validation' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = true;
  constructor(message: string, public readonly validationErrors?: string[]) {
    super(message, 'DAG_VALIDATION_ERROR');
  }
}

export class SessionAllocationError extends GeneratorAIError {
  readonly category = 'resource' as const;
  readonly severity = 'error' as const;
  readonly recoverable = true;
  constructor(message: string, cause?: Error) {
    super(message, 'SESSION_ALLOCATION_ERROR', cause);
  }
}

export class StageExecutionError extends GeneratorAIError {
  readonly category = 'process' as const;
  readonly severity = 'error' as const;
  readonly recoverable = false;
  constructor(message: string, public readonly stageRunId?: string, cause?: Error) {
    super(message, 'STAGE_EXECUTION_ERROR', cause);
  }
}

export class UserError extends GeneratorAIError {
  readonly category = 'user' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = true;
  constructor(message: string, public readonly userAction?: string) {
    super(message, 'USER_ERROR');
  }
}

export class UnknownError extends GeneratorAIError {
  readonly category = 'process' as const;
  readonly severity = 'error' as const;
  readonly recoverable = false;
  constructor(message: string, cause?: Error) {
    super(message, 'UNKNOWN_ERROR', cause);
  }
}

// ── Error → HTTP Status Map ──

export const ERROR_STATUS_MAP: Record<ErrorCategory, number> = {
  validation: 400,
  state: 409,
  user: 400,
  not_found: 404,
  resource: 429,
  harness: 502,
  network: 503,
  process: 502,
  storage: 500,
  hook: 502,
};
