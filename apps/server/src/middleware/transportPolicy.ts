// ────────────────────────────────────────────────────────────────
// What plain HTTP may do once the server speaks HTTPS (D-111, D-127).
//
// The network-facing port answers both protocols (dualProtocolListener.ts).
// Plain HTTP stays fully usable from THIS machine — the desktop window, a
// local browser, a local CLI, a reverse proxy on the same host — and from a
// trusted proxy that terminated TLS for us. From another device it is
// refused: a page navigation is redirected (308) to the https:// URL;
// anything else gets 403 HTTPS_REQUIRED naming the https address.
//
// There is no native plain-HTTP lane any more (D-112 is superseded by D-127):
// the mobile app pins the server's local CA and talks https:// (MV-44), so
// every other device — browser, phone, CLI, MCP client — uses TLS.
// ────────────────────────────────────────────────────────────────

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isLoopbackAddress } from '@generatorai/auth';
import { requestOrigin, type OriginRequest, type TrustProxyPolicy } from '../network/requestOrigin.js';

export type TransportLane =
  /** Arrived over TLS, directly or through a trusted proxy. */
  | 'https'
  /** Plain HTTP from this machine. */
  | 'loopback'
  /** Plain HTTP from another device: refused while TLS is on. */
  | 'lan-http';

export function classifyTransport(req: OriginRequest, policy?: TrustProxyPolicy): TransportLane {
  const origin = requestOrigin(req, policy);
  if (origin.scheme === 'https') return 'https';
  if (!origin.forwarded && isLoopbackAddress(req.socket.remoteAddress)) return 'loopback';
  return 'lan-http';
}

/** The https:// URL a plain-HTTP request should have used. */
export function httpsUrlFor(req: OriginRequest, path: string, policy?: TrustProxyPolicy): string {
  return `https://${requestOrigin(req, policy).host}${path}`;
}

export const HTTPS_REQUIRED_CODE = 'HTTPS_REQUIRED';

export function httpsRequiredMessage(httpsOrigin: string): string {
  return (
    `Use ${httpsOrigin} instead. This server accepts only encrypted connections from other devices: ` +
    'browsers need HTTPS to create the key pairing uses, and it keeps the connection private.'
  );
}

export interface TransportPolicyOptions {
  /** True while the network-facing listener serves HTTPS. */
  tlsActive: () => boolean;
  policy?: TrustProxyPolicy;
}

export function createTransportPolicyMiddleware(options: TransportPolicyOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!options.tlsActive()) {
      next();
      return;
    }
    const lane = classifyTransport(req, options.policy);
    const isApi = req.path === '/api' || req.path.startsWith('/api/');
    if (lane === 'https' || lane === 'loopback') {
      next();
      return;
    }
    const target = httpsUrlFor(req, req.originalUrl, options.policy);
    if (!isApi && (req.method === 'GET' || req.method === 'HEAD')) {
      res.redirect(308, target);
      return;
    }
    res.status(403).json({
      error: { code: HTTPS_REQUIRED_CODE, message: httpsRequiredMessage(new URL(target).origin) },
    });
  };
}
