// ────────────────────────────────────────────────────────────────
// GeneratorAITrust — the native trust anchors (MV-44, MD-199).
//
// Thin facade over `apps/mobile/modules/generatorai-trust/`. The native side
// hooks every stack the app talks to its server through — React Native fetch
// and WebSocket, expo/fetch (the streaming transport) — so a host:port with
// anchors accepts only a chain that validates against the pinned CA. The
// rules for WHICH anchors to set live in `services/transport/trust.ts`.
//
// Fails closed: without the module (Expo Go, the web preview, a dev client
// built before it existed) nothing is pinned, so an `https://` LAN server's
// private CA is refused by the system trust and the connection fails.
// ────────────────────────────────────────────────────────────────

import { requireOptionalNativeModule } from 'expo';

/** SHA-256 (base64url) of the certificates a server presented, leaf first. */
export interface PresentedChain {
  leaf: string;
  /** The last certificate when it is self-signed (the server's own CA); null for a chain that ends below a root. */
  root: string | null;
  chain: string[];
}

export type LocalNetworkAccess = 'allowed' | 'denied' | 'unknown';

/** Must match `GeneratorAITrustModule.swift` / `.kt`. */
interface TrustNativeModule {
  setAnchors(serverId: string, hostPorts: string[], fingerprints: string[]): void;
  clearAnchors(serverId: string): void;
  lastFailure(host: string, port: number): number;
  inspect(host: string, port: number): Promise<PresentedChain>;
  localNetwork(host: string, port: number): Promise<LocalNetworkAccess>;
}

const native = requireOptionalNativeModule<TrustNativeModule>('GeneratorAITrust');

export const NativeTrust = {
  available: native !== null,
  setAnchors(serverId: string, hostPorts: string[], fingerprints: string[]): void {
    native?.setAnchors(serverId, hostPorts, fingerprints);
  },
  clearAnchors(serverId: string): void {
    native?.clearAnchors(serverId);
  },
  /** ms since 1970 of the last refused pinned handshake to host:port, 0 when none. */
  lastFailure(host: string, port: number): number {
    return native?.lastFailure(host, port) ?? 0;
  },
  /** The chain the server presents; the handshake is refused, so no request is sent. */
  inspect(host: string, port: number): Promise<PresentedChain> {
    if (!native) return Promise.reject(new Error('Encrypted connections need a newer build of this app.'));
    return native.inspect(host, port);
  },
  localNetwork(host: string, port: number): Promise<LocalNetworkAccess> {
    return native ? native.localNetwork(host, port).catch(() => 'unknown' as const) : Promise.resolve('unknown');
  },
};
