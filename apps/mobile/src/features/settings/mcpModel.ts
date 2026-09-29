export interface McpEntryLike {
  id?: string;
  name: string;
  description?: string;
  serverType?: 'http' | 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  source?: string;
  enabled?: boolean;
  userEnabled?: boolean;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  needsConfiguration?: { missingInputs?: string[]; missingCredentials?: string[] };
}

/** The switch position: the user's own toggle, not "on AND fully configured". */
export function mcpSwitchValue(entry: McpEntryLike): boolean {
  return entry.userEnabled ?? entry.enabled ?? true;
}

export function mcpNeedsConfiguration(entry: McpEntryLike): boolean {
  const n = entry.needsConfiguration;
  return Boolean(n && ((n.missingInputs?.length ?? 0) > 0 || (n.missingCredentials?.length ?? 0) > 0));
}

/**
 * Full-replacement body for `PUT /projects/:id/mcp-servers/:mid` and
 * `PUT /system/mcp-servers/custom/:id` that only flips `enabled`.
 *
 * Both routes treat the body as the COMPLETE desired server, credentials
 * included: a stored credential name left out is deleted. Echoing the
 * redacted `headers`/`env` maps from the GET keeps every stored value, so a
 * toggle can never wipe a token.
 */
export function mcpToggleBody(entry: McpEntryLike, enabled: boolean): Record<string, unknown> {
  const serverType = entry.serverType ?? (entry.command ? 'stdio' : 'http');
  const headers = entry.headers && Object.keys(entry.headers).length ? entry.headers : null;
  const env = entry.env && Object.keys(entry.env).length ? entry.env : null;
  return {
    name: entry.name,
    ...(entry.description ? { description: entry.description } : {}),
    serverType,
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.command ? { command: entry.command } : {}),
    ...(entry.args ? { args: entry.args } : {}),
    ...(entry.timeoutMs ? { timeoutMs: entry.timeoutMs } : {}),
    enabled,
    ...(serverType !== 'stdio' && headers ? { headers } : {}),
    ...(serverType === 'stdio' && env ? { env } : {}),
  };
}

/**
 * Which route flips a global server. Bundled (`system`) servers take a
 * prefs patch; `custom` ones take the full replacement body. Anything else
 * (a project server listed globally) is not toggleable from Settings.
 */
export function globalMcpToggle(
  entry: McpEntryLike,
  enabled: boolean,
): { source: 'system' | 'custom'; id: string; body: Record<string, unknown> } | null {
  if (!entry.id) return null;
  const id = entry.id;
  if (entry.source === 'system') return { source: 'system', id, body: { enabled } };
  if (entry.source === 'custom') return { source: 'custom', id, body: mcpToggleBody(entry, enabled) };
  return null;
}

export function mcpSubtitle(entry: McpEntryLike): string | null {
  if (entry.description) return entry.description;
  if (entry.url) return entry.url;
  if (entry.command) return [entry.command, ...(entry.args ?? [])].join(' ');
  return null;
}

