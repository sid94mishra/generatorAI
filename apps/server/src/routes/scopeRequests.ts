// ────────────────────────────────────────────────────────────────
// /api/auth — device scope requests (mobile standalone plan S2)
//
// A paired device (typically a phone holding DEFAULT_MOBILE_SCOPES) asks for
// more authority from inside the app; an `admin:devices` holder answers from
// web/desktop Settings › Security or from an admin phone. The request grants
// nothing by itself — approval runs through `DeviceService.updateDeviceScopes`,
// so the "cannot grant beyond your own scopes" rule and the critical audit for
// high-risk grants apply exactly as they do to `PUT /devices/:id/scopes`.
//
// Route policy (packages/auth/src/routePolicy.ts):
//   /auth/devices/me/scope-requests  read:status   (the device's OWN requests;
//                                                  id comes from the principal)
//   /auth/scope-requests             admin:devices (review + resolve)
// ────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  PairingError,
  SCOPES,
  ScopeRequestError,
  type DeviceScopeRequestRecord,
  type Principal,
} from '@generatorai/auth';
import type { Container } from '../composition-root.js';

const createSchema = z.object({
  scopes: z.array(z.string().min(1).max(64)).min(1).max(SCOPES.length),
  reason: z.string().max(500).optional(),
});

const approveSchema = z.object({
  scopes: z.array(z.string().min(1).max(64)).max(SCOPES.length).optional(),
  note: z.string().max(500).optional(),
});

const denySchema = z.object({
  note: z.string().max(500).optional(),
});

/** Wire shape. Adds the device's name/platform so a list needs no second fetch. */
export interface PublicScopeRequest {
  requestId: string;
  deviceId: string;
  deviceName: string | null;
  platform: string | null;
  scopes: string[];
  reason: string | null;
  status: DeviceScopeRequestRecord['status'];
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  grantedScopes: string[] | null;
}

export function createScopeRequestRoutes(container: Container): Router {
  const router = Router();
  const { devices } = container.security;
  const logger = container.logger;

  const publish = (kind: string, data: Record<string, unknown>): void => {
    // Lifecycle event on the global scope (LIFECYCLE_EVENT_KINDS) so admin
    // devices' lists refresh. Fire-and-forget: a stream hiccup must not fail
    // the request that already persisted.
    void container.eventBus
      .emitGlobal({ kind, data } as Parameters<typeof container.eventBus.emitGlobal>[0])
      .catch((err: unknown) => {
        logger.warn('[ScopeRequests] Could not publish lifecycle event', {
          kind,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  };

  const decorate = async (record: DeviceScopeRequestRecord): Promise<PublicScopeRequest> => {
    const device = await devices.getDevice(record.deviceId);
    return toPublic(record, device ? { name: device.name, platform: device.platform } : null);
  };

  // ── The device's own requests ───────────────────────────────────

  router.post('/devices/me/scope-requests', (req: Request, res: Response) => {
    void (async () => {
      const principal = requirePrincipal(req);
      if (principal.type !== 'paired-device') {
        // Only a device has scopes an admin can raise. The local desktop and
        // service accounts hold what they were configured with.
        res.status(403).json({
          error: { code: 'NOT_A_DEVICE', message: 'Only a paired device can request scopes' },
        });
        return;
      }
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }
      try {
        const record = await devices.requestScopes({
          principal,
          scopes: parsed.data.scopes,
          reason: parsed.data.reason ?? null,
          requestId: req.requestId,
        });
        const device = await devices.getDevice(record.deviceId);
        publish('device.scope_requested', {
          requestId: record.requestId,
          deviceId: record.deviceId,
          deviceName: device?.name ?? principal.displayName ?? null,
          platform: device?.platform ?? null,
          scopes: record.requestedScopes,
        });
        res.status(201).json(await decorate(record));
      } catch (err) {
        await handleError(err, res, logger, decorate);
      }
    })();
  });

  router.get('/devices/me/scope-requests', (req: Request, res: Response) => {
    void (async () => {
      const principal = requirePrincipal(req);
      if (principal.type !== 'paired-device') {
        res.json({ requests: [] });
        return;
      }
      try {
        const list = await devices.listScopeRequestsForDevice(principal.deviceId ?? principal.id);
        res.json({ requests: await Promise.all(list.map(decorate)) });
      } catch (err) {
        await handleError(err, res, logger, decorate);
      }
    })();
  });

  router.delete('/devices/me/scope-requests/:requestId', (req: Request, res: Response) => {
    void (async () => {
      const principal = requirePrincipal(req);
      if (principal.type !== 'paired-device') {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Scope request not found' } });
        return;
      }
      try {
        const record = await devices.cancelScopeRequest(pathParam(req, 'requestId'), principal);
        const device = await devices.getDevice(record.deviceId);
        publish('device.scope_request_resolved', {
          requestId: record.requestId,
          deviceId: record.deviceId,
          deviceName: device?.name ?? null,
          status: 'cancelled',
          scopes: record.requestedScopes,
        });
        res.status(204).end();
      } catch (err) {
        await handleError(err, res, logger, decorate);
      }
    })();
  });

  // ── Administration (admin:devices) ──────────────────────────────

  router.get('/scope-requests', (req: Request, res: Response) => {
    void (async () => {
      const status = typeof req.query['status'] === 'string' ? req.query['status'] : 'pending';
      if (status !== 'pending') {
        // Only the queue is listed. History is per device (the device's own
        // list) and in the audit log; an unbounded "everything" listing
        // would be one more thing to paginate and nobody has asked for it.
        res.status(400).json({
          error: { code: 'UNSUPPORTED_FILTER', message: "Only status=pending is supported" },
        });
        return;
      }
      try {
        const list = await devices.listPendingScopeRequests();
        res.json({ requests: await Promise.all(list.map(decorate)) });
      } catch (err) {
        await handleError(err, res, logger, decorate);
      }
    })();
  });

  router.post('/scope-requests/:requestId/approve', (req: Request, res: Response) => {
    void (async () => {
      const parsed = approveSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }
      const principal = requirePrincipal(req);
      try {
        const { request, deviceScopes } = await devices.approveScopeRequest({
          requestId: pathParam(req, 'requestId'),
          principal,
          scopes: parsed.data.scopes,
          note: parsed.data.note ?? null,
        });
        const device = await devices.getDevice(request.deviceId);
        publish('device.scope_request_resolved', {
          requestId: request.requestId,
          deviceId: request.deviceId,
          deviceName: device?.name ?? null,
          status: 'approved',
          scopes: request.grantedScopes ?? [],
        });
        res.json({ request: await decorate(request), deviceScopes });
      } catch (err) {
        await handleError(err, res, logger, decorate);
      }
    })();
  });

  router.post('/scope-requests/:requestId/deny', (req: Request, res: Response) => {
    void (async () => {
      const parsed = denySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }
      const principal = requirePrincipal(req);
      try {
        const request = await devices.denyScopeRequest({
          requestId: pathParam(req, 'requestId'),
          principal,
          note: parsed.data.note ?? null,
        });
        const device = await devices.getDevice(request.deviceId);
        publish('device.scope_request_resolved', {
          requestId: request.requestId,
          deviceId: request.deviceId,
          deviceName: device?.name ?? null,
          status: 'denied',
          scopes: request.requestedScopes,
        });
        res.json({ request: await decorate(request) });
      } catch (err) {
        await handleError(err, res, logger, decorate);
      }
    })();
  });

  return router;
}

// ── Helpers ────────────────────────────────────────────────────────

function toPublic(
  record: DeviceScopeRequestRecord,
  device: { name: string; platform: string } | null,
): PublicScopeRequest {
  return {
    requestId: record.requestId,
    deviceId: record.deviceId,
    deviceName: device?.name ?? null,
    platform: device?.platform ?? null,
    scopes: [...record.requestedScopes],
    reason: record.reason,
    status: record.status,
    createdAt: record.createdAt,
    resolvedAt: record.resolvedAt,
    resolvedBy: record.resolvedBy,
    resolutionNote: record.resolutionNote,
    grantedScopes: record.grantedScopes ? [...record.grantedScopes] : null,
  };
}

const STATUS_BY_CODE: Record<ScopeRequestError['code'], number> = {
  UNKNOWN_SCOPE: 400,
  SCOPES_ALREADY_HELD: 400,
  NOT_IN_REQUEST: 400,
  SCOPE_NOT_REQUESTABLE: 403,
  NOT_FOUND: 404,
  REQUEST_PENDING: 409,
  NOT_PENDING: 409,
  DEVICE_REVOKED: 409,
  UNAVAILABLE: 501,
};

async function handleError(
  err: unknown,
  res: Response,
  logger: { warn(msg: string, meta?: Record<string, unknown>): void },
  decorate: (record: DeviceScopeRequestRecord) => Promise<PublicScopeRequest>,
): Promise<void> {
  if (err instanceof ScopeRequestError) {
    res.status(STATUS_BY_CODE[err.code]).json({
      error: { code: err.code, message: err.message },
      // 409 REQUEST_PENDING carries the request that is already open so the
      // phone can show it instead of a bare conflict.
      ...(err.existing ? { existing: await decorate(err.existing) } : {}),
    });
    return;
  }
  if (err instanceof PairingError) {
    res
      .status(err.code === 'SCOPE_ESCALATION' ? 403 : 400)
      .json({ error: { code: err.code, message: err.message } });
    return;
  }
  logger.warn('[ScopeRequests] Operation failed', {
    error: err instanceof Error ? err.message : String(err),
  });
  res.status(500).json({
    error: { code: 'SCOPE_REQUEST_FAILED', message: 'The scope request could not be processed.' },
  });
}

function requirePrincipal(req: Request): Principal {
  const principal = req.principal;
  if (!principal) throw new Error('No principal on an authenticated route');
  return principal;
}

/** Express 5 types path params as `string | string[]`; we only ever want one. */
function pathParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}
