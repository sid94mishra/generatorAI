// ────────────────────────────────────────────────────────────────
// Workflow API refusals as the workflow screens show them: the envelope's
// message plus its located issues (a 422 from import/save/invoke carries
// `details.issues`). Features may not import `platform/*`, so this block is
// where `ApiError` is read.
// ────────────────────────────────────────────────────────────────

import { ApiError } from '@/platform/apiFetch.js';

export interface WorkflowApiIssue {
  /** JSON pointer (`/stages/0/key`) or path segments. */
  path: string | ReadonlyArray<string | number>;
  message: string;
  hint?: string;
}

export interface WorkflowApiError {
  message: string;
  status?: number;
  issues: WorkflowApiIssue[];
}

export function describeWorkflowApiError(err: unknown, fallback = 'The request failed'): WorkflowApiError {
  if (err instanceof ApiError) {
    const issues = (err.details as { issues?: unknown } | undefined)?.issues;
    return { message: err.message, status: err.status, issues: Array.isArray(issues) ? (issues as WorkflowApiIssue[]) : [] };
  }
  return { message: err instanceof Error ? err.message : fallback, issues: [] };
}

/** One line per issue: `path: message (hint)`. */
export function formatWorkflowApiIssue(issue: WorkflowApiIssue): string {
  const path = typeof issue.path === 'string' ? issue.path : issue.path.join('.');
  return `${path || '/'}: ${issue.message}${issue.hint ? ` (${issue.hint})` : ''}`;
}
