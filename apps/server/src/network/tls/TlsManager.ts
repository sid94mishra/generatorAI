// ────────────────────────────────────────────────────────────────
// TlsManager — owns the certificate the network-facing listener serves
// (D-110, D-113).
//
// Key material lives only in the encrypted vault (`system/tls`), never as a
// file on disk. The manager keeps the current `SecureContext` in memory and
// swaps it in place: every new connection asks for the context at handshake
// time (dualProtocolListener.ts), so a re-issued leaf takes effect for the
// next device without a restart and without dropping open connections.
//
// Re-issue triggers (generated certificates only):
//   * this machine's LAN addresses or hostname changed (a laptop moved
//     network) — checked by a timer, and on demand by the routes;
//   * the leaf is within 30 days of expiry;
//   * the leaf was not issued by the current CA (vault restored from elsewhere).
// The CA itself is never re-issued, so a fingerprint a phone pinned and a CA a
// user installed both survive every leaf change.
//
// A standby CA (D-127) is generated with it and never served: its fingerprint
// rides in every pairing offer (`backupCertificateFingerprint`) and the mobile
// app pins it next to the CA, so a future rotation — promote the standby,
// generate a new standby, re-issue the leaf — keeps paired phones working
// without pairing again. The rotation itself is not built yet.
// ────────────────────────────────────────────────────────────────

import { createSecureContext, type SecureContext } from 'node:tls';
import { SecretNamespace, getSecretJson, setSecretJson, type SecretStore } from '@generatorai/secrets';
import type { NetworkInterfaces } from '../advertisedEndpoints.js';
import {
  LEAF_RENEW_BEFORE_MS,
  describeCertificate,
  generateLocalCa,
  isIssuedBy,
  issueLeafCertificate,
  sameNames,
  type CertificateKeyPair,
  type CertificateNames,
} from './certificates.js';
import { mdnsHostname, selectCertificateNames } from './certificateNames.js';
import { CustomCertificateError, validateCustomCertificate, type ValidatedCustomCertificate } from './customCertificate.js';

export const TLS_SECRET_NAMESPACE = SecretNamespace.tls;
const CA_SECRET = 'local-ca';
const STANDBY_CA_SECRET = 'local-ca-standby';
const LEAF_SECRET = 'leaf';
const CUSTOM_SECRET = 'custom';

export interface TlsLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

/** What the server says about its certificate. Public: no key material. */
export interface TlsStatus {
  enabled: true;
  source: 'generated' | 'custom';
  /** SHA-256 of the certificate a browser shows in its warning (the leaf). */
  fingerprintSha256: string;
  /**
   * SHA-256 of the certificate a native client pins and a user may install:
   * the local CA for a generated certificate, absent for a custom one (a
   * custom certificate is meant to be trusted through its own CA).
   */
  caFingerprintSha256: string | null;
  issuer: string;
  notBefore: number;
  notAfter: number;
  /** DNS names and IP addresses the served certificate covers. */
  names: string[];
  /** A custom certificate is stored but could not be used (expired, damaged). */
  customCertificateProblem: string | null;
}

export interface TlsManagerOptions {
  secretStore: SecretStore;
  logger: TlsLogger;
  hostname: () => string;
  networkInterfaces: () => NetworkInterfaces;
  /** Hosts of operator-configured advertised URLs (`GENERATORAI_ADVERTISED_URLS`). */
  advertisedHosts: () => string[];
  now?: () => number;
}

export class TlsManager {
  private ca: CertificateKeyPair | null = null;
  private standbyCa: CertificateKeyPair | null = null;
  private leaf: CertificateKeyPair | null = null;
  private custom: ValidatedCustomCertificate | null = null;
  private customProblem: string | null = null;
  private context: SecureContext | null = null;
  private refreshing: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cachedStatus: TlsStatus | null = null;
  /** Bumped whenever the served certificate changes; callers key caches on it. */
  version = 0;

  constructor(private readonly options: TlsManagerOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** The names the generated leaf should cover right now. */
  desiredNames(): CertificateNames {
    return selectCertificateNames({
      hostname: this.options.hostname(),
      networkInterfaces: this.options.networkInterfaces(),
    });
  }

  private commonName(): string {
    return mdnsHostname(this.options.hostname()) ?? 'localhost';
  }

  /** Loads (or creates) every piece of material and builds the first context. */
  async initialize(): Promise<void> {
    const store = this.options.secretStore;
    this.ca = await getSecretJson<CertificateKeyPair>(store, TLS_SECRET_NAMESPACE, CA_SECRET);
    if (!this.ca) {
      this.ca = await generateLocalCa({ commonName: `GeneratorAI local CA (${this.commonName()})`, now: this.now() });
      await setSecretJson(store, TLS_SECRET_NAMESPACE, CA_SECRET, this.ca);
      this.options.logger.info('[TLS] Generated this install\'s local certificate authority', {
        fingerprintSha256: describeCertificate(this.ca.certPem).fingerprintSha256,
      });
    }
    this.standbyCa = await getSecretJson<CertificateKeyPair>(store, TLS_SECRET_NAMESPACE, STANDBY_CA_SECRET);
    if (!this.standbyCa) {
      this.standbyCa = await generateLocalCa({ commonName: `GeneratorAI local CA (${this.commonName()}, standby)`, now: this.now() });
      await setSecretJson(store, TLS_SECRET_NAMESPACE, STANDBY_CA_SECRET, this.standbyCa);
    }
    this.leaf = await getSecretJson<CertificateKeyPair>(store, TLS_SECRET_NAMESPACE, LEAF_SECRET);

    const storedCustom = await getSecretJson<{ certPem: string; keyPem: string }>(store, TLS_SECRET_NAMESPACE, CUSTOM_SECRET);
    if (storedCustom) {
      try {
        this.custom = this.validateCustom(storedCustom.certPem, storedCustom.keyPem, false);
      } catch (err) {
        this.customProblem = err instanceof Error ? err.message : String(err);
        this.options.logger.warn('[TLS] The custom certificate could not be used; serving the generated one', {
          reason: this.customProblem,
        });
      }
    }
    await this.refresh();
  }

  private validateCustom(certPem: string, keyPem: string, requireNameMatch: boolean): ValidatedCustomCertificate {
    return validateCustomCertificate({
      certPem,
      keyPem,
      lanNames: this.desiredNames(),
      advertisedHosts: this.options.advertisedHosts(),
      hostname: this.options.hostname(),
      now: this.now(),
      requireNameMatch,
    });
  }

  /**
   * Re-issues the generated leaf when it no longer fits this machine. Returns
   * true when the served certificate changed. Concurrent callers share one run.
   */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    if (this.custom) {
      if (this.custom.summary.notAfter > this.now()) {
        if (!this.context) this.buildContext();
        return false;
      }
      this.cachedStatus = null;
      this.customProblem = `The custom certificate expired on ${new Date(this.custom.summary.notAfter).toISOString().slice(0, 10)}.`;
      this.options.logger.warn('[TLS] The custom certificate has expired; serving the generated one');
      this.custom = null;
    }

    const ca = this.ca;
    if (!ca) throw new Error('TlsManager.refresh called before initialize');
    const names = this.desiredNames();
    const reason = this.leafReissueReason(names);
    if (reason) {
      this.leaf = await issueLeafCertificate({ ca, names, commonName: this.commonName(), now: this.now() });
      await setSecretJson(this.options.secretStore, TLS_SECRET_NAMESPACE, LEAF_SECRET, this.leaf);
      this.options.logger.info('[TLS] Issued a server certificate', {
        reason,
        names: [...names.dnsNames, ...names.ipAddresses],
        fingerprintSha256: describeCertificate(this.leaf.certPem).fingerprintSha256,
      });
      this.buildContext();
      return true;
    }
    if (!this.context) this.buildContext();
    return false;
  }

  private leafReissueReason(names: CertificateNames): string | null {
    const ca = this.ca;
    if (!this.leaf || !ca) return 'missing';
    try {
      if (!isIssuedBy(this.leaf.certPem, ca.certPem)) return 'issuer-changed';
      const summary = describeCertificate(this.leaf.certPem);
      if (summary.notAfter - this.now() < LEAF_RENEW_BEFORE_MS) return 'expiring';
      if (!sameNames(summary, names)) return 'addresses-changed';
      return null;
    } catch {
      return 'unreadable';
    }
  }

  private buildContext(): void {
    this.version += 1;
    this.cachedStatus = null;
    if (this.custom) {
      this.context = createSecureContext({ cert: this.custom.chainPem, key: this.custom.keyPem });
      return;
    }
    if (!this.leaf || !this.ca) throw new Error('No certificate material to serve');
    // The CA travels with the leaf: a client that installed it then needs
    // nothing else, and one that pins it can find it in the chain.
    this.context = createSecureContext({ cert: this.leaf.certPem + this.ca.certPem, key: this.leaf.keyPem });
  }

  /** The context the next TLS handshake uses. */
  secureContext(): SecureContext {
    if (!this.context) throw new Error('TlsManager has not been initialized');
    return this.context;
  }

  status(): TlsStatus {
    this.cachedStatus ??= this.computeStatus();
    return this.cachedStatus;
  }

  private computeStatus(): TlsStatus {
    const servedPem = this.custom?.chainPem ?? this.leaf?.certPem;
    if (!servedPem) throw new Error('TlsManager has not been initialized');
    const served = describeCertificate(servedPem);
    return {
      enabled: true,
      source: this.custom ? 'custom' : 'generated',
      fingerprintSha256: served.fingerprintSha256,
      caFingerprintSha256: !this.custom && this.ca ? describeCertificate(this.ca.certPem).fingerprintSha256 : null,
      issuer: served.issuer.replace(/\n/g, ', '),
      notBefore: served.notBefore,
      notAfter: served.notAfter,
      names: [...served.dnsNames, ...served.ipAddresses],
      customCertificateProblem: this.customProblem,
    };
  }

  /**
   * What a native client pins at pairing (offer `certificateFingerprint`): the
   * stable CA, or null for a custom certificate that is trusted through its
   * own CA.
   */
  pinnedFingerprint(): string | null {
    return !this.custom && this.ca ? describeCertificate(this.ca.certPem).fingerprintSha256 : null;
  }

  /**
   * The standby CA a rotation will promote (D-127), pinned by native clients
   * next to `pinnedFingerprint()`; null for a custom certificate.
   */
  backupPinnedFingerprint(): string | null {
    return !this.custom && this.standbyCa ? describeCertificate(this.standbyCa.certPem).fingerprintSha256 : null;
  }

  /** The local CA certificate (public), for a user who wants to install it. */
  caCertificatePem(): string | null {
    return this.ca?.certPem ?? null;
  }

  /** DNS names from a custom certificate that name this computer (`<host>.<tailnet>.ts.net`). */
  extraHostnames(): string[] {
    return this.custom?.extraHostnames ?? [];
  }

  /** Validates, stores and starts serving an admin-supplied certificate. */
  async installCustomCertificate(certPem: string, keyPem: string): Promise<TlsStatus> {
    const validated = this.validateCustom(certPem, keyPem, true);
    // Build the context before persisting: a certificate Node's TLS stack
    // refuses must not be stored and then fail on every later start.
    const context = createSecureContext({ cert: validated.chainPem, key: validated.keyPem });
    await setSecretJson(this.options.secretStore, TLS_SECRET_NAMESPACE, CUSTOM_SECRET, {
      certPem: validated.chainPem,
      keyPem: validated.keyPem,
    });
    this.custom = validated;
    this.customProblem = null;
    this.context = context;
    this.version += 1;
    this.cachedStatus = null;
    this.options.logger.info('[TLS] Serving a custom certificate', {
      fingerprintSha256: validated.summary.fingerprintSha256,
      covers: validated.coveredNames,
    });
    return this.status();
  }

  /** Forgets the custom certificate and goes back to the generated one. */
  async removeCustomCertificate(): Promise<TlsStatus> {
    await this.options.secretStore.remove(TLS_SECRET_NAMESPACE, CUSTOM_SECRET);
    this.custom = null;
    this.customProblem = null;
    this.cachedStatus = null;
    this.context = null;
    await this.refresh();
    return this.status();
  }

  startAutoRefresh(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh().catch((err: unknown) => {
        this.options.logger.warn('[TLS] Certificate refresh failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export { CustomCertificateError };
