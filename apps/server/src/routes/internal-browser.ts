// ────────────────────────────────────────────────────────────────
// Internal Browser Routes — desktop main → server handshake (v14 security
// fix). Electron main pushes each workspace's *current* scoped CDP endpoint
// here as tabs become active/inactive/closed; `ElectronBridgeAdapter` reads
// from that registry instead of a single global `--remote-debugging-port`
// env var.
//
// NOT part of the public /api surface — mounted directly at /internal/browser
// in app.ts. Gated by two independent checks:
//   - loopback-only (rejects any request whose remote address isn't
//     127.0.0.1/::1 — defense in depth in case the server ever binds beyond
//     loopback)
//   - a bearer token generated once per desktop-app-lifetime by Electron
//     main and plumbed into this process via `GENERATORAI_ELECTRON_IPC_TOKEN`
//     (set only when the native-browser feature flag is on)
//
// This token authenticates the HANDSHAKE, not CDP itself — each
// ScopedCdpProxy on the Electron side has its own independent random token
// embedded in its ws:// URL.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Container } from '../composition-root.js';

const CdpEndpointBodySchema = z.object({
  workspaceId: z.string().min(1),
  wsUrl: z.string().url().nullable(),
});

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createInternalBrowserRoutes(container: Container): Router {
  const router = Router();

  router.use((req, res, next) => {
    const remote = req.socket.remoteAddress ?? '';
    const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (!isLoopback) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Loopback only' } });
      return;
    }
    const expected = process.env['GENERATORAI_ELECTRON_IPC_TOKEN'];
    const authHeader = req.headers.authorization ?? '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
    if (!expected || !provided || !safeEqual(provided, expected)) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } });
      return;
    }
    next();
  });

  router.post('/cdp-endpoint', (req, res) => {
    const parsed = CdpEndpointBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid body', details: parsed.error.flatten() } });
      return;
    }
    container.electronBridgeAdapter.setEndpoint(parsed.data.workspaceId, parsed.data.wsUrl);
    container.logger.debug?.(
      `[InternalBrowserRoutes] endpoint ${parsed.data.wsUrl ? 'set' : 'cleared'} for workspace ${parsed.data.workspaceId}`,
    );
    res.json({ ok: true });
  });

  return router;
}
