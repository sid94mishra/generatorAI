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

/**
 * 06 §6.4: the step-up cache is forgotten after a background absence longer than the App lock grace (Settings ›
 * App lock & privacy › Lock after leaving), so a phone picked up later asks again. `leftAt` is when the app reached
 * the background (null: it never did). "Immediately" (0) forgets on any real background; a clock step backwards
 * fails closed.
 */
export function stepUpExpiredByAbsence(leftAt: number | null, now: number, graceSeconds: number): boolean {
  if (leftAt === null) return false;
  const away = now - leftAt;
  return away < 0 || away >= Math.max(0, graceSeconds) * 1000;
}
