// ────────────────────────────────────────────────────────────────
// MCP server types — the one vocabulary for every MCP surface.
//
// GeneratorAI does NOT speak the MCP protocol. It is a CONFIG FORWARDER: it
// decides which servers a conversation gets, resolves their credentials, and
// hands the finished `McpServerConfig` map to the harness SDK (Claude Agent
// SDK / Copilot SDK), which connects to the servers and exposes their tools.
//
// Three registries feed that map:
//   • the BUNDLED catalog  `templates/system/mcp-servers.json` (read-only)
//   • CUSTOM servers       added in Settings → MCP Servers (server-side JSON)
//   • PROJECT servers      `project_configs` rows of type `mcp`
//
// Credentials never live next to the config. Every header / env value the
// user supplies is written to the secrets vault, and the config carries a
// `secretref:` pointer that is swapped for the value only at the moment the
// harness receives it (see `packages/core/src/mcp`). Persisted snapshots,
// GET responses and logs therefore only ever see the pointer or `••••`.
// ────────────────────────────────────────────────────────────────

import { SECRET_MASK } from '../utils/secretRefs.js';

export type McpTransport = 'stdio' | 'http' | 'sse';

/** Where a catalog entry came from. `custom` = added in global Settings. */
export type McpServerSource = 'system' | 'project' | 'custom';

/** Marker written into a `McpServerConfig` header/env VALUE instead of the secret. */
export const MCP_SECRET_REF_PREFIX = 'secretref:';

/**
 * What a GET returns in place of a credential value. Same literal as the
 * generic `SECRET_MASK` (packages/shared/src/utils/secretRefs.ts) — MCP
 * uses its own `secretref:`/vault-namespace scheme (see
 * `packages/core/src/mcp`) rather than the generic `${secret:...}` one, but
 * a redacted value should read identically everywhere in the app.
 */
export const MCP_REDACTED_VALUE = SECRET_MASK;

/** Names of the credentials a server owns, by kind. Safe to persist and log. */
export interface McpCredentialRefs {
  headers?: string[];
  env?: string[];
}

/**
 * Credential VALUES as accepted by the write APIs. A value equal to
 * `MCP_REDACTED_VALUE` means "keep what is stored"; a key that is absent
 * means "remove it".
 */
export interface McpCredentialInput {
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

/** Vault namespace for one server's credentials. */
export function mcpCredentialNamespace(scope: McpServerSource, id: string): string {
  return `mcp/${scope}/${id}`;
}

/** Vault secret name for one credential. */
export function mcpCredentialSecretName(kind: 'header' | 'env', key: string): string {
  return `${kind}:${key}`;
}

/** Build the pointer stored in a config in place of the value. */
export function mcpSecretRef(namespace: string, name: string): string {
  return `${MCP_SECRET_REF_PREFIX}${namespace}/${name}`;
}

export function isMcpSecretRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(MCP_SECRET_REF_PREFIX);
}

/** Split a pointer back into vault coordinates. `null` when malformed. */
export function parseMcpSecretRef(value: string): { namespace: string; name: string } | null {
  if (!isMcpSecretRef(value)) return null;
  const body = value.slice(MCP_SECRET_REF_PREFIX.length);
  const idx = body.lastIndexOf('/');
  if (idx <= 0 || idx === body.length - 1) return null;
  return { namespace: body.slice(0, idx), name: body.slice(idx + 1) };
}

/** Replace every value of a header/env map with the redaction marker. */
export function redactMcpValues(
  map: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!map) return undefined;
  const out: Record<string, string> = {};
  for (const k of Object.keys(map)) out[k] = MCP_REDACTED_VALUE;
  return out;
}

// ── Bundled catalog (templates/system/mcp-servers.json) ──

/** A value the user must supply before a bundled server is usable. */
export interface SystemMcpCatalogInput {
  /** Placeholder key, referenced as `{{key}}` in `args` / `url` / `command`. */
  key: string;
  label: string;
  description?: string;
  kind?: 'path' | 'text' | 'url';
  /** Default `true`. */
  required?: boolean;
  placeholder?: string;
}

/** A credential a bundled server needs (env var or HTTP header). */
export interface SystemMcpCatalogCredential {
  name: string;
  label: string;
  description?: string;
  /** Default `true`. */
  required?: boolean;
}

export interface SystemMcpCatalogEntry {
  id: string;
  name: string;
  description?: string;
  serverType: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  category?: string;
  /** Ships enabled unless the user turns it off. Default `true`. */
  enabled?: boolean;
  inputs?: SystemMcpCatalogInput[];
  credentials?: {
    env?: SystemMcpCatalogCredential[];
    headers?: SystemMcpCatalogCredential[];
  };
}

/** `{{key}}` placeholders in a catalog string. */
export const MCP_PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

// ── Server-side settings (mcp-settings.json in the data dir) ──

/** Per-bundled-server user preferences. */
export interface SystemMcpServerPrefs {
  enabled?: boolean;
  /** Values for the entry's `inputs`. */
  inputs?: Record<string, string>;
  credentialRefs?: McpCredentialRefs;
}

/** A server the user added in global Settings. */
export interface CustomMcpServerRecord {
  id: string;
  name: string;
  description?: string;
  serverType: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  timeoutMs?: number;
  enabled: boolean;
  credentialRefs: McpCredentialRefs;
  createdAt: number;
  updatedAt: number;
}

export interface McpSettings {
  version: 1;
  system: Record<string, SystemMcpServerPrefs>;
  custom: CustomMcpServerRecord[];
}

/** Why a server cannot be sent to a harness yet. */
export interface McpNeedsConfiguration {
  missingInputs: string[];
  missingCredentials: string[];
}

// ── Startup-status mapping (SDK `system/init` → visible warning) ──

export interface McpServerStartupStatus {
  name: string;
  /** Claude reports `connected | failed | needs-auth | pending | disabled`. */
  status: string;
  error?: string;
}

export interface McpStartupWarning {
  code: 'MCP_SERVER_FAILED' | 'MCP_SERVER_NEEDS_AUTH';
  message: string;
  details: { server: string; status: string; error?: string };
}

/**
 * Turn the harness's per-server startup report into user-visible warnings.
 * Only terminal-bad states qualify: `pending` is transient and `disabled` is
 * the user's own choice.
 */
export function mcpStartupWarnings(
  servers: ReadonlyArray<McpServerStartupStatus> | undefined,
): McpStartupWarning[] {
  const out: McpStartupWarning[] = [];
  for (const s of servers ?? []) {
    if (!s || typeof s.name !== 'string') continue;
    if (s.status === 'failed') {
      out.push({
        code: 'MCP_SERVER_FAILED',
        message: `MCP server "${s.name}" failed to start${s.error ? `: ${s.error}` : ''}. Its tools are unavailable for this turn.`,
        details: { server: s.name, status: s.status, ...(s.error ? { error: s.error } : {}) },
      });
    } else if (s.status === 'needs-auth') {
      out.push({
        code: 'MCP_SERVER_NEEDS_AUTH',
        message: `MCP server "${s.name}" needs authentication. Add its credentials in Settings → MCP Servers.`,
        details: { server: s.name, status: s.status },
      });
    }
  }
  return out;
}
