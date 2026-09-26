// ────────────────────────────────────────────────────────────────
// `generatorai://…` → in-app route. Kept free of Electron imports so the rules
// are unit-testable on every OS.
//
// A deep link comes from any program on the machine (a browser, a chat app, a
// JumpList task), so it is untrusted input: the path is kept, the hash is
// dropped and the query is reduced to the keys the app reads from a link
// (05-gap-matrix.md G-08). Everything else is discarded, so a link can never
// inject a parameter some page happens to act on. `command/<id>` links run a
// registry command, and only one on the deep-link allowlist (06 §8).
// ────────────────────────────────────────────────────────────────

import { isDeepLinkCommandId, type DeepLinkCommandId } from '@generatorai/shared/ui-contract';

export const DEEP_LINK_PROTOCOL = 'generatorai';

/**
 * Query keys a deep link may carry into the app:
 * `pair` (AuthGate pairing code), `dock` / `tab` (chat dock and page tabs),
 * `kind` (list filters) and `run` (a workflow run inside a chat).
 */
export const DEEP_LINK_QUERY_KEYS: readonly string[] = ['pair', 'dock', 'tab', 'kind', 'run'];

const PREFIX = `${DEEP_LINK_PROTOCOL}://`;

/** True when `value` is a `generatorai://` URL (the scheme is case-insensitive). */
export function isDeepLink(value: string): boolean {
  return value.slice(0, PREFIX.length).toLowerCase() === PREFIX;
}

/**
 * Extract the deep-link URL from a process argv list (Windows and Linux: cold
 * start via `process.argv`, warm start via `second-instance`). Chromium adds
 * its own switches around it and Windows may wrap it in quotes.
 */
export function findDeepLinkInArgv(argv: readonly string[]): string | undefined {
  for (const raw of argv) {
    const arg = raw.trim().replace(/^"(.*)"$/, '$1');
    if (isDeepLink(arg)) return arg;
  }
  return undefined;
}

function keepAllowed(params: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const [key, value] of params) {
    if (DEEP_LINK_QUERY_KEYS.includes(key)) kept.append(key, value);
  }
  const query = kept.toString();
  return query ? `?${query}` : '';
}

/**
 * Convert a `generatorai://` URL into an in-app route (`path + allowlisted
 * query`), or `null` when it is not a deep link.
 *
 * - `generatorai://chats/abc?dock=changes&x=1#h` → `/chats/abc?dock=changes`
 * - `generatorai:///workflows` → `/workflows` (empty host form)
 * - `generatorai://pair?code=ABCD-…` → `/?pair=ABCD-…` (the pairing screen reads
 *   `?pair=` on any route; Windows may add a slash: `pair/?code=`)
 */
export function deepLinkToRoute(url: string): string | null {
  if (!isDeepLink(url)) return null;
  const rest = url.slice(PREFIX.length).split('#')[0]!;
  const queryAt = rest.indexOf('?');
  const rawPath = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const rawQuery = queryAt === -1 ? '' : rest.slice(queryAt + 1);

  const segments = rawPath.split('/').filter((s) => s.length > 0);
  // A dot segment would let the route climb out of its prefix once the page
  // resolves it; a link never needs one.
  if (segments.some((s) => s === '.' || s === '..')) return null;
  const params = new URLSearchParams(rawQuery);

  if (segments.length === 1 && segments[0]!.toLowerCase() === 'pair') {
    const code = params.get('code') ?? params.get('pair');
    if (!code) return '/';
    return `/?${new URLSearchParams({ pair: code }).toString()}`;
  }

  return `/${segments.join('/')}${keepAllowed(params)}`;
}

/** What a deep link asks for: a route to show, or a registry command to run. */
export type DeepLinkTarget =
  | { kind: 'route'; route: string }
  | { kind: 'command'; command: DeepLinkCommandId }
  /** A `command/<id>` link whose id is not on the allowlist: ignored (and logged). */
  | { kind: 'rejected-command'; command: string };

/**
 * Resolve a `generatorai://` URL (06 §8):
 * - `generatorai://command/<id>` runs `<id>` only if it is a deep-link
 *   command (`DEEP_LINK_COMMAND_IDS`: global renderer commands flagged
 *   `deepLink` — New chat, New workflow). Any other id, extra segments or an
 *   empty id is `rejected-command`: the link is never turned into a route.
 *   The query and hash of a command link are ignored.
 * - everything else is a route (`deepLinkToRoute`).
 * `null` when the URL is not a deep link at all.
 */
export function resolveDeepLink(url: string): DeepLinkTarget | null {
  if (!isDeepLink(url)) return null;
  const rest = url.slice(PREFIX.length).split('#')[0]!.split('?')[0]!;
  const segments = rest.split('/').filter((s) => s.length > 0);
  if (segments[0]?.toLowerCase() === 'command') {
    const id = segments.length === 2 ? safeDecode(segments[1]!) : '';
    if (isDeepLinkCommandId(id)) return { kind: 'command', command: id };
    return { kind: 'rejected-command', command: segments.slice(1).join('/') };
  }
  const route = deepLinkToRoute(url);
  return route === null ? null : { kind: 'route', route };
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}
