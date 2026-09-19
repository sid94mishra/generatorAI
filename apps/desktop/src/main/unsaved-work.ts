// ────────────────────────────────────────────────────────────────
// Unsaved-work flag.
//
// The renderer guards in-app navigation itself (react-router blocks the route
// change and asks), but it cannot see the native close button, Cmd+W or a
// quit — those end the window from outside the page, and the edits went with
// it silently. The renderer therefore reports whether it is holding anything
// unsaved, and the shell asks before closing.
//
// Its own module rather than a field on the menu so `window-manager` can read
// it without importing `menu`, which imports `window-manager`.
// ────────────────────────────────────────────────────────────────

let unsaved = false;

export function setUnsavedWork(value: boolean): void {
  unsaved = value;
}

export function hasUnsavedWork(): boolean {
  return unsaved;
}
