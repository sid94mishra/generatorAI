// ────────────────────────────────────────────────────────────────
// Run-graph colours. React Flow draws edges, handles and the minimap from
// props and its own unlayered stylesheet, which the Tailwind utility layer
// cannot override — so those parts take real colour values. They come from
// the token package for the active theme (the xterm approach: literals from
// `resolveDesignTokens`, never getComputedStyle, which races a theme swap),
// so the graph follows every theme, appearance and accent.
// ────────────────────────────────────────────────────────────────

import { createContext, useContext, useMemo, type CSSProperties } from 'react';
import { resolveDesignTokens, type DesignTokens } from '@generatorai/design-tokens';
import type { StageRunStatus } from '@generatorai/shared';
import { useTheme } from '@/providers/ThemeProvider.js';

export type GraphColors = DesignTokens;

/** The active theme's design colours (memoised on theme, appearance and accent). */
export function useResolvedGraphColors(): GraphColors {
  const { theme, resolvedTheme, accent } = useTheme();
  return useMemo(() => resolveDesignTokens(theme, resolvedTheme, accent), [theme, resolvedTheme, accent]);
}

export const GraphColorsContext = createContext<GraphColors | null>(null);

/** The colours RunGraph resolved for its nodes and edges. */
export function useGraphColors(): GraphColors {
  const colors = useContext(GraphColorsContext);
  if (!colors) throw new Error('useGraphColors must be used inside RunGraph');
  return colors;
}

/** Edge `on` → colour (success/failure/completion/always), by the status tokens, not the accent. */
export function edgeTypeColor(colors: GraphColors, type: string | undefined): string {
  switch (type) {
    case 'failure':
      return colors.err;
    case 'completion':
      return colors.run;
    case 'always':
      return colors.fg2;
    default:
      return colors.ok;
  }
}

/** A stage instance's minimap / handle colour. */
export function stageStatusColor(colors: GraphColors, status: StageRunStatus | undefined): string {
  switch (status) {
    case 'completed':
      return colors.ok;
    case 'running':
    case 'validating':
    case 'ready':
    case 'starting':
      return colors.run;
    case 'failed':
      return colors.err;
    case 'paused':
    case 'waiting':
    case 'retry_wait':
    case 'awaiting_input':
      return colors.warn;
    case 'skipped':
      return colors.line;
    default:
      return colors.fg3;
  }
}

/** React Flow's own CSS variables, set on the canvas so its chrome uses the theme. */
export function flowThemeVars(colors: GraphColors): CSSProperties {
  return {
    '--xy-background-color': colors.ground,
    '--xy-edge-stroke': colors.fg3,
    '--xy-handle-background-color': colors.surface,
    '--xy-handle-border-color': colors.line,
    '--xy-controls-button-background-color': colors.raised,
    '--xy-controls-button-background-color-hover': colors.hover,
    '--xy-controls-button-color': colors.fg2,
    '--xy-controls-button-color-hover': colors.fg,
    '--xy-controls-button-border-color': colors.lineSoft,
    '--xy-controls-box-shadow': 'none',
    '--xy-minimap-background-color': colors.surface,
    '--xy-minimap-mask-background-color': colors.hover,
    '--xy-minimap-mask-stroke-color': colors.line,
  } as CSSProperties;
}
