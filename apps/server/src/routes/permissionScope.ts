// ────────────────────────────────────────────────────────────────
// Who may turn tool approvals OFF (chats, runs, automations), and who a
// chat acts for.
// ────────────────────────────────────────────────────────────────

import type { ChatPrincipal } from '@generatorai/shared';

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

/**
 * May this caller set or change a BYOK `provider` (a chat's
 * `harnessConfig.provider`)? The provider's key is a stored secret the server
 * sends to the provider's `baseUrl`, so choosing the endpoint is as
 * privileged as reading the secret (P02 review R1). Workflows get the same
 * rule through the command-bearing fingerprint.
 */
export function canSetSessionProvider(req: { principal?: { scopes?: readonly string[] } }): boolean {
  return canBypassPermissions(req);
}

/**
 * The principal a chat is created by (P06 WP-6.2): its in-process workflow
 * tools act with these scopes. No principal is unauthenticated loopback
 * development: the local owner.
 */
export function chatPrincipalOf(req: {
  principal?: { type: string; id: string; deviceId?: string; scopes: readonly string[] } | undefined;
}): ChatPrincipal {
  const p = req.principal;
  if (!p) return { kind: 'local', id: 'local', scopes: [] };
  const kind: ChatPrincipal['kind'] =
    p.type === 'service-account'
      ? 'service_account'
      : p.type === 'paired-device' || p.type === 'user-session'
        ? 'device'
        : p.type === 'internal-service'
          ? 'system'
          : 'local';
  return { kind, id: p.deviceId ?? p.id, scopes: [...p.scopes] };
}
