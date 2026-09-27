// The contract between the run page's one stage-row renderer (StageRow) and
// the control-flow rows (loop, map, expansion, wait, sub-workflow): every row
// renders through the page's `renderStage`, so focus, the "…" menu, gates and
// the inspector behave the same way at any nesting depth.

import type { ReactNode } from 'react';
import type { StageView } from './types.js';

/** How the page renders one stage row (a loop's own row, or a body instance). */
export interface StageRenderOptions {
  /** False for the last row of a list (no divider under it). */
  showConnector: boolean;
  /** Open the row once the run is over (the last top-level stage). */
  openWhenFinished?: boolean;
  /** Extra header badges (a loop's `n/max`, rule streaks, "Needs decision"). */
  headerExtra?: ReactNode;
  /** Replaces the transcript (prompt, stream, review controls): a loop renders its iterations here. */
  body?: ReactNode;
  /** Rendered above the transcript: a loop body's iteration input, operator and digest turns. */
  preamble?: ReactNode;
  /** Hide the definition's first prompt (a later iteration's first turn was its follow-up prompt). */
  hidePrompt?: boolean;
  /** Nesting depth (0 = top level): body rows indent under their container. */
  depth?: number;
}

export type RenderStage = (stage: StageView, opts: StageRenderOptions) => ReactNode;
