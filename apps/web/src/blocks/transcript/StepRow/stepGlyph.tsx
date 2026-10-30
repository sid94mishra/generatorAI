// ────────────────────────────────────────────────────────────────
// Step glyphs — one 16px glyph per step row (B-17): the status glyph once a
// step settled or while it runs, the kind's icon for a neutral row.
//
// Status words and glyphs come from the shared 8-state map (D-18) through the
// kit's `status-*` icon concepts; kinds map to icon concepts here.
// ────────────────────────────────────────────────────────────────

import type { IconConcept } from '@generatorai/design-tokens';
import type { StepKind, StepStatus } from '@generatorai/client-core';
import { Icon } from '@/ui/icons/Icon.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';

/** The icon concept of each step kind (icons only through concepts, D-17). */
export const STEP_KIND_ICON: Record<StepKind, IconConcept> = {
  read: 'file-text',
  search: 'search',
  edit: 'edit',
  run: 'terminal',
  browser: 'browser',
  computer: 'computer',
  widget: 'widgets',
  plan: 'plan',
  delegate: 'agents',
  tool: 'tool',
  memory: 'database',
  think: 'think',
  subagent: 'agents',
  note: 'info',
  warning: 'warning',
  error: 'status-failed',
};

/** 16px glyph for a step: spinner while running, status glyph once settled. */
export function StepGlyph({ status, kind }: { status: StepStatus; kind: StepKind }) {
  if (kind === 'warning') return <Icon concept="warning" size={16} className="text-warn" />;
  if (kind === 'note') return <Icon concept="info" size={14} className="text-fg-3" />;
  switch (status) {
    case 'running':
      return <Spinner size={14} className="text-run" />;
    case 'waiting':
      return <Icon concept="status-needs-you" size={16} className="text-warn" />;
    case 'done':
      return <Icon concept="status-succeeded" size={16} className="text-ok" data-testid="step-status-done" />;
    case 'failed':
      return <Icon concept="status-failed" size={16} className="text-err" data-testid="step-status-failed" />;
    case 'pending':
      return <Icon concept={STEP_KIND_ICON[kind]} size={14} className="text-fg-3" />;
  }
}
