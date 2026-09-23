// ────────────────────────────────────────────────────────────────
// Chat feature flags — switches for shipped-but-hidden controls.
//
// Mirrors apps/web/src/components/chat/featureFlags.ts so a control hidden
// on desktop is hidden here too.
// ────────────────────────────────────────────────────────────────

/**
 * "Read aloud" (text-to-speech on assistant turns).
 *
 * The feature is complete and stays in the tree; it is hidden from the
 * transcript for now (product call, Sept 2026, same as desktop) so the turn
 * footer stays quiet. Flip to re-surface the button and the menu item.
 */
export const READ_ALOUD_ENABLED = false;
