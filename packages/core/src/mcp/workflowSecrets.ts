// ────────────────────────────────────────────────────────────────
// workflowSecrets — the `secretref:` values of a workflow's commands, hooks
// and rules (check `env`, script hook `env`, http hook `headers`,
// `custom_script` rule `env`), resolved through the vault's namespace-
// restricted reader: `secretref:workflow/<name>` only (final review
// PLATFORM R2). A pointer is never passed on verbatim: an unresolved one is
// an error the caller turns into a launch failure. Values of the resolved
// secrets are redacted from whatever output the caller keeps.
// ────────────────────────────────────────────────────────────────

import { isMcpSecretRef, SECRET_MASK } from '@generatorai/shared';
import type { WorkflowSecretResolver } from './McpCredentialVault.js';

export type ResolvedSecretMap =
  | { ok: true; values: Record<string, string>; secrets: string[] }
  | { ok: false; error: string };

/**
 * Swap each `secretref:` value of `map` for its secret; other values pass
 * through `render` (a template), whose failure is an error too.
 */
export async function resolveSecretMap(
  map: Readonly<Record<string, string>> | undefined,
  resolver: WorkflowSecretResolver | undefined,
  field: string,
  render: (text: string) => { ok: true; text: string } | { ok: false; error: string } = (text) => ({ ok: true, text }),
): Promise<ResolvedSecretMap> {
  const values: Record<string, string> = {};
  const secrets: string[] = [];
  for (const [name, text] of Object.entries(map ?? {})) {
    if (isMcpSecretRef(text)) {
      const value = resolver ? await resolver.resolveWorkflowSecret(text) : null;
      if (value == null) {
        return {
          ok: false,
          error: resolver
            ? `${field}.${name}: ${text} could not be resolved (only secretref:workflow/<name> secrets that are stored can be used here)`
            : `${field}.${name}: ${text} cannot be resolved, no secrets vault is configured`,
        };
      }
      values[name] = value;
      secrets.push(value);
      continue;
    }
    const r = render(text);
    if (!r.ok) return { ok: false, error: `${field}.${name}: ${r.error}` };
    values[name] = r.text;
  }
  return { ok: true, values, secrets };
}

/** `text` with every resolved secret value (four characters or longer) masked. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join(SECRET_MASK);
  return out;
}
