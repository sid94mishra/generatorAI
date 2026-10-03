// MSetMcpAdd / MCP setup (MDF-110): the custom-server form (Local = stdio: command, args, env; HTTP / SSE: URL,
// headers; timeout in seconds) and the bundled server's setup fields. Pure: the screen holds the draft, this turns it
// into the shared `McpServerBody` / `SystemMcpPrefsBody` and says what is missing. Secrets are written once and never
// read back (the server returns only the redaction marker).
import type { McpServerBody, SystemMcpPrefsBody } from '@generatorai/shared';

import type { McpEntryLike } from '../mcpModel';

export type McpTransport = 'stdio' | 'http' | 'sse';

export interface KeyValueDraft {
  key: string;
  value: string;
}

export interface McpDraft {
  name: string;
  transport: McpTransport;
  command: string;
  /** One line; split like a shell would for simple cases (quotes keep spaces). */
  args: string;
  url: string;
  /** env for Local, headers for HTTP / SSE. */
  pairs: KeyValueDraft[];
  /** Seconds; empty = the server default (180). */
  timeout: string;
}

export const EMPTY_MCP_DRAFT: McpDraft = { name: '', transport: 'stdio', command: '', args: '', url: '', pairs: [], timeout: '' };

export const DEFAULT_MCP_TIMEOUT_S = 180;

/** `-y "@scope/pkg name" --flag` → ['-y', '@scope/pkg name', '--flag']. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

const KEY_RE = /^[^\s=]+$/;

export interface McpDraftErrors {
  name?: string;
  command?: string;
  url?: string;
  pairs?: string;
  timeout?: string;
}

export function validateMcpDraft(d: McpDraft): McpDraftErrors {
  const errors: McpDraftErrors = {};
  if (!d.name.trim()) errors.name = 'Name the server';
  if (d.transport === 'stdio' && !d.command.trim()) errors.command = 'Enter the command that starts the server';
  if (d.transport !== 'stdio') {
    const url = d.url.trim();
    if (!url) errors.url = 'Enter the server URL';
    else if (!/^https?:\/\/\S+$/i.test(url)) errors.url = 'Use an http:// or https:// URL';
  }
  const keys = d.pairs.map((p) => p.key.trim()).filter(Boolean);
  if (d.pairs.some((p) => p.key.trim() && !KEY_RE.test(p.key.trim()))) errors.pairs = 'Keys cannot contain spaces or "="';
  else if (new Set(keys).size !== keys.length) errors.pairs = 'Each key can appear once';
  else if (d.pairs.some((p) => !p.key.trim() && p.value)) errors.pairs = 'Every value needs a key';
  if (d.timeout.trim()) {
    const n = Number(d.timeout);
    if (!Number.isInteger(n) || n <= 0 || n > 3600) errors.timeout = 'Whole seconds between 1 and 3600';
  }
  return errors;
}

export const hasErrors = (e: McpDraftErrors): boolean => Object.values(e).some(Boolean);

export function mcpBody(d: McpDraft): McpServerBody {
  const pairs = Object.fromEntries(d.pairs.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value]));
  const hasPairs = Object.keys(pairs).length > 0;
  const timeout = d.timeout.trim() ? Number(d.timeout) * 1000 : undefined;
  const base = { name: d.name.trim(), serverType: d.transport, enabled: true, ...(timeout ? { timeoutMs: timeout } : {}) } as const;
  if (d.transport === 'stdio') {
    const args = splitArgs(d.args);
    return { ...base, command: d.command.trim(), ...(args.length ? { args } : {}), ...(hasPairs ? { env: pairs } : {}) };
  }
  return { ...base, url: d.url.trim(), ...(hasPairs ? { headers: pairs } : {}) };
}

/** Dirty when anything was typed (the guard asks before discarding). */
export function mcpDraftDirty(d: McpDraft): boolean {
  return JSON.stringify(d) !== JSON.stringify(EMPTY_MCP_DRAFT);
}

// ── Bundled-server setup ("Set up <server>") ─────────────────────────────────────────────────────────────────────

export interface SetupField {
  /** `input:<key>` | `env:<name>` | `header:<name>`. */
  id: string;
  label: string;
  description?: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
  /** Saved non-secret input value (secrets are never returned). */
  initial: string;
}

export function setupFields(entry: McpEntryLike): SetupField[] {
  const fields: SetupField[] = [];
  for (const i of entry.inputs ?? []) {
    fields.push({ id: `input:${i.key}`, label: i.label, ...(i.description ? { description: i.description } : {}), required: i.required !== false, secret: false, ...(i.placeholder ? { placeholder: i.placeholder } : {}), initial: entry.inputValues?.[i.key] ?? '' });
  }
  for (const c of entry.credentials?.env ?? []) fields.push({ id: `env:${c.name}`, label: c.label, ...(c.description ? { description: c.description } : {}), required: c.required !== false, secret: true, placeholder: c.name, initial: '' });
  for (const c of entry.credentials?.headers ?? []) fields.push({ id: `header:${c.name}`, label: c.label, ...(c.description ? { description: c.description } : {}), required: c.required !== false, secret: true, placeholder: c.name, initial: '' });
  return fields;
}

/** Which required fields are still missing on the server (a stored secret counts as filled). */
export function missingSetup(entry: McpEntryLike): ReadonlySet<string> {
  const n = entry.needsConfiguration;
  return new Set([...(n?.missingInputs ?? []).map((k) => `input:${k}`), ...(n?.missingCredentials ?? []).flatMap((k) => [`env:${k}`, `header:${k}`])]);
}

/** "0 of 1 required fields filled": a field counts when typed now or not missing on the server. */
export function setupProgress(fields: ReadonlyArray<SetupField>, values: Record<string, string>, missing: ReadonlySet<string>): { filled: number; required: number } {
  const required = fields.filter((f) => f.required);
  const filled = required.filter((f) => (values[f.id] ?? f.initial).trim() || !missing.has(f.id)).length;
  return { filled, required: required.length };
}

/** Only what was typed: an untouched secret keeps the stored one. */
export function setupBody(fields: ReadonlyArray<SetupField>, values: Record<string, string>, enable: boolean): SystemMcpPrefsBody {
  const inputs: Record<string, string> = {};
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.id];
    if (v === undefined || (f.secret && !v)) continue;
    const [kind, name] = [f.id.slice(0, f.id.indexOf(':')), f.id.slice(f.id.indexOf(':') + 1)];
    if (kind === 'input') inputs[name] = v.trim();
    else if (kind === 'env') env[name] = v;
    else headers[name] = v;
  }
  return {
    ...(enable ? { enabled: true } : {}),
    ...(Object.keys(inputs).length ? { inputs } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  };
}

/** Transport badge text (MSetMcp "STDIO"). */
export function transportLabel(entry: McpEntryLike): string {
  const t = entry.serverType ?? (entry.command ? 'stdio' : 'http');
  return t.toUpperCase();
}
