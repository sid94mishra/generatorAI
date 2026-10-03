// The run sheet's request (M8-02; MWorkflowLaunch(+Advanced, +Plan); P04 `POST /workflow-invocations`): which action
// is the filled one (Run for a published workflow, Test run for a draft; Test run is also offered when a published
// workflow has unpublished changes), why Run is disabled, the invocation body, and the server's issues as lines.
// Pure, unit-tested.
import type { InvocationIssue, InvocationRequest } from '@generatorai/workflow-spec';

export interface RunActions {
  /** The filled button. */
  primary: 'run' | 'test';
  /** Test run as a secondary button (a published workflow with unpublished changes). */
  secondaryTest: boolean;
}

export function runActions(record: { status: 'draft' | 'published'; hasUnpublishedChanges: boolean }): RunActions {
  if (record.status === 'draft') return { primary: 'test', secondaryTest: false };
  return { primary: 'run', secondaryTest: record.hasUnpublishedChanges };
}

export interface RunDraft {
  variables: Record<string, unknown>;
  test: boolean;
}

export function invocationBody(workflowId: string, draft: RunDraft): InvocationRequest {
  return {
    target: { kind: 'definition', workflowDefinitionId: workflowId, ...(draft.test ? { testRun: true } : {}) },
    variables: draft.variables,
    client: 'mobile',
  };
}

/** The server's issues as "path — message" lines (an invocation 400 / 409 carries `error.issues`). */
export function issueLines(error: unknown): string[] {
  const body = (error as { body?: { error?: { issues?: InvocationIssue[] } } } | null)?.body;
  const issues = body?.error?.issues ?? [];
  return issues.filter((i) => i.severity !== 'warning').map((i) => (i.path.length ? `${i.path.join('.')} — ${i.message}` : i.message));
}
