// ────────────────────────────────────────────────────────────────
// issueFixes — one-click fixes for the validation issues whose fix is
// mechanical (P07 WP-7.6): declare an unknown template variable, rename a
// duplicate or invalid stage key, remove a dangling edge, clear a field
// that does not apply, move a stage out of a non-container, add a body
// stage to an empty loop or map, switch an output with a schema to JSON.
// A fix is an ordinary builder edit, so it is undoable and re-validated.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { AlertCircle, Wand2 } from 'lucide-react';
import { STAGE_KEY_PATTERN, type StageSpec } from '@generatorai/workflow-spec';
import { Button } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import { stageKeyFor, useWorkflowBuilderStore, type BuilderIssue } from '@/stores/workflowBuilderStore.js';

export interface IssueFix {
  label: string;
  apply: () => void;
}

const UNDECLARED = /^'([A-Za-z_][A-Za-z0-9_]*)' is not a declared variable/;
const SYSTEM_NAME = /^(__|repo_path_|repo_branch_)/;

function decodeToken(t: string): string {
  return t.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** `value` without the member at `path` (a copy; the input is not changed). */
function withoutPath(value: unknown, path: readonly string[]): unknown {
  if (path.length === 0 || value === null || typeof value !== 'object') return value;
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const i = Number(head);
    if (!Number.isInteger(i)) return value;
    if (rest.length === 0) return value.filter((_, j) => j !== i);
    return value.map((v, j) => (j === i ? withoutPath(v, rest) : v));
  }
  const obj = { ...(value as Record<string, unknown>) };
  if (rest.length === 0) delete obj[head!];
  else if (head! in obj) obj[head!] = withoutPath(obj[head!], rest);
  return obj;
}

function stageOf(key: string | undefined): StageSpec | undefined {
  if (!key) return undefined;
  return useWorkflowBuilderStore.getState().nodes.find((n) => n.id === key)?.data.stage;
}

/** Delete the field an issue points at (a stage field, or a workflow-level one). */
function clearFieldFix(issue: BuilderIssue): IssueFix | null {
  const store = useWorkflowBuilderStore.getState();
  if (issue.stageKey && issue.field) {
    const tokens = issue.field.split('/').slice(1).map(decodeToken);
    const stage = stageOf(issue.stageKey);
    if (!stage || tokens.length === 0) return null;
    const top = tokens[0]!;
    return {
      label: `Clear ${tokens.join('.')}`,
      apply: () => {
        const next = withoutPath(stage, tokens) as Record<string, unknown>;
        store.updateStage(issue.stageKey!, { [top]: next[top] } as never);
      },
    };
  }
  const wf = /^\/workflow\/(.+)$/.exec(issue.path);
  if (wf) {
    const tokens = wf[1]!.split('/').map(decodeToken);
    const top = tokens[0]!;
    return {
      label: `Clear ${tokens.join('.')}`,
      apply: () => {
        const workflow = useWorkflowBuilderStore.getState().workflow;
        const next = withoutPath(workflow, tokens) as Record<string, unknown>;
        store.updateWorkflow({ [top]: next[top] } as never);
      },
    };
  }
  return null;
}

/** A free key derived from the stage's name. */
function freshKey(stage: StageSpec): string {
  const taken = new Set(useWorkflowBuilderStore.getState().nodes.map((n) => n.id));
  return stageKeyFor(stage.name || stage.key, taken);
}

/** The one-click fix of an issue, or null when its fix needs a decision. */
export function quickFixFor(issue: BuilderIssue): IssueFix | null {
  const store = useWorkflowBuilderStore.getState();
  switch (issue.code) {
    case 'template-unknown-variable':
    case 'unknown-input-variable': {
      const name = UNDECLARED.exec(issue.message)?.[1];
      if (!name || SYSTEM_NAME.test(name)) return null;
      if (store.workflow.variables.some((v) => v.name === name)) return null;
      return {
        label: `Declare variable '${name}'`,
        apply: () =>
          store.updateWorkflow({
            variables: [...useWorkflowBuilderStore.getState().workflow.variables, { name, type: 'string', label: name, required: false }],
          }),
      };
    }
    case 'duplicate-key': {
      // The builder names nodes by key, so the later duplicate is renamed by position.
      const index = /^\/stages\/(\d+)/.exec(issue.path)?.[1];
      const node = index !== undefined ? store.nodes[Number(index)] : undefined;
      if (!node) return null;
      const next = freshKey(node.data.stage);
      return { label: `Rename to '${next}'`, apply: () => store.renameStageAt(Number(index), next) };
    }
    case 'schema': {
      if (issue.field !== '/key' || !issue.stageKey) return null;
      const stage = stageOf(issue.stageKey);
      if (!stage || STAGE_KEY_PATTERN.test(stage.key)) return null;
      const next = freshKey(stage);
      return { label: `Rename to '${next}'`, apply: () => void store.renameStageKey(stage.key, next) };
    }
    case 'unknown-edge-source':
    case 'unknown-edge-target':
    case 'self-edge':
    case 'edge-crosses-scope': {
      const edgeId = issue.edgeId;
      if (!edgeId) return null;
      return { label: 'Remove edge', apply: () => store.removeEdge(edgeId) };
    }
    case 'field-not-applicable':
    case 'unknown-field':
    case 'compact-without-continue':
    case 'options-without-choice':
      return clearFieldFix(issue);
    case 'unknown-parent':
    case 'parent-not-container': {
      const key = issue.stageKey;
      if (!key) return null;
      return { label: 'Move to the top level', apply: () => void store.reparentStage(key, undefined) };
    }
    case 'empty-body': {
      const key = issue.stageKey;
      if (!key) return null;
      return { label: 'Add a body stage', apply: () => void store.addStage(undefined, { parentKey: key }) };
    }
    case 'schema-requires-json': {
      const stage = stageOf(issue.stageKey);
      if (!stage || stage.kind !== 'agent') return null;
      return {
        label: 'Use JSON output',
        apply: () => store.updateStage(stage.key, { output: { ...stage.output, format: 'json' } }),
      };
    }
    default:
      return null;
  }
}

/** The fix button of an issue (nothing when it has none). */
export function IssueFixButton({ issue, className }: { issue: BuilderIssue; className?: string }) {
  const fix = quickFixFor(issue);
  if (!fix) return null;
  return (
    <Button
      variant="unstyled"
      onClick={(e) => {
        e.stopPropagation();
        fix.apply();
      }}
      className={className ?? 'inline-flex items-center gap-0.5 rounded px-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline'}
      title="Quick fix"
    >
      <Wand2 className="h-3 w-3" />
      {fix.label}
    </Button>
  );
}

/**
 * Every issue of the selected stage, in the panel header: the ones whose
 * field has no control (a field of another kind, an unknown field) would
 * otherwise show nowhere. Each carries its quick fix when it has one.
 */
export function StageIssueList({ issues }: { issues: readonly BuilderIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (errors.length === 0 && warnings.length === 0) return null;
  const counts = [
    errors.length > 0 ? `${errors.length} ${errors.length === 1 ? 'error' : 'errors'}` : '',
    warnings.length > 0 ? `${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}` : '',
  ].filter(Boolean);
  return (
    <div
      className={cn(
        'mx-4 mb-2 rounded-md px-2 py-1.5 text-[11px]',
        errors.length > 0 ? 'bg-danger-muted text-danger' : 'bg-warning-muted text-warning',
      )}
      data-testid="stage-issues"
    >
      <p className="flex items-center gap-1.5 font-medium">
        <AlertCircle className="h-3 w-3 shrink-0" />
        {counts.join(', ')} in this stage
      </p>
      <ul className="mt-1 space-y-0.5">
        {[...errors, ...warnings].map((issue, i) => (
          <li key={`${issue.code}:${issue.path}:${i}`} className={issue.severity === 'error' ? 'text-danger' : 'text-warning'}>
            {issue.field ? <span className="font-mono opacity-80">{issue.field.slice(1).replace(/\//g, '.')}: </span> : null}
            {issue.message}
            <IssueFixButton issue={issue} className="ml-1 inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline" />
          </li>
        ))}
      </ul>
    </div>
  );
}
