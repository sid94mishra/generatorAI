// ────────────────────────────────────────────────────────────────
// Security wire types: the public `GET /api/auth/server-info`, and the
// `GET /api/security/posture` and `/network-access` reads (audit F-6, D-120).
//
// React-free; web, desktop, CLI and mobile share them.
//
// `server-info` is public by necessity (a device identifies a server before
// pairing), so it carries only what that needs: no machine hostname, no
// interface map, no certificate name list. The posture and network reads
// are `read:status`, held by every device; their configuration detail (bind
// address, secret backend, legacy key, every address, proxy trust) is for an
// `admin:settings` holder. `detail` says which view a caller got — fields an
// admin alone sees are absent, never invented, in the `limited` view.
// ────────────────────────────────────────────────────────────────

/**
 * Built-in HTTPS for other devices (D-110). `fingerprintSha256` is the served
 * certificate — what the other device's browser shows in its certificate
 * details; `caFingerprintSha256` is the local CA (generated certificates only).
 */
export interface TlsStatus {
  enabled: true;
  source: 'generated' | 'custom';
  fingerprintSha256: string;
  caFingerprintSha256: string | null;
  issuer: string;
  notBefore: number;
  notAfter: number;
  /** DNS names and IP addresses the served certificate covers. */
  names: string[];
  customCertificateProblem: string | null;
}

/** What `server-info` publishes about TLS: enough to compare a fingerprint, nothing that maps the host. */
export type PublicTlsStatus = Pick<TlsStatus, 'enabled' | 'source' | 'fingerprintSha256' | 'caFingerprintSha256' | 'notAfter'>;

/** `network-access.tls`: serving HTTPS, or exposed without it (and why). Null on a loopback-only server. */
export type NetworkTls = (TlsStatus & { unavailableReason: null }) | { enabled: false; unavailableReason: string | null };

export interface NetworkEndpoint {
  origin: string;
  reachability: string;
  priority?: number;
  /** Host-only adapter (WSL/Hyper-V/Docker) that nothing off-box can reach. */
  virtual?: boolean;
}

/** `GET /api/auth/server-info` (public). */
export interface PublicServerInfo {
  issuer: 'generatorai';
  audience: string;
  /** Ed25519 JWS verification key for access tokens — safe to publish. */
  tokenPublicJwk: Record<string, unknown>;
  /** X25519 host identity that paired clients pin. */
  serverId: string;
  serverPublicKey: string;
  /** The display name the operator set (`GENERATORAI_SERVER_NAME`); absent otherwise — never the machine hostname. */
  serverName?: string;
  protocolVersion: number;
  authentication: { required: boolean; dpopRequired: boolean };
  transports: { loopback: boolean; lan: boolean; privateNetwork: boolean; relay: boolean };
  /** Only the endpoint this request arrived on (the caller already knows it). */
  endpoints: NetworkEndpoint[];
  tls: PublicTlsStatus | null;
  scopes: readonly string[];
}

export type SecurityDetail = 'full' | 'limited';

export interface SecurityWarning {
  code: string;
  severity: 'warn' | 'critical';
  message: string;
}

/** `GET /api/security/posture`. Optional fields are present only when `detail === 'full'`. */
export interface SecurityPosture {
  detail: SecurityDetail;
  server: { hostId: string; loopbackOnly: boolean; bindHost?: string; production?: boolean; tokenAudience?: string };
  authentication: { required: boolean; dpopRequired: boolean; unauthenticatedLoopback?: boolean; legacyApiKeyActive?: boolean };
  secretStore?: { kind: string; secure: boolean; reason: string | null; supportsRotation: boolean };
  devices?: { active: number; revoked: number; relayBound: number };
  relay: { enabled: boolean; clientAvailable: boolean; state?: string; hostId?: string | null };
  scopes: readonly string[];
  warnings?: SecurityWarning[];
}

/** `GET /api/security/network-access`. The server supports exactly these two modes (D-42). */
export interface NetworkAccess {
  detail: SecurityDetail;
  mode: 'local-only' | 'network-accessible';
  /** What the listener is doing now; lags `mode` until a restart. */
  active: boolean;
  pendingRestart: boolean;
  /** Configuration problems that block exposure. Only an admin can fix them, so the limited view lists none. */
  blockers: { code: string; message: string }[];
  bindHost?: string;
  envOverride?: string | null;
  endpoints?: NetworkEndpoint[];
  tls?: NetworkTls | null;
  /** D-114 — whose X-Forwarded-Proto/Host the server honours. */
  trustProxy?: { mode: 'off' | 'loopback' | 'addresses'; addresses: string[] };
}
