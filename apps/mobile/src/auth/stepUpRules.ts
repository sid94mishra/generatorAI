// ────────────────────────────────────────────────────────────────
// Step-up — the pure rule, split out so it can be tested on Node
// (`stepUp.ts` imports react-native and expo-local-authentication).
// ────────────────────────────────────────────────────────────────

/** How long one successful step-up covers further risky actions. */
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000;

/** Does a success at `lastSuccessAt` still cover `now`? */
export function isStepUpFresh(
  lastSuccessAt: number | null,
  now: number,
  windowMs: number = STEP_UP_WINDOW_MS,
): boolean {
  if (lastSuccessAt === null) return false;
  const age = now - lastSuccessAt;
  // Clock went backwards: fail closed and prompt again.
  return age >= 0 && age < windowMs;
}
