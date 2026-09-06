// ────────────────────────────────────────────────────────────────
// McpCredentialVault — the only code that touches MCP credential VALUES.
//
// Writes go to the `SecretStore` under `mcp/<scope>/<id>`; everything else
// in the system (DB rows, project JSON files, resolved projections, chat
// snapshots, GET responses) only ever holds a `secretref:` pointer or the
// names of the credentials. `injectSecrets()` swaps the pointers for values
// at the last possible moment — inside the MCP hub, immediately before the
// map is handed to the harness SDK.
// ────────────────────────────────────────────────────────────────

import type { SecretStore } from '@generatorai/secrets';
import { getSecretString, setSecretString } from '@generatorai/secrets';
import {
  MCP_REDACTED_VALUE,
  isMcpSecretRef,
  mcpCredentialSecretName,
  mcpSecretRef,
  parseMcpSecretRef,
} from '@generatorai/shared';
import type { McpCredentialInput, McpCredentialRefs, McpServerConfig } from '@generatorai/shared';

export interface McpSecretInjectionResult {
  servers: Record<string, McpServerConfig>;
  /** Servers dropped because a pointer had no value in the vault. */
  missing: Array<{ server: string; ref: string }>;
}

export class McpCredentialVault {
  constructor(private readonly secrets: SecretStore) {}

  /**
   * Persist the credentials in `input` under `namespace` and return the refs
   * to store alongside the config.
   *
   * Semantics per key: a real value replaces; `MCP_REDACTED_VALUE` keeps the
   * stored value (the UI echoes the marker back for untouched fields); a key
   * missing from the input but present in `existing` is deleted. So the input
   * is always the FULL desired set, which is what a form submit produces.
   */
  async save(
    namespace: string,
    input: McpCredentialInput,
    existing: McpCredentialRefs = {},
  ): Promise<McpCredentialRefs> {
    const out: McpCredentialRefs = {};
    for (const kind of ['headers', 'env'] as const) {
      const secretKind = kind === 'headers' ? 'header' : 'env';
      const wanted = input[kind] ?? {};
      const keep: string[] = [];
      for (const [key, value] of Object.entries(wanted)) {
        if (value === MCP_REDACTED_VALUE) {
          if (existing[kind]?.includes(key)) keep.push(key);
          continue; // marker for a key that was never stored: ignore
        }
        await setSecretString(this.secrets, namespace, mcpCredentialSecretName(secretKind, key), value);
        keep.push(key);
      }
      for (const stale of existing[kind] ?? []) {
        if (!keep.includes(stale)) {
          await this.secrets.remove(namespace, mcpCredentialSecretName(secretKind, stale));
        }
      }
      if (keep.length > 0) out[kind] = keep.sort();
    }
    return out;
  }

  /** Delete every credential of one server. */
  async remove(namespace: string): Promise<void> {
    await this.secrets.removeNamespace(namespace);
  }

  /** Pointer maps to put on a config in place of values. */
  static refsToConfigFields(
    namespace: string,
    refs: McpCredentialRefs | undefined,
  ): Pick<McpServerConfig, 'headers' | 'env'> {
    const out: Pick<McpServerConfig, 'headers' | 'env'> = {};
    if (refs?.headers?.length) {
      out.headers = Object.fromEntries(
        refs.headers.map((k) => [k, mcpSecretRef(namespace, mcpCredentialSecretName('header', k))]),
      );
    }
    if (refs?.env?.length) {
      out.env = Object.fromEntries(
        refs.env.map((k) => [k, mcpSecretRef(namespace, mcpCredentialSecretName('env', k))]),
      );
    }
    return out;
  }

  /**
   * Replace every `secretref:` value with the stored secret. A server whose
   * pointer cannot be resolved is DROPPED (sending it would either leak the
   * pointer string to a third party as a bearer token or fail confusingly)
   * and reported in `missing` so the caller can surface it.
   */
  async injectSecrets(servers: Record<string, McpServerConfig>): Promise<McpSecretInjectionResult> {
    const out: Record<string, McpServerConfig> = {};
    const missing: Array<{ server: string; ref: string }> = [];
    for (const [name, cfg] of Object.entries(servers)) {
      let ok = true;
      const next: McpServerConfig = { ...cfg };
      for (const field of ['headers', 'env'] as const) {
        const map = cfg[field];
        if (!map) continue;
        const resolved: Record<string, string> = {};
        for (const [k, v] of Object.entries(map)) {
          if (!isMcpSecretRef(v)) { resolved[k] = v; continue; }
          const ref = parseMcpSecretRef(v);
          const value = ref ? await getSecretString(this.secrets, ref.namespace, ref.name) : null;
          if (value == null) { missing.push({ server: name, ref: v }); ok = false; break; }
          resolved[k] = value;
        }
        if (!ok) break;
        next[field] = resolved;
      }
      if (ok) out[name] = next;
    }
    return { servers: out, missing };
  }
}
