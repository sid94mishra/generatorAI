// ────────────────────────────────────────────────────────────────
// BuilderProblems — the builder's validation issues as the WF-03 problems
// panel: errors first, then warnings; each row names its stage (or "A → B"
// for an edge), carries the issue's quick fix when it has one (else "Go
// to"), and clicking it selects and reveals the stage or edge.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWorkflowBuilderStore, type BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { ProblemsPanel, type ProblemRow } from '@/blocks/workflow/ProblemsPanel/ProblemsPanel.js';
import { goToIssue, quickFixFor } from '../model/issueFixes.js';

export interface BuilderProblemsProps {
  checkedAt?: Date;
  onCheckAgain: () => void;
  onClose: () => void;
}

export function BuilderProblems({ checkedAt, onCheckAgain, onClose }: BuilderProblemsProps) {
  const issues = useWorkflowBuilderStore((s) => s.issues);
  // Names by key and edge ends by id, as `\0`-joined strings so the selector stays shallow-comparable.
  const names = useWorkflowBuilderStore(useShallow((s) => s.nodes.map((n) => `${n.id}\u0000${n.data.stage.name}`)));
  const edges = useWorkflowBuilderStore(useShallow((s) => s.edges.map((e) => `${e.id}\u0000${e.source}\u0000${e.target}`)));

  const rows = useMemo<ProblemRow[]>(() => {
    const nameOf = new Map(names.map((entry) => entry.split('\u0000') as [string, string]));
    const endsOf = new Map(
      edges.map((entry) => {
        const [id, from, to] = entry.split('\u0000') as [string, string, string];
        return [id, [from, to] as const];
      }),
    );
    const label = (key: string) => nameOf.get(key) || key;
    const target = (issue: BuilderIssue): string | undefined => {
      if (issue.stageKey) return label(issue.stageKey);
      const ends = issue.edgeId ? endsOf.get(issue.edgeId) : undefined;
      return ends ? `${label(ends[0])} → ${label(ends[1])}` : undefined;
    };
    const ordered = [...issues.filter((i) => i.severity === 'error'), ...issues.filter((i) => i.severity !== 'error')];
    return ordered.map((issue, i) => {
      const fix = quickFixFor(issue);
      const reachable = !!issue.stageKey || !!issue.edgeId;
      return {
        id: `${issue.code}:${issue.path}:${i}`,
        severity: issue.severity === 'error' ? 'error' : 'warning',
        target: target(issue),
        code: issue.code,
        message: issue.message,
        hint: issue.hint,
        fix: fix ? { label: fix.short, title: fix.label, onApply: fix.apply } : undefined,
        onGoTo: reachable ? () => void goToIssue(issue) : undefined,
      };
    });
  }, [issues, names, edges]);

  return <ProblemsPanel rows={rows} checkedAt={checkedAt} onCheckAgain={onCheckAgain} onClose={onClose} />;
}
