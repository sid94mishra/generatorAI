// ────────────────────────────────────────────────────────────────
// edgeStyles — the builder's edge kinds (`EdgeSpec.on`): label, hint, the
// SVG stroke (a design variable: an SVG `stroke` resolves `var(--gai-*)`,
// so edges follow a theme switch without a re-render), the dash pattern and
// the text tone of labels/legend. Status colours, never the accent: a
// failure edge looks like failure under every theme and accent.
// ────────────────────────────────────────────────────────────────

import { EDGE_ON_VALUES, type EdgeOn } from '@generatorai/workflow-spec';

export const EDGE_ORDER: readonly EdgeOn[] = EDGE_ON_VALUES;

export const DEFAULT_EDGE_ON: EdgeOn = 'success';

/** Legend / picker label (the board's "On success · On failure · On completion"). */
export const EDGE_LABELS: Record<EdgeOn, string> = {
  success: 'On success',
  failure: 'On failure',
  completion: 'On completion',
  always: 'Always',
};

/** When each edge fires — shown in the pickers so the choice is obvious. */
export const EDGE_HINTS: Record<EdgeOn, string> = {
  success: 'Source stage completed',
  failure: 'Source stage failed',
  completion: 'Completed or failed',
  always: 'Any terminal status, including skipped',
};

/** SVG stroke per edge kind. */
export const EDGE_STROKES: Record<EdgeOn, string> = {
  success: 'var(--gai-line-strong)',
  failure: 'var(--gai-err)',
  completion: 'var(--gai-fg-3)',
  always: 'var(--gai-fg-3)',
};

/** SVG dash pattern per edge kind (solid success, dashed failure, dotted completion). */
export const EDGE_DASHES: Record<EdgeOn, string | undefined> = {
  success: undefined,
  failure: '6 4',
  completion: '2 4',
  always: '8 3 2 3',
};

/** Text tone of an edge label / legend entry. */
export const EDGE_TEXT: Record<EdgeOn, string> = {
  success: 'text-fg-2',
  failure: 'text-err',
  completion: 'text-fg-3',
  always: 'text-fg-3',
};

export function edgeOn(value: string | undefined): EdgeOn {
  return (EDGE_ORDER as readonly string[]).includes(value ?? '') ? (value as EdgeOn) : DEFAULT_EDGE_ON;
}
