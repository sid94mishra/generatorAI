// ────────────────────────────────────────────────────────────────
// What plain HTTP may do once the server speaks HTTPS (D-111, D-112).
//
// The network-facing port answers both protocols (dualProtocolListener.ts).
// Plain HTTP stays fully usable from THIS machine — the desktop window, a
// local browser, a local CLI, a reverse proxy on the same host — and from a
// trusted proxy that terminated TLS for us. From another device it is
// narrowed to the native-app lane:
//
//   browser   any request whose `Origin` is not this server's own plain-HTTP
//             origin. A page navigation is redirected (308) to the https://
//             URL; anything else gets 403 HTTPS_REQUIRED. A browser can never
//             load the SPA over plain HTTP from the LAN, so it can never sit
//             in the non-secure context where pairing fails.
//   native    `/api/*` with no `Origin` (React Native `fetch`), or with this
//             server's own `http://<host>` origin (React Native's WebSocket
//             adds that by default on iOS and Android, and no web page can
//             produce it — the page itself would have been redirected).
//             Authentication is unchanged: every non-public route still needs
//             a DPoP-bound credential, which is what keeps this lane safe
//             until the mobile app can pin the certificate (MV-44).
// ────────────────────────────────────────────────────────────────

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isLoopbackAddress } from '@generatorai/auth';
import { requestOrigin, type OriginRequest, type TrustProxyPolicy } from '../network/requestOrigin.js';

export type TransportLane =
  /** Arrived over TLS, directly or through a trusted proxy. */
  | 'https'
  /** Plain HTTP from this machine. */
  | 'loopback'
  /** Plain HTTP from another device, from a native client. */
  | 'native-lan'
  /** Plain HTTP from another device, from a browser. */
  | 'browser-lan';

export function classifyTransport(req: OriginRequest, policy?: TrustProxyPolicy): TransportLane {
  const origin = requestOrigin(req, policy);
  if (origin.scheme === 'https') return 'https';
  if (!origin.forwarded && isLoopbackAddress(req.socket.remoteAddress)) return 'loopback';
  const header = req.headers['origin'];
  const sent = Array.isArray(header) ? header[0] : header;
  if (sent === undefined || sent === `http://${origin.host}`) return 'native-lan';
  return 'browser-lan';
}

/** The https:// URL a plain-HTTP request should have used. */
export function httpsUrlFor(req: OriginRequest, path: string, policy?: TrustProxyPolicy): string {
  return `https://${requestOrigin(req, policy).host}${path}`;
}

export const HTTPS_REQUIRED_CODE = 'HTTPS_REQUIRED';

export function httpsRequiredMessage(httpsOrigin: string): string {
  return (
    `Open ${httpsOrigin} instead. This server uses HTTPS for other devices: browsers need it to create ` +
    'the key pairing uses, and it keeps the connection private.'
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
    if (lane === 'https' || lane === 'loopback' || (lane === 'native-lan' && isApi)) {
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
