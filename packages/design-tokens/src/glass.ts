// ────────────────────────────────────────────────────────────────
// Glass and mobile elevation tokens (mobile 02 §8, MD-72). Data only.
//
// Glass is iOS floating chrome only (`GlassSurface`, expo-glass-effect); its
// fallback (Reduce Transparency, no Liquid Glass, Android, Jest) is an opaque
// `bg-overlay border border-line shadow-float` view. Android draws tonal
// layers (§8.3), never glass.
// ────────────────────────────────────────────────────────────────

export const GLASS = {
  ios: {
    style: 'regular',
    containerSpacing: 8,
    tint: null,
    interactiveFor: ['NewAction', 'ScrollToLatest', 'IconButton'],
  },
  fallback: { surface: 'overlay', border: 'line', shadow: 'float' },
  allowed: ['header', 'composer', 'newAction', 'latestPill', 'toast', 'stepNavToolbar', 'zoomColumn'],
} as const;

/**
 * `--gai-shadow-float` (`shadow-float`, mobile only): the same in every theme
 * and mode — the board glass recipe `0 8 28 rgba(0,0,0,.28)` (#47 = 0.28 × 255).
 * Glass fallback surfaces, the Android extended FAB and the Android snackbar.
 */
export const SHADOW_FLOAT = '0 8px 28px #00000047';
