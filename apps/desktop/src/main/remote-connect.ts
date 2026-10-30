// ────────────────────────────────────────────────────────────────
// "Connect to a server…" — deciding HOW to trust another machine's server
// before the window loads it (G-4, D-126).
//
// The user enters either
//   * an address (`192.168.1.20:3100`, `https://studio.tail1234.ts.net`), or
//   * a pairing link / code from that server's Settings › Security & devices ›
//     Pair a new device (platform Desktop): the offer names every address and
//     the server's CA fingerprint, so it vouches for the certificate.
// Outcome per address:
//   system   the certificate is publicly trusted (ts.net, a real domain):
//            nothing to pin — Chromium verifies it like any site;
//   pinned   the server's own CA (D-110): pin exactly that CA for this host,
//            after a "trust this server?" step (pre-confirmed by the offer
//            when its fingerprint matches; compared by the user otherwise);
//   plain    http:// to this machine only (loopback).
// A plain http:// LAN address is first tried as https:// on the same port:
// one port answers both (D-111), and a browser page over plain HTTP from
// another device is not a secure context anyway.
//
// Electron-free and dependency-injected so the decisions are unit-tested.
// ────────────────────────────────────────────────────────────────

import { decodePairingOffer, pairingEndpoints, type PairingOffer } from '@generatorai/client-runtime/pairing-offer';
import { normalizeServerUrl } from './serverConnections';
import { pinForCa, type InspectedCertificate, type PinnedCa } from './pinnedTrust';

export type ServerInput =
  | { kind: 'offer'; code: string; offer: PairingOffer }
  | { kind: 'address'; url: string }
  | { kind: 'invalid'; message: string };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** A pasted pairing link (`generatorai://pair?code=…`) or bare offer code, else an address. */
export function parseServerInput(text: string, now: () => number = Date.now): ServerInput {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'invalid', message: 'Enter an address or a pairing code.' };
  const looksLikeOffer = trimmed.startsWith('generatorai://') || (/^[A-Za-z0-9_-]{120,}$/.test(trimmed) && !trimmed.includes('.'));
  if (looksLikeOffer) {
    const decoded = decodePairingOffer(trimmed, now);
    if (!decoded.ok || !decoded.offer) return { kind: 'invalid', message: decoded.error ?? 'That pairing code is not valid.' };
    const code = trimmed.startsWith('generatorai://') ? (new URL(trimmed).searchParams.get('code') ?? trimmed) : trimmed;
    return { kind: 'offer', code, offer: decoded.offer };
  }
  const url = normalizeServerUrl(trimmed);
  if (!url) return { kind: 'invalid', message: `"${trimmed.slice(0, 80)}" is not a valid server address.` };
  return { kind: 'address', url };
}

export interface ConnectDeps {
  inspect: (origin: string) => Promise<InspectedCertificate>;
  /** server-info over TLS trusting exactly `caPem` (null: the system store). */
  serverInfo: (origin: string, caPem: string | null) => Promise<{ serverId?: string; serverName?: string }>;
  now: () => number;
}

export type ConnectPlan =
  | {
      ok: true;
      url: string;
      label?: string;
      trust: 'system' | 'pinned' | 'plain';
      pinnedCa?: PinnedCa;
      /** What that server's Settings › HTTPS certificate shows (colon hex). */
      leafSha256Hex?: string;
      /** True when the pairing offer's fingerprint matched the presented CA. */
      vouchedByOffer: boolean;
      /** The offer to hand the pairing screen (`/?pair=`). */
      pairCode?: string;
    }
  | { ok: false; message: string };

function httpsVariant(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:') return null;
    url.protocol = 'https:';
    return url.origin;
  } catch {
    return null;
  }
}

async function planAddress(url: string, deps: ConnectDeps): Promise<ConnectPlan> {
  let origin = url;
  if (origin.startsWith('http://')) {
    if (isLoopbackOrigin(origin)) return { ok: true, url: origin, trust: 'plain', vouchedByOffer: false };
    const secure = httpsVariant(origin);
    const inspected = secure ? await deps.inspect(secure).catch(() => null) : null;
    if (!inspected || !secure) return { ok: true, url: origin, trust: 'plain', vouchedByOffer: false };
    origin = secure;
    return planInspected(origin, inspected);
  }
  let inspected: InspectedCertificate;
  try {
    inspected = await deps.inspect(origin);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  return planInspected(origin, inspected, deps.now());

  function planInspected(o: string, i: InspectedCertificate, now = deps.now()): ConnectPlan {
    if (i.systemTrusted) return { ok: true, url: o, trust: 'system', vouchedByOffer: false };
    if (!i.caPem) {
      return {
        ok: false,
        message:
          `${o} presents a certificate this computer does not trust, and no certificate authority with it. ` +
          'GeneratorAI can only trust a GeneratorAI server’s own certificate authority, or a publicly trusted one.',
      };
    }
    return { ok: true, url: o, trust: 'pinned', pinnedCa: pinForCa(i.caPem, now), leafSha256Hex: i.leafSha256Hex, vouchedByOffer: false };
  }
}

async function planOffer(input: { code: string; offer: PairingOffer }, deps: ConnectDeps): Promise<ConnectPlan> {
  const { offer } = input;
  const reasons: string[] = [];
  const candidates: string[] = [];
  for (const endpoint of pairingEndpoints(offer)) {
    // Loopback in another machine's offer is this computer itself.
    if (isLoopbackOrigin(endpoint.origin)) continue;
    const origin = endpoint.origin.startsWith('https://') ? endpoint.origin : httpsVariant(endpoint.origin);
    if (origin && !candidates.includes(origin)) candidates.push(origin);
  }
  if (candidates.length === 0) {
    return { ok: false, message: 'This pairing code lists no address another computer can reach. Turn on Tailscale access or Network exposure on that server.' };
  }
  for (const origin of candidates) {
    let inspected: InspectedCertificate;
    try {
      inspected = await deps.inspect(origin);
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    let trust: 'system' | 'pinned';
    let caPem: string | null = null;
    if (inspected.systemTrusted) {
      trust = 'system';
    } else if (offer.certificateFingerprint && inspected.caPem && inspected.caSha256 === offer.certificateFingerprint) {
      trust = 'pinned';
      caPem = inspected.caPem;
    } else {
      reasons.push(
        offer.certificateFingerprint
          ? `${origin} presents a certificate that does not match this pairing code — something may be impersonating the server.`
          : `${origin} presents a certificate this computer does not trust.`,
      );
      continue;
    }
    // The address must be the server the offer names, not just any server with that CA.
    const info = await deps.serverInfo(origin, caPem).catch((err: unknown) => {
      reasons.push(`${origin}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    if (!info) continue;
    if (info.serverId !== offer.serverId) {
      reasons.push(`${origin} is a different GeneratorAI server than the one in this pairing code.`);
      continue;
    }
    return {
      ok: true,
      url: origin,
      label: offer.serverName,
      trust,
      ...(caPem ? { pinnedCa: pinForCa(caPem, deps.now()), leafSha256Hex: inspected.leafSha256Hex } : {}),
      vouchedByOffer: trust === 'pinned',
      pairCode: input.code,
    };
  }
  return { ok: false, message: reasons.join('\n') || 'None of the addresses in this pairing code answered.' };
}

export function planRemoteConnection(input: Exclude<ServerInput, { kind: 'invalid' }>, deps: ConnectDeps): Promise<ConnectPlan> {
  return input.kind === 'offer' ? planOffer(input, deps) : planAddress(input.url, deps);
}

/** The text of the "Trust this server?" step. */
export function trustPrompt(plan: Extract<ConnectPlan, { ok: true }>, caPairs: string): { message: string; detail: string } {
  const where = plan.label ? `“${plan.label}” at ${plan.url}` : plan.url;
  return {
    message: `Trust ${where}?`,
    detail: [
      'That computer made its own HTTPS certificate. GeneratorAI will trust exactly that server’s certificate authority, for this address only.',
      '',
      `Certificate fingerprint (SHA-256):\n${(plan.leafSha256Hex ?? '').replace(/:/g, ' ')}`,
      '',
      plan.vouchedByOffer
        ? 'It matches the pairing code you entered.'
        : 'Compare it with Settings › Security & devices › HTTPS certificate on that computer. If it does not match, choose Cancel: something may be impersonating it.',
      '',
      `Certificate authority: ${caPairs}`,
    ].join('\n'),
  };
}
