// The pairing success step (M7-08, `/paired`): set when `completePairing` resolves, so the server scope — which sends
// a server switch to Home — opens the success step instead, once. Module state; nothing persists.
let pending = false;

export function markPaired(): void {
  pending = true;
}

/** True once after a pairing completed; clears the mark. */
export function consumePaired(): boolean {
  const was = pending;
  pending = false;
  return was;
}
