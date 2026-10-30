// ────────────────────────────────────────────────────────────────
// NodeMarkers — the header markers of a canvas node: the draft-diff tag
// ("Changed" / "Added", board WorkflowAgentDraft) and the validation
// counts (board WorkflowValidate: a red "⊗ 1", an amber "⚠ 1") with the
// messages in a tooltip. Also `useStageIssues`, the node's issues from the
// store (D-25), shared by stage and group nodes.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Tooltip } from '@/ui/primitives/Tooltip/Tooltip.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import type { NodeTag } from './canvasContext.js';

export interface StageIssueSummary {
  errors: string[];
  warnings: string[];
  /** JSON pointers (relative to the stage) of the fields with an error. */
  errorFields: string[];
}

/** The validation issues located on stage `key`. */
export function useStageIssues(key: string): StageIssueSummary {
  const issues = useWorkflowBuilderStore((s) => s.issues);
  return useMemo(() => {
    const mine = issues.filter((i) => i.stageKey === key);
    const errors = mine.filter((i) => i.severity === 'error');
    return {
      errors: errors.map((i) => i.message),
      warnings: mine.filter((i) => i.severity !== 'error').map((i) => i.message),
      errorFields: errors.map((i) => i.field ?? ''),
    };
  }, [issues, key]);
}

const issueNoun = (n: number) => `validation ${n === 1 ? 'issue' : 'issues'}`;

export function NodeMarkers({ issues, tag }: { issues: StageIssueSummary; tag?: NodeTag | undefined }) {
  return (
    <>
      {tag === 'changed' ? <Badge tone="warn">Changed</Badge> : tag === 'added' ? <Badge tone="ok">Added</Badge> : null}
      {issues.errors.length > 0 ? (
        <Tooltip content={issues.errors.join(' · ')}>
          <Badge tone="err" icon="status-failed" role="img" aria-label={`${issues.errors.length} ${issueNoun(issues.errors.length)}`}>
            {issues.errors.length}
          </Badge>
        </Tooltip>
      ) : null}
      {issues.warnings.length > 0 ? (
        <Tooltip content={issues.warnings.join(' · ')}>
          <Badge tone="warn" icon="warning" role="img" aria-label={`${issues.warnings.length} validation ${issues.warnings.length === 1 ? 'warning' : 'warnings'}`}>
            {issues.warnings.length}
          </Badge>
        </Tooltip>
      ) : null}
    </>
  );
}
