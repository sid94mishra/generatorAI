// ────────────────────────────────────────────────────────────────
// pairingFailure — tell "the request never got there" apart from "the
// server said no" when enrolment fails.
//
// Why it matters on iOS: the FIRST request to a LAN address triggers the
// Local Network permission prompt, and that request fails while the prompt
// is on screen. On a fresh install that is the pairing request itself, so
// the user tapped Pair, got an alert, allowed it — and was shown a raw
// "Network request failed". The same class of failure happens on any
// platform when Wi-Fi drops mid-pairing, and the cure is the same: retry.
//
// A network failure is safe to retry: the pairing grant was never
// delivered, so it has not been consumed. A server rejection is not
// retried — the grant may be spent, and the message is the server's.
//
// Pure: no React Native / Expo imports, unit-tested on node.
// ────────────────────────────────────────────────────────────────

export type PairingFailureKind = 'network' | 'identity' | 'rejected';

export interface PairingFailure {
  kind: PairingFailureKind;
  /** What to show the user. */
  message: string;
  /** Whether trying the same offer again can succeed. */
  retryable: boolean;
}

/**
 * Errors the transport stack throws when a request does not complete:
 * RN's fetch (`Network request failed`), aborts/timeouts, the endpoint
 * supervisor (`NoReachableEndpointError`) and the runtime's identity probe
 * ("Could not verify the paired server identity. … is unreachable").
 */
const NETWORK =
  /network request failed|failed to fetch|network ?error|networkerror|load failed|unreachable|no reachable endpoint|timed? ?out|aborted|aborterror|could not verify the paired server identity|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|internet connection appears to be offline|not connected to the internet/i;

const IDENTITY = /identity key changed|identity at this address changed|HostIdentity(Mismatch|Changed)Error|impersonat/i;

export const LOCAL_NETWORK_HINT =
  'Couldn’t reach your server. If your phone asked to find devices on your local network, allow it — then try again. Also check that this phone is on the same network as the server.';

export function classifyPairingFailure(error: unknown): PairingFailure {
  const name = error instanceof Error ? error.name : '';
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  const text = `${name} ${raw}`;

  // Identity first: its messages can mention an unreachable endpoint too,
  // and a changed identity must never be silently retried.
  if (IDENTITY.test(text)) return { kind: 'identity', message: raw, retryable: false };
  // A response from the server — even an error — proves the network works.
  if (/^Pairing failed:/.test(raw)) return { kind: 'rejected', message: raw, retryable: false };
  if (error instanceof TypeError || NETWORK.test(text)) {
    return { kind: 'network', message: LOCAL_NETWORK_HINT, retryable: true };
  }
  return { kind: 'rejected', message: raw || 'Pairing failed.', retryable: false };
}

/**
 * Whether to retry automatically, now.
 *
 * The Local Network prompt makes the app `inactive` while it is up. So a
 * retryable failure of an attempt during which the app was interrupted is
 * retried once the app is `active` again — whichever came first, the failure
 * or the prompt's dismissal. Exactly once per confirmation: a second failure
 * waits for the user's own retry rather than looping against a server that
 * is really down, and an attempt nothing interrupted is left to the user.
 */
export function shouldAutoRetryPairing(input: {
  failure: PairingFailure | null;
  autoRetried: boolean;
  /** The app left `active` at some point since the attempt started. */
  interrupted: boolean;
  appState: string;
}): boolean {
  return (
    input.failure?.retryable === true && !input.autoRetried && input.interrupted && input.appState === 'active'
  );
}
