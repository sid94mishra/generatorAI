// ────────────────────────────────────────────────────────────────
// liveConnections — every long-lived stream a paired device holds open,
// indexed by device id (audit F-2).
//
// REST re-reads the device record on every request, so a revocation or a
// scope cut takes effect on the next call. A stream is authorised ONCE, at
// open time: an SSE response or a WebSocket that was admitted before the
// change would otherwise keep delivering events to a revoked device for as
// long as it kept the socket open. `DeviceService` announces revocations,
// credential rotations and scope changes; this registry closes the affected
// connections.
//
// Relay-bridged streams are covered by the same path: the bridge pipes the
// remote client into a loopback TCP connection to this server, so closing the
// local stream closes that socket, and the bridge tears the relay stream down
// when its local socket closes.
// ────────────────────────────────────────────────────────────────

import type { Response } from 'express';
import type { WebSocket } from 'ws';
import type { DeviceAccessChange, Principal, Scope } from '@generatorai/auth';

export interface LiveConnectionEntry {
  /** For logs only: `sse`, `mux`, `terminal-ws` … */
  readonly label: string;
  /**
   * Scopes the connection is still relying on. Read on every scope change,
   * so a multiplexed stream whose subscriptions grow can report its current
   * needs. When the device no longer holds all of them, the stream closes.
   */
  requiredScopes(): readonly Scope[];
  /** Tears the connection down. Must be idempotent. */
  close(reason: string): void;
}

/** The device a principal speaks for, or null for non-device principals. */
export function deviceIdOf(principal: Principal | undefined): string | null {
  if (!principal) return null;
  if (principal.deviceId) return principal.deviceId;
  return principal.type === 'paired-device' ? principal.id : null;
}

export class LiveConnectionRegistry {
  private readonly byDevice = new Map<string, Set<LiveConnectionEntry>>();

  /**
   * Registers a live connection for the principal's device. Returns the
   * unregister function; a no-op for principals that are not devices.
   */
  register(principal: Principal | undefined, entry: LiveConnectionEntry): () => void {
    const deviceId = deviceIdOf(principal);
    if (!deviceId) return () => undefined;
    let set = this.byDevice.get(deviceId);
    if (!set) {
      set = new Set();
      this.byDevice.set(deviceId, set);
    }
    set.add(entry);
    return () => {
      const current = this.byDevice.get(deviceId);
      if (!current) return;
      current.delete(entry);
      if (current.size === 0) this.byDevice.delete(deviceId);
    };
  }

  countForDevice(deviceId: string): number {
    return this.byDevice.get(deviceId)?.size ?? 0;
  }

  /** Closes every live connection of a device. Returns how many were closed. */
  closeForDevice(deviceId: string, reason: string): number {
    const set = this.byDevice.get(deviceId);
    if (!set) return 0;
    this.byDevice.delete(deviceId);
    for (const entry of set) safeClose(entry, reason);
    return set.size;
  }

  /** Closes the connections that rely on a scope the device no longer holds. */
  enforceScopes(deviceId: string, scopes: readonly Scope[], reason: string): number {
    const set = this.byDevice.get(deviceId);
    if (!set) return 0;
    const held = new Set<string>(scopes);
    let closed = 0;
    for (const entry of [...set]) {
      if (entry.requiredScopes().every((s) => held.has(s))) continue;
      set.delete(entry);
      safeClose(entry, reason);
      closed += 1;
    }
    if (set.size === 0) this.byDevice.delete(deviceId);
    return closed;
  }

  /** Applies a {@link DeviceAccessChange} from `DeviceService.onAccessChanged`. */
  apply(change: DeviceAccessChange): number {
    switch (change.kind) {
      case 'revoked':
        return this.closeForDevice(change.deviceId, 'device revoked');
      case 'credentials-rotated':
        // Rotation exists to cut off a possibly-leaked credential; a stream
        // opened with it must re-authenticate with the new one.
        return this.closeForDevice(change.deviceId, 'device credentials rotated');
      case 'scopes-changed':
        return change.removed.length > 0
          ? this.enforceScopes(change.deviceId, change.scopes, 'device scopes reduced')
          : 0;
    }
  }

  /** Test seam. */
  reset(): void {
    this.byDevice.clear();
  }
}

function safeClose(entry: LiveConnectionEntry, reason: string): void {
  try {
    entry.close(reason);
  } catch {
    // A connection that is already gone has nothing left to close.
  }
}

/** Process-wide registry, wired to `DeviceService` in `composition/security.ts`. */
export const liveConnections = new LiveConnectionRegistry();

/** WebSocket close code for "your authorisation ended" (4000–4999 is app-defined). */
export const WS_CLOSE_ACCESS_ENDED = 4401;

/**
 * Ends an SSE response NOW: a final `access-ended` control frame (so a client
 * can stop reconnecting), then the socket is destroyed so no queued byte and
 * no keep-alive reuse outlives the decision.
 */
export function endEventStream(res: Response, reason: string): void {
  const socket = res.socket;
  const kill = (): void => {
    socket?.destroy();
  };
  try {
    if (res.writableEnded) {
      kill();
    } else {
      res.write(`event: access-ended\ndata: ${JSON.stringify({ reason })}\n\n`);
      res.end(kill);
    }
  } catch {
    kill();
  }
  // A congested peer may never let the response finish.
  setTimeout(kill, 1_000).unref?.();
}

/** Closes a WebSocket with {@link WS_CLOSE_ACCESS_ENDED}; terminates it if the peer does not finish the close handshake. */
export function endWebSocket(ws: WebSocket, reason: string): void {
  try {
    ws.close(WS_CLOSE_ACCESS_ENDED, reason.slice(0, 120));
  } catch {
    // Already closing.
  }
  const timer = setTimeout(() => {
    try {
      ws.terminate();
    } catch {
      // Already gone.
    }
  }, 1_000);
  timer.unref?.();
}

/**
 * Registers an accepted WebSocket for its principal's device and unregisters
 * it when the socket closes. `requiredScopes` are what the upgrade demanded.
 */
export function trackWebSocket(
  principal: Principal | undefined,
  ws: WebSocket,
  label: string,
  requiredScopes: readonly Scope[],
  registry: LiveConnectionRegistry = liveConnections,
): void {
  const unregister = registry.register(principal, {
    label,
    requiredScopes: () => requiredScopes,
    close: (reason) => endWebSocket(ws, reason),
  });
  ws.once('close', unregister);
}
