// ────────────────────────────────────────────────────────────────
// TransportAdapter — how a client reaches its paired host.
//
// A transport answers exactly one question: "given a request path, how do
// bytes get to the host and back?" It knows nothing about credentials.
//
// ── Why the split matters ────────────────────────────────────────
// `AuthenticatedClientRuntime` owns the credential and produces a DPoP proof
// per request. The transport moves bytes. Keeping them apart is what lets the
// SAME auth code work over loopback, LAN and a blind relay — and it is the
// concrete expression of the security model's rule that **transport never
// implies authorization**. A request arriving over the relay is authorized
// identically to one arriving over loopback.
// ────────────────────────────────────────────────────────────────

/**
 * Ordered by preference, not by trust. `loopback` is fastest, `relay` works
 * from anywhere. None of them grants any authority.
 */
export type TransportKind = 'loopback' | 'lan' | 'ssh' | 'relay';

export interface TransportAdapter {
  readonly kind: TransportKind;

  /**
   * Absolute origin this transport presents to the auth layer, e.g.
   * `http://192.168.1.10:3100`.
   *
   * This value is baked into the DPoP `htu` claim, so it must be the origin
   * the SERVER believes it is serving — not an internal tunnel address.
   * Getting this wrong produces a 401 that looks like a clock-skew bug.
   */
  readonly endpoint: string;

  /** Establish whatever the transport needs (relay stream, tunnel, …). */
  open(signal?: AbortSignal): Promise<void>;

  /** WHATWG fetch over this transport. */
  fetch(input: string, init?: RequestInit): Promise<Response>;

  /**
   * URL for an EventSource/WebSocket. `protocol` selects the scheme family,
   * because a relay transport may need to rewrite `http`→`ws` differently
   * from a direct one.
   */
  streamUrl(path: string, protocol: 'http' | 'ws'): string;

  close(): Promise<void>;
}

/** A candidate endpoint the supervisor may try. */
export interface TransportCandidate {
  kind: TransportKind;
  endpoint: string;
  /** Lower is tried first. */
  priority: number;
  /** Build the adapter lazily — constructing a relay stream is expensive. */
  create(): TransportAdapter | Promise<TransportAdapter>;
}

export type TransportStatus =
  | { state: 'idle' }
  | { state: 'connecting'; kind: TransportKind; attempt: number }
  | { state: 'connected'; kind: TransportKind; endpoint: string }
  | { state: 'reconnecting'; kind: TransportKind; attempt: number; nextRetryAt: number }
  | { state: 'offline'; reason: string }
  /**
   * Terminal and deliberately un-retryable: the host's identity key does not
   * match the one pinned at pairing. Retrying would be pointless at best and,
   * if something is impersonating the host, actively harmful.
   */
  | { state: 'host-mismatch'; expected: string; actual: string };
