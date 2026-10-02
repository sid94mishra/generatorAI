// ────────────────────────────────────────────────────────────────
// Window insets — the device's real safe-area insets, for surfaces that
// cover the WHOLE window.
//
// `ConnectionStripHost` pays the top (status bar) and left/right (notch /
// Dynamic Island in landscape) insets once, with padding, and tells the
// subtree through `SafeAreaInsetsContext` that they are 0 — so screens,
// headers and the tab bar never double-pad. That is right for everything
// laid out INSIDE the host, and wrong for the few surfaces that escape it
// and span the full window: `Sheet` (an RN `Modal`) and the iOS `formSheet`
// routes. They read the real values here.
//
// The previous workaround read `initialWindowMetrics`, which is captured
// once at launch and is stale after a rotation (a landscape launch kept a
// 0pt status bar in portrait; a portrait launch kept the 62pt island in
// landscape and pushed the sheet down).
// ────────────────────────────────────────────────────────────────

// The context now lives in the kit (`ui/platform/insets`); the shell's main column provides it.
export { WindowInsetsProvider, useWindowInsets } from '../../ui/platform/insets';

/**
 * Widest a column of reading content gets. On iPad (and a landscape phone)
 * full-bleed rows and 1100pt-wide paragraphs read as a stretched phone app;
 * screens and sheets centre their content at this width instead.
 */
export const READABLE_MAX_WIDTH = 720;
