// ────────────────────────────────────────────────────────────────
// Dynamic shell completion.
//
// Static completion knows the command tree; this half knows the DATA. A user
// typing `generatorai run watch <Tab>` wants run ids, and the only place
// those exist is the server.
//
// Two rules govern everything here:
//   1. Never throw. A shell renders whatever comes back as a candidate, so an
//      error message would be offered as something to complete to.
//   2. Never be slow. Tab must feel instant, so every lookup is bounded and
//      the whole call is capped by a short timeout.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  ConnectionManager,
  createCliClient,
  DEFAULT_KEYMAP,
  readUserConfig,
  terminalThemeIdsSafe,
  type CompletionSource,
} from './completionSupport.js';
import type { GlobalFlags, Session } from './session.js';

const LOOKUP_TIMEOUT_MS = 1500;
const MAX_CANDIDATES = 100;

export interface LookupOptions {
  getSession(): Promise<Session>;
  flags: GlobalFlags;
  signal: AbortSignal;
}

/** Adds a `— label` suffix so shells that show descriptions have one. */
function candidate(id: string, label?: string | null): string {
  return label ? `${id}\t${label}` : id;
}

export async function dynamicCompletionLookup(
  source: string,
  prefix: string,
  options: LookupOptions,
): Promise<string[]> {
  const timeout = new Promise<string[]>((resolve) => {
    const timer = setTimeout(() => resolve([]), LOOKUP_TIMEOUT_MS);
    timer.unref();
  });

  return Promise.race([lookup(source as CompletionSource, prefix, options), timeout]).catch(() => []);
}

async function lookup(
  source: CompletionSource,
  prefix: string,
  options: LookupOptions,
): Promise<string[]> {
  const lowered = prefix.toLowerCase();
  const match = (value: string) => value.toLowerCase().startsWith(lowered);

  // Sources that need no server come first: completing a connection name when
  // no server is reachable is exactly when it matters most.
  switch (source) {
    case 'connection': {
      const manager = new ConnectionManager();
      return manager
        .list()
        .map((c) => candidate(c.label, c.endpoint))
        .filter((c) => match(c));
    }
    case 'profile': {
      const config = await readUserConfig();
      return Object.keys(config.profiles).filter(match);
    }
    case 'theme':
      return terminalThemeIdsSafe()
        .map((t) => candidate(t.id, t.label))
        .filter(match);
    case 'shell':
      return ['bash', 'zsh', 'fish', 'powershell', 'nushell'].filter(match);
    case 'file':
    case 'directory':
      return completePath(prefix, source === 'directory');
    default:
      break;
  }

  const session = await options.getSession();
  const client = await createCliClient({
    config: session.config,
    ...(options.flags.server ? { serverUrl: options.flags.server } : {}),
    ...(options.flags.connection ? { connectionRef: options.flags.connection } : {}),
    signal: options.signal,
  });

  try {
    const rows = await fetchCandidates(source, client.api);
    return rows
      .map(({ id, label }) => candidate(id, label))
      .filter((c) => match(c) || match(c.split('\t')[1] ?? ''))
      .slice(0, MAX_CANDIDATES);
  } finally {
    client.dispose();
  }
}

async function fetchCandidates(
  source: CompletionSource,
  api: Awaited<ReturnType<typeof createCliClient>>['api'],
): Promise<Array<{ id: string; label?: string | null }>> {
  switch (source) {
    case 'chat':
      return (await api.chats.list({ limit: MAX_CANDIDATES })).map((c) => ({ id: c.id, label: c.name }));
    case 'agent':
      return (await api.agents.list()).map((a) => ({
        id: (a as { id: string }).id,
        label: (a as { name?: string }).name,
      }));
    case 'workflow':
      return (await api.definitions.list()).map((w) => ({
        id: (w as { id: string }).id,
        label: (w as { name?: string }).name,
      }));
    case 'run':
      return (await api.runs.list({ limit: MAX_CANDIDATES })).map((r) => ({
        id: r.id,
        label: r.name ?? r.status,
      }));
    case 'automation':
      return (await api.automations.list()).map((a) => ({
        id: (a as { id: string }).id,
        label: (a as { name?: string }).name,
      }));
    case 'project':
      return (await api.projects.list()).map((p) => ({
        id: (p as { id: string }).id,
        label: (p as { name?: string }).name,
      }));
    case 'workspace':
      return (await api.workspaces.list({ limit: MAX_CANDIDATES })).map((w) => ({
        id: w.id,
        label: `${w.ownerType}:${w.status}`,
      }));
    case 'script':
      return (await api.scripts.list()).map((s) => ({ id: s.id, label: s.name }));
    case 'template':
      return (await api.templates.list()).map((t) => ({
        id: String((t as { id?: unknown }).id ?? ''),
        label: String((t as { name?: unknown }).name ?? ''),
      }));
    case 'extension':
      return (await api.extensions.list()).map((e) => ({ id: e.id, label: e.name }));
    case 'widget':
      return (await api.widgets.list()).map((w) => ({ id: w.id, label: w.title }));
    case 'model': {
      const providers = (await api.harness.providers()) as {
        providers?: Array<{ models?: Array<{ id: string; name?: string }> }>;
      };
      return (providers.providers ?? []).flatMap((p) =>
        (p.models ?? []).map((m) => ({ id: m.id, label: m.name })),
      );
    }
    // `stage` and `codebase` are scoped to a parent whose id the shell has not
    // necessarily typed yet. Offering every stage on the server would be
    // noise, so they fall through to no candidates.
    default:
      return [];
  }
}

/** Filesystem completion, relative to what the user has typed so far. */
async function completePath(prefix: string, directoriesOnly: boolean): Promise<string[]> {
  const expanded = prefix.startsWith('~')
    ? path.join(process.env['HOME'] ?? process.env['USERPROFILE'] ?? '', prefix.slice(1))
    : prefix;
  const directory = expanded.endsWith(path.sep) ? expanded : path.dirname(expanded) || '.';
  const base = expanded.endsWith(path.sep) ? '' : path.basename(expanded);

  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.name.startsWith(base))
    .filter((entry) => !directoriesOnly || entry.isDirectory())
    .map((entry) => path.join(directory, entry.name) + (entry.isDirectory() ? path.sep : ''))
    .slice(0, MAX_CANDIDATES);
}

export { DEFAULT_KEYMAP };
