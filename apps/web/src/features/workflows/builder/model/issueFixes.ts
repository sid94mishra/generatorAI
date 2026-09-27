// ────────────────────────────────────────────────────────────────
// issueFixes — one-click fixes for the validation issues whose fix is
// mechanical (P07 WP-7.6): declare an unknown template variable, rename a
// duplicate or invalid stage key, remove a dangling edge, clear a field
// that does not apply, move a stage out of a non-container, add a body
// stage to an empty loop or map, switch an output with a schema to JSON.
// A fix is an ordinary builder edit, so it is undoable and re-validated.
// Plus the "Go to" target of an issue (its stage, else its edge).
// ────────────────────────────────────────────────────────────────

import { STAGE_KEY_PATTERN, type StageSpec } from '@generatorai/workflow-spec';
import { stageKeyFor, useWorkflowBuilderStore, type BuilderIssue } from '@/stores/workflowBuilderStore.js';

export interface IssueFix {
  label: string;
  /** Short button label for dense rows (the problems panel): Declare / Rename / Remove … */
  short: string;
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
      short: 'Clear',
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
      short: 'Clear',
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
        short: 'Declare',
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
      return { label: `Rename to '${next}'`, short: 'Rename', apply: () => store.renameStageAt(Number(index), next) };
    }
    case 'schema': {
      if (issue.field !== '/key' || !issue.stageKey) return null;
      const stage = stageOf(issue.stageKey);
      if (!stage || STAGE_KEY_PATTERN.test(stage.key)) return null;
      const next = freshKey(stage);
      return { label: `Rename to '${next}'`, short: 'Rename', apply: () => void store.renameStageKey(stage.key, next) };
    }
    case 'unknown-edge-source':
    case 'unknown-edge-target':
    case 'self-edge':
    case 'edge-crosses-scope': {
      const edgeId = issue.edgeId;
      if (!edgeId) return null;
      return { label: 'Remove edge', short: 'Remove', apply: () => store.removeEdge(edgeId) };
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
      return { label: 'Move to the top level', short: 'Move out', apply: () => void store.reparentStage(key, undefined) };
    }
    case 'empty-body': {
      const key = issue.stageKey;
      if (!key) return null;
      return { label: 'Add a body stage', short: 'Add stage', apply: () => void store.addStage(undefined, { parentKey: key }) };
    }
    case 'schema-requires-json': {
      const stage = stageOf(issue.stageKey);
      if (!stage || stage.kind !== 'agent') return null;
      return {
        label: 'Use JSON output',
        short: 'Use JSON',
        apply: () => store.updateStage(stage.key, { output: { ...stage.output, format: 'json' } }),
      };
    }
    default:
      return null;
  }
}

/** Bring an issue's stage (else its edge) into view and select it; false when it has neither. */
export function goToIssue(issue: BuilderIssue): boolean {
  const store = useWorkflowBuilderStore.getState();
  if (issue.stageKey) {
    store.focusStage(issue.stageKey);
    return true;
  }
  if (issue.edgeId) {
    store.selectEdge(issue.edgeId);
    return true;
  }
  return false;
}
