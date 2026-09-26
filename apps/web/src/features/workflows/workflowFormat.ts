// ────────────────────────────────────────────────────────────────
// Workflow screens' text helpers and the sample document (the list's
// "Download sample JSON", the new-workflow Import step).
// ────────────────────────────────────────────────────────────────

import { exportGraph, parseGraph, WORKFLOW_FORMAT_VERSION } from '@generatorai/workflow-spec';

/** "6m 12s", "45s", "1h 5m". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** 0.943 → "94%". */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "Sep 2" in the viewer's locale. */
export function formatShortDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The stats range the Workflows screens use: the last 30 days up to now. */
export function last30Days(now = new Date()): { from: string; to: string } {
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString(), to: now.toISOString() };
}

/** A two-stage sample in the canonical document format: what Export writes and Import reads. */
export function sampleWorkflowDocument(): string {
  return exportGraph(
    parseGraph({
      formatVersion: WORKFLOW_FORMAT_VERSION,
      workflow: {
        name: 'My Workflow',
        description: 'Describe what this workflow does',
        tags: ['custom'],
        variables: [
          {
            name: 'example_variable',
            type: 'string',
            label: 'Example Variable',
            description: 'Referenced in prompts as {{variables.example_variable}}',
          },
        ],
      },
      stages: [
        {
          kind: 'agent',
          key: 'analyze',
          name: 'Analyze',
          description: 'First stage of the workflow',
          prompts: [{ label: 'Analyze Requirements', text: 'Analyze the following requirements: {{variables.example_variable}}' }],
        },
        {
          kind: 'agent',
          key: 'generate',
          name: 'Generate',
          description: 'Runs after Analyze succeeds',
          prompts: [{ label: 'Generate Output', text: 'Based on the analysis, generate the output.' }],
        },
      ],
      edges: [{ from: 'analyze', to: 'generate', on: 'success' }],
    }),
  );
}

/** Max size of an imported workflow document. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
