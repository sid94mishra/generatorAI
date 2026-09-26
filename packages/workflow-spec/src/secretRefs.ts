// ────────────────────────────────────────────────────────────────
// Where a workflow's `secretref:` values may point (final review
// PLATFORM R1/R2). A reference is resolved from the server's secret store
// and sent to a program or an endpoint the workflow names, so each field may
// read only the namespace meant for it:
//   - `session.provider.apiKey`         → `secretref:provider/<name>`;
//   - an MCP server's `headers`/`env`   → that server's own credentials,
//     `secretref:mcp/<system|project|custom>/<server id>/<name>` (the
//     server's key in `mcp.servers` is its catalog id);
//   - check, hook, action and `custom_script` rule `env`/`headers`
//                                       → `secretref:workflow/<name>`.
// The validator refuses any other namespace, and the server's resolvers
// (packages/core/src/mcp) apply the same rules, so a pointer that slipped
// past the validator is never read either.
// ────────────────────────────────────────────────────────────────

export const SECRET_REF_PREFIX = 'secretref:';

/** The namespace of secrets stored for workflow commands, hooks and rules. */
export const WORKFLOW_SECRET_NAMESPACE = 'workflow';

/** The namespace of BYOK provider keys. */
export const PROVIDER_SECRET_NAMESPACE = 'provider';

/** The scopes of MCP server credential namespaces (`mcp/<scope>/<id>`). */
export const MCP_CREDENTIAL_SCOPES = ['system', 'project', 'custom'] as const;

/** Split `secretref:<namespace>/<name>` (the name is after the last `/`). Null when it is not one. */
export function parseSecretRef(value: string): { namespace: string; name: string } | null {
  if (!value.startsWith(SECRET_REF_PREFIX)) return null;
  const body = value.slice(SECRET_REF_PREFIX.length);
  const idx = body.lastIndexOf('/');
  if (idx <= 0 || idx === body.length - 1) return null;
  return { namespace: body.slice(0, idx), name: body.slice(idx + 1) };
}

/** The server id of an MCP credential namespace `mcp/<scope>/<id>`, or null. */
export function mcpCredentialServerId(namespace: string): string | null {
  const m = /^mcp\/([^/]+)\/(.+)$/.exec(namespace);
  if (!m || !(MCP_CREDENTIAL_SCOPES as readonly string[]).includes(m[1]!)) return null;
  return m[2]!;
}

/** `secretref:workflow/<name>`: a secret a command, hook or rule may read. */
export function isWorkflowSecretRef(value: string): boolean {
  return parseSecretRef(value)?.namespace === WORKFLOW_SECRET_NAMESPACE;
}

/** `secretref:mcp/<scope>/<serverId>/<name>`: one of the MCP server's own credentials. */
export function isOwnMcpSecretRef(serverId: string, value: string): boolean {
  const ref = parseSecretRef(value);
  return ref !== null && mcpCredentialServerId(ref.namespace) === serverId;
}
