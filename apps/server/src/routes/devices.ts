// ────────────────────────────────────────────────────────────────
// /api/workspaces/:id/devices — the Devices dock tab (docs/devices §5).
//
// The pane's own reads and actions. They run as the USER (no agent-access
// check); the live view and touch input are the WebSocket in `device-ws.ts`.
// Scope: `exec:device` (auth routePolicy).
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Container } from '../composition-root.js';

type Params = { id: string };

function idOf(req: Request): string {
  return String((req.params as Params).id ?? '');
}

const DeviceKeySchema = z.string().min(1).max(300);

const InputEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('key'), key: z.enum(['enter', 'delete', 'tab', 'escape', 'up', 'down', 'left', 'right']) }),
  z.object({ type: z.literal('text'), text: z.string().max(5000) }),
  z.object({ type: z.literal('button'), button: z.enum(['home', 'back', 'recents', 'lock', 'volume_up', 'volume_down']) }),
  z.object({ type: z.literal('rotate') }),
]);

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export function createDeviceRoutes(container: Container): Router {
  const router = Router({ mergeParams: true });
  const { deviceService, executionWorkspaceRepo } = container;

  async function workspaceOk(req: Request, res: Response): Promise<string | null> {
    const workspaceId = idOf(req);
    const ws = await executionWorkspaceRepo.findById(workspaceId).catch(() => null);
    if (!ws) {
      fail(res, 404, 'NOT_FOUND', `Workspace not found: ${workspaceId}`);
      return null;
    }
    return workspaceId;
  }

  // GET /workspaces/:id/devices — devices (with this chat's agent access) and tooling.
  router.get('/', async (req, res, next) => {
    try {
      const workspaceId = await workspaceOk(req, res);
      if (!workspaceId) return;
      const overview = await deviceService.overview(workspaceId, req.query['fresh'] === '1');
      res.json({ ...overview, open: deviceService.current(workspaceId) ?? null });
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/devices/start { device } — boot if needed and open it in this chat.
  router.post('/start', async (req, res, next) => {
    try {
      const workspaceId = await workspaceOk(req, res);
      if (!workspaceId) return;
      const body = z.object({ device: DeviceKeySchema }).safeParse(req.body ?? {});
      if (!body.success) return fail(res, 400, 'VALIDATION', body.error.message);
      req.setTimeout(660_000);
      res.json({ device: await deviceService.startDevice(workspaceId, body.data.device) });
    } catch (err) {
      if (!res.headersSent) fail(res, 409, 'DEVICE_START_FAILED', (err as Error).message);
      else next(err);
    }
  });

  // POST /workspaces/:id/devices/stop { device } — shut a virtual device down.
  router.post('/stop', async (req, res, next) => {
    try {
      const workspaceId = await workspaceOk(req, res);
      if (!workspaceId) return;
      const body = z.object({ device: DeviceKeySchema }).safeParse(req.body ?? {});
      if (!body.success) return fail(res, 400, 'VALIDATION', body.error.message);
      await deviceService.stopDevice(workspaceId, body.data.device);
      res.json({ ok: true });
    } catch (err) {
      if (!res.headersSent) fail(res, 409, 'DEVICE_STOP_FAILED', (err as Error).message);
      else next(err);
    }
  });

  // POST /workspaces/:id/devices/access { device, allowed } — the pane's Agent switch / Take over (DV-8).
  router.post('/access', async (req, res, next) => {
    try {
      const workspaceId = await workspaceOk(req, res);
      if (!workspaceId) return;
      const body = z.object({ device: DeviceKeySchema, allowed: z.boolean() }).safeParse(req.body ?? {});
      if (!body.success) return fail(res, 400, 'VALIDATION', body.error.message);
      deviceService.setAgentAccess(workspaceId, body.data.device, body.data.allowed);
      res.json({ ok: true, agentAccess: body.data.allowed });
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/devices/input { device, event } — a hardware key or rotate without a live view.
  router.post('/input', async (req, res, next) => {
    try {
      const workspaceId = await workspaceOk(req, res);
      if (!workspaceId) return;
      const body = z.object({ device: DeviceKeySchema, event: InputEventSchema }).safeParse(req.body ?? {});
      if (!body.success) return fail(res, 400, 'VALIDATION', body.error.message);
      await deviceService.userInput(workspaceId, body.data.device, body.data.event);
      res.json({ ok: true });
    } catch (err) {
      if (!res.headersSent) fail(res, 409, 'DEVICE_INPUT_FAILED', (err as Error).message);
      else next(err);
    }
  });

  // GET /workspaces/:id/devices/snapshot?device= — the element tree, for Select (DV-11).
  router.get('/snapshot', async (req, res, next) => {
    try {
      const workspaceId = await workspaceOk(req, res);
      if (!workspaceId) return;
      const device = DeviceKeySchema.safeParse(req.query['device']);
      if (!device.success) return fail(res, 400, 'VALIDATION', 'device is required');
      res.json(await deviceService.snapshot(workspaceId, device.data, { by: 'user', all: true }));
    } catch (err) {
      if (!res.headersSent) fail(res, 409, 'DEVICE_SNAPSHOT_FAILED', (err as Error).message);
      else next(err);
    }
  });

  // GET /workspaces/:id/devices/screenshot?device= — a JPEG of the screen (Screenshot → chat / file).
  router.get('/screenshot', async (req, res, next) => {
    try {
      const workspaceId = await workspaceOk(req, res);
      if (!workspaceId) return;
      const device = DeviceKeySchema.safeParse(req.query['device']);
      if (!device.success) return fail(res, 400, 'VALIDATION', 'device is required');
      const shot = await deviceService.screenshot(workspaceId, device.data, 'user', 2400);
      res.setHeader('Content-Type', shot.mimeType);
      res.setHeader('Cache-Control', 'no-store');
      res.send(shot.bytes);
    } catch (err) {
      if (!res.headersSent) fail(res, 409, 'DEVICE_SCREENSHOT_FAILED', (err as Error).message);
      else next(err);
    }
  });

  return router;
}
