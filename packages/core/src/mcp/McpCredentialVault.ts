// ────────────────────────────────────────────────────────────────
// McpCredentialVault — the only code that touches MCP credential VALUES.
//
// Writes go to the `SecretStore` under `mcp/<scope>/<id>`; everything else
// in the system (DB rows, project JSON files, resolved projections, chat
// snapshots, GET responses) only ever holds a `secretref:` pointer or the
// names of the credentials. `injectSecrets()` swaps the pointers for values
// at the last possible moment — inside the MCP hub, immediately before the
// map is handed to the harness SDK.
//
// Every read is namespace-restricted (final review PLATFORM R1/R2): a
// pointer is resolved only inside the namespace its field may read — a BYOK
// provider key from `provider/`, an MCP server's header/env from that
// server's own `mcp/<scope>/<id>/`, a workflow command/hook/rule env or
// header from `workflow/` (the rules live in workflow-spec secretRefs.ts,
// which the validator applies at save).
// ────────────────────────────────────────────────────────────────

import type { SecretStore } from '@generatorai/secrets';
import { mcpCredentialServerId, PROVIDER_SECRET_NAMESPACE, WORKFLOW_SECRET_NAMESPACE } from '@generatorai/workflow-spec';
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
  /**
   * Servers dropped because a pointer had no value in the vault, or (`refused`)
   * named a secret outside the server's own credential namespace.
   */
  missing: Array<{ server: string; ref: string; refused?: boolean }>;
}

/** The only secret namespace a BYOK provider key may be read from (`secretref:provider/<name>`). */
export const BYOK_PROVIDER_SECRET_NAMESPACE = PROVIDER_SECRET_NAMESPACE;

/**
 * Resolves the `secretref:` values of a workflow's commands, hooks and rules
 * (check `env`, script hook `env`, http hook `headers`, `custom_script` rule
 * `env`): `secretref:workflow/<name>` only. Null when the pointer names
 * another namespace or the store has no value.
 */
export interface WorkflowSecretResolver {
  resolveWorkflowSecret(ref: string): Promise<string | null>;
}

export class McpCredentialVault implements WorkflowSecretResolver {
  constructor(private readonly secrets: SecretStore) {}

  /** The one read: the value behind `ref` when its namespace passes `allowed`, else null (the store is not read). */
  private async resolveIn(ref: string, allowed: (namespace: string) => boolean): Promise<string | null> {
    const parsed = parseMcpSecretRef(ref);
    if (!parsed || !allowed(parsed.namespace)) return null;
    return (await getSecretString(this.secrets, parsed.namespace, parsed.name)) ?? null;
  }

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

  /**
   * The value behind one BYOK provider-key pointer
   * (`secretref:provider/<name>`), or null when the store has none. Every
   * other namespace is refused: a session's provider sends this value to a
   * caller-chosen `baseUrl`, so it must never be able to name an MCP server
   * credential or any other stored secret (P02 review R1).
   */
  async resolveRef(ref: string): Promise<string | null> {
    return this.resolveIn(ref, (ns) => ns === BYOK_PROVIDER_SECRET_NAMESPACE);
  }

  /** A workflow command/hook/rule secret: `secretref:workflow/<name>` only. */
  async resolveWorkflowSecret(ref: string): Promise<string | null> {
    return this.resolveIn(ref, (ns) => ns === WORKFLOW_SECRET_NAMESPACE);
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
   *
   * A server reads only its own credentials: every pointer must name an MCP
   * credential namespace (`mcp/<system|project|custom>/<id>`), and all of a
   * server's pointers the same one. A pointer to any other secret (a provider
   * key, the system keys, a harness key) is refused without reading the
   * store, and the server is dropped (final review PLATFORM R1).
   */
  async injectSecrets(servers: Record<string, McpServerConfig>): Promise<McpSecretInjectionResult> {
    const out: Record<string, McpServerConfig> = {};
    const missing: McpSecretInjectionResult['missing'] = [];
    for (const [name, cfg] of Object.entries(servers)) {
      let ok = true;
      let own: string | undefined;
      const next: McpServerConfig = { ...cfg };
      for (const field of ['headers', 'env'] as const) {
        const map = cfg[field];
        if (!map) continue;
        const resolved: Record<string, string> = {};
        for (const [k, v] of Object.entries(map)) {
          // A masked literal (a redacted snapshot) has no value to send.
          if (v === MCP_REDACTED_VALUE) { missing.push({ server: name, ref: `${field}.${k}` }); ok = false; break; }
          if (!isMcpSecretRef(v)) { resolved[k] = v; continue; }
          const ns = parseMcpSecretRef(v)?.namespace;
          if (ns === undefined || mcpCredentialServerId(ns) === null || (own !== undefined && ns !== own)) {
            missing.push({ server: name, ref: v, refused: true }); ok = false; break;
          }
          own = ns;
          const value = await this.resolveIn(v, (n) => n === ns);
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
