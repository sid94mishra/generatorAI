// ────────────────────────────────────────────────────────────────
// Chat feature flags — switches for shipped-but-hidden controls.
// ────────────────────────────────────────────────────────────────

/**
 * "Read aloud" / "Speak live" (text-to-speech on assistant turns).
 *
 * The feature is complete and stays in the tree; it is hidden from the
 * transcript for now (product call, Sept 2026) so the turn footer stays
 * quiet. Flip to re-surface both buttons.
 */
export const READ_ALOUD_ENABLED = false;
