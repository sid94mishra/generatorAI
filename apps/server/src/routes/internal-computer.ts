// ────────────────────────────────────────────────────────────────
// Internal Computer Routes — desktop main → server handshake for Computer Use.
//
// Electron main owns the cua-driver process (see `computer-host.ts` for why:
// macOS attributes Accessibility/Screen Recording grants to the responsible
// app identity, so only the signed desktop app may spawn it). It pushes the
// resulting socket path here; `CuaDriverBridge` reads from that registry.
//
// NOT part of the public /api surface — mounted at /internal/computer in
// app.ts, behind the same two independent checks as /internal/browser:
//   - loopback-only remote address
//   - a bearer token minted once per desktop-app lifetime and plumbed in via
//     `GENERATORAI_ELECTRON_IPC_TOKEN`
//
// The consent endpoint is here rather than under /api because the answer
// comes from a native dialog the desktop shell owns. Routing it through the
// authenticated public API would let a paired mobile device answer a prompt
// about a window it cannot see.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Container } from '../composition-root.js';

const EndpointBodySchema = z.object({
  workspaceId: z.string().min(1),
  endpoint: z
    .object({
      socketPath: z.string().min(1),
      driverVersion: z.string().min(1),
      pid: z.number().int().nonnegative(),
      platform: z.string().min(1),
      displayServer: z.string().min(1).optional(),
    })
    .nullable(),
});

const ConsentBodySchema = z.object({
  requestId: z.string().min(1),
  // Required so a caller that learned a requestId from the SSE stream cannot
  // approve without also naming what it is approving. The store rejects a
  // mismatch rather than treating it as an answer.
  appIdentity: z.string().min(1),
  decision: z.enum(['allow_once', 'allow_run', 'always_allow', 'deny']),
});

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createInternalComputerRoutes(container: Container): Router {
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

  router.post('/endpoint', (req, res) => {
    const parsed = EndpointBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid body', details: parsed.error.flatten() } });
      return;
    }
    const bridge = container.cuaDriverBridge;
    if (!bridge) {
      res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Computer use is not enabled on this server' } });
      return;
    }
    bridge.setEndpoint(parsed.data.workspaceId, parsed.data.endpoint);
    container.logger.debug?.(
      `[InternalComputerRoutes] endpoint ${parsed.data.endpoint ? 'set' : 'cleared'} for workspace ${parsed.data.workspaceId}`,
    );
    res.json({ ok: true });
  });

  router.post('/consent', (req, res) => {
    const parsed = ConsentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid body', details: parsed.error.flatten() } });
      return;
    }
    const store = container.computerConsentStore;
    if (!store) {
      res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Computer use is not enabled on this server' } });
      return;
    }
    // `false` means nothing was waiting on that id — a replay, an expired
    // prompt, or an answer naming the wrong application.
    const accepted = store.resolve(parsed.data.requestId, parsed.data.decision, parsed.data.appIdentity);
    res.json({ ok: accepted });
  });

  return router;
}
