// ────────────────────────────────────────────────────────────────
// Who may turn tool approvals OFF (chats, runs, automations).
// ────────────────────────────────────────────────────────────────

/**
 * May this caller set `bypassPermissions` — on a chat, a live run, or an
 * unattended automation?
 *
 * `write:chats` / `write:workflows` are default grants on every paired
 * device, and dropping the approval gate is equivalent to running code on the
 * host (review 5.2). Dropping it is the privileged act and needs an
 * administrative scope; entering a gated mode never does.
 */
export function canBypassPermissions(req: { principal?: { scopes?: readonly string[] } }): boolean {
  const scopes = req.principal?.scopes;
  // No principal at all is unauthenticated-loopback development mode, which
  // is already fully trusted by design.
  if (!scopes) return true;
  return scopes.includes('admin:settings');
}
