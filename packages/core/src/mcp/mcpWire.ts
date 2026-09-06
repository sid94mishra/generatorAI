// ────────────────────────────────────────────────────────────────
// mcpWire — catalog entry → what a client may see.
//
// The catalog carries `secretref:` pointers in `config.headers` / `config.env`.
// Those are not secrets, but a client has no use for them either, so every
// credential value on the wire is the redaction marker and the client learns
// only WHICH keys exist (`hasCredentials`, the keys of the redacted maps).
// ────────────────────────────────────────────────────────────────

import { redactMcpValues } from '@generatorai/shared';
import type { McpServerEntry } from '@generatorai/shared';
import type { CatalogMcpServer } from '../services/ArtifactCatalog.js';

export function toMcpServerEntry(s: CatalogMcpServer): McpServerEntry {
  const headers = redactMcpValues(s.config.headers);
  const env = redactMcpValues(s.config.env);
  return {
    id: s.id,
    name: s.name,
    ...(s.description ? { description: s.description } : {}),
    serverType: s.config.type,
    ...(s.config.url ? { url: s.config.url } : {}),
    ...(s.config.command ? { command: s.config.command } : {}),
    ...(s.config.args ? { args: s.config.args } : {}),
    ...(s.config.timeoutMs ? { timeoutMs: s.config.timeoutMs } : {}),
    source: s.source,
    enabled: s.enabled,
    userEnabled: s.userEnabled,
    ...(headers && Object.keys(headers).length ? { headers } : {}),
    ...(env && Object.keys(env).length ? { env } : {}),
    hasCredentials: Boolean(
      (s.credentialRefs?.headers?.length ?? 0) + (s.credentialRefs?.env?.length ?? 0),
    ),
    ...(s.needsConfiguration ? { needsConfiguration: s.needsConfiguration } : {}),
    ...(s.catalog?.inputs ? { inputs: s.catalog.inputs } : {}),
    ...(s.inputValues ? { inputValues: s.inputValues } : {}),
    ...(s.catalog?.credentials ? { credentials: s.catalog.credentials } : {}),
    ...(s.catalog?.category ? { category: s.catalog.category } : {}),
  };
}
