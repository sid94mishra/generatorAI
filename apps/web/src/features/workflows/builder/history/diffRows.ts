// ────────────────────────────────────────────────────────────────
// A structural graph diff as the rows of the WF-10 version history: one
// row per added / removed stage or edge and per changed field (M/A/D), and
// the "3 stages, 1 edge" summary. Pure.
// ────────────────────────────────────────────────────────────────

import type { VersionDiffRow } from '@/blocks/workflow/VersionHistoryPanel/VersionHistoryPanel.js';
import { previewValue, type GraphDiff } from './graphDiff.js';

const preview = (v: unknown) => previewValue(v, 60);

export function diffRows(d: GraphDiff): VersionDiffRow[] {
  const rows: VersionDiffRow[] = [];
  for (const f of d.workflow) {
    rows.push({ id: `w:${f.path}`, op: 'changed', subject: { kind: 'workflow' }, field: f.path, before: preview(f.before), after: preview(f.after) });
  }
  for (const s of d.stagesAdded) {
    rows.push({ id: `sa:${s.key}`, op: 'added', subject: { kind: 'stage', key: s.key }, detail: `${s.name} (${s.kind})` });
  }
  for (const s of d.stagesRemoved) {
    rows.push({ id: `sr:${s.key}`, op: 'removed', subject: { kind: 'stage', key: s.key }, detail: `${s.name} (${s.kind})` });
  }
  for (const s of d.stagesChanged) {
    for (const f of s.fields) {
      rows.push({
        id: `sc:${s.key}:${f.path}`,
        op: 'changed',
        subject: { kind: 'stage', key: s.key },
        field: f.path,
        before: preview(f.before),
        after: preview(f.after),
      });
    }
  }
  for (const e of d.edgesAdded) {
    rows.push({
      id: `ea:${e.from}>${e.to}`,
      op: 'added',
      subject: { kind: 'edge', from: e.from, to: e.to },
      detail: `${e.on}${e.when ? `, when ${e.when}` : ''}`,
    });
  }
  for (const e of d.edgesRemoved) {
    rows.push({ id: `er:${e.from}>${e.to}`, op: 'removed', subject: { kind: 'edge', from: e.from, to: e.to } });
  }
  for (const e of d.edgesChanged) {
    for (const f of e.fields) {
      rows.push({
        id: `ec:${e.from}>${e.to}:${f.path}`,
        op: 'changed',
        subject: { kind: 'edge', from: e.from, to: e.to },
        field: f.path,
        before: preview(f.before),
        after: preview(f.after),
      });
    }
  }
  return rows;
}

/** "3 stages, 1 edge, settings" — what a diff touches; empty when nothing. */
export function diffSummary(d: GraphDiff): string {
  const stages = d.stagesAdded.length + d.stagesRemoved.length + d.stagesChanged.length;
  const edges = d.edgesAdded.length + d.edgesRemoved.length + d.edgesChanged.length;
  return [
    stages > 0 ? `${stages} ${stages === 1 ? 'stage' : 'stages'}` : '',
    edges > 0 ? `${edges} ${edges === 1 ? 'edge' : 'edges'}` : '',
    d.workflow.length > 0 ? 'settings' : '',
  ]
    .filter(Boolean)
    .join(', ');
}
