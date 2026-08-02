// ────────────────────────────────────────────────────────────────
// Endpoint candidate construction.
//
// Turns a stored session (+ the pairing offer's relay block) into the ordered
// list the supervisor tries.
//
// ── Ordering rationale ───────────────────────────────────────────
//   1. loopback  — only when the server runs on this device (rare on mobile,
//                  but valid for a simulator pointed at a host on the same
//                  machine, which is how most development happens).
//   2. lan       — same wifi. Fast, and no third party sees the traffic at
//                  all, not even as sealed bytes.
//   3. relay     — works from anywhere, but adds a hop and depends on a
//                  service being up. Last resort by design.
//
// The relay is NOT less trusted (it is blind either way, and the payload is
// E2E encrypted on every transport). It is simply slower and less available.
// ────────────────────────────────────────────────────────────────

import { DirectTransport, type TransportCandidate } from '@generatorai/client-transport';

export interface EndpointPlanInput {
  /** Endpoint pinned at pairing, e.g. `http://192.168.1.10:3100`. */
  pairedEndpoint: string;
  /** Extra origins discovered via mDNS or entered by the user. */
  discoveredEndpoints?: string[];
  /** Relay block from the pairing offer, when relay was offered. */
  relay?: { cellUrl: string; relayHostId: string } | undefined;
  /** User setting: never contact the relay, even if it was offered. */
  localOnly?: boolean;
  fetchImpl?: typeof fetch;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLoopback(endpoint: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

/** Normalize for de-duplication: trailing slashes and case must not matter. */
function canonical(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return endpoint.replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * Build the candidate list.
 *
 * Duplicates are removed so a discovered endpoint that happens to equal the
 * paired one does not double every connection attempt — which would also
 * double the backoff a user waits through when offline.
 */
export function buildEndpointCandidates(input: EndpointPlanInput): TransportCandidate[] {
  const candidates: TransportCandidate[] = [];
  const seen = new Set<string>();

  const addDirect = (endpoint: string, priority: number): void => {
    const key = canonical(endpoint);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const kind = isLoopback(endpoint) ? 'loopback' : 'lan';
    candidates.push({
      kind,
      endpoint,
      // Loopback always outranks LAN regardless of list position.
      priority: kind === 'loopback' ? priority - 100 : priority,
      create: () =>
        new DirectTransport({
          kind,
          endpoint,
          ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        }),
    });
  };

  addDirect(input.pairedEndpoint, 10);
  input.discoveredEndpoints?.forEach((endpoint, i) => addDirect(endpoint, 20 + i));

  // Local-only mode must never contact the relay. This is a privacy promise,
  // not an optimisation: a user who selects it is stating that their traffic
  // may not leave the local network even in sealed form.
  if (input.relay && !input.localOnly) {
    // RelayTransport lands in Phase 1b; the slot is reserved so ordering and
    // de-duplication are already correct when it arrives.
    candidates.push(...buildRelayCandidates(input.relay, 100));
  }

  return candidates.sort((a, b) => a.priority - b.priority);
}

/**
 * Relay candidates.
 *
 * Currently empty: `RelayTransport` requires an HTTP/1.1-over-E2EE-WebSocket
 * tunnel (the host bridge pipes relay frames straight into a loopback TCP
 * socket, so the client must speak raw HTTP). The codec for that already
 * exists and is tested in `@generatorai/client-transport`; wiring it to the
 * relay socket is the remaining work.
 *
 * Returning an empty list rather than a broken adapter means the supervisor
 * reports an honest "no reachable endpoint" instead of failing mid-handshake
 * with a confusing error.
 */
function buildRelayCandidates(
  _relay: { cellUrl: string; relayHostId: string },
  _basePriority: number,
): TransportCandidate[] {
  return [];
}

/** True when the plan can reach the host at all. */
export function hasReachableCandidate(candidates: TransportCandidate[]): boolean {
  return candidates.length > 0;
}
