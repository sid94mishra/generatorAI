// Audit F-9: a request from a disallowed Origin was thrown into the generic
// error handler and came back as 502 UNKNOWN_ERROR — with a stack trace
// (absolute paths) in development. A refused origin is a policy decision:
// 403 ORIGIN_NOT_ALLOWED. And no response body carries a stack, in any env.

import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { ILogger } from '@generatorai/shared';
import { createCorsMiddleware } from '../../src/middleware/cors.js';
import { createErrorMiddleware } from '../../src/middleware/errorHandler.js';

const ORIGINAL_ENV = process.env['NODE_ENV'];
afterEach(() => {
  process.env['NODE_ENV'] = ORIGINAL_ENV;
});

function logger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } as unknown as ILogger;
}

function makeApp(log = logger()) {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId = 'req-1';
    next();
  });
  app.use(createCorsMiddleware({ origins: ['http://localhost:5173'], dynamicOrigins: () => ['https://192.168.1.20:3100'] }));
  app.post('/api/auth/pair/preview', (_req, res) => res.json({ ok: true }));
  app.get('/api/boom', () => {
    throw new Error('kaboom at /Users/someone/secret/path.ts');
  });
  app.use(createErrorMiddleware(log));
  return { app, log };
}

describe('CORS rejection (F-9)', () => {
  it('answers a disallowed origin with 403 ORIGIN_NOT_ALLOWED, not 502, and no stack', async () => {
    process.env['NODE_ENV'] = 'development';
    const { app } = makeApp();
    const res = await request(app).post('/api/auth/pair/preview').set('Origin', 'http://evil.example').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(res.body.error.requestId).toBe('req-1');
    expect(JSON.stringify(res.body)).not.toContain('stack');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses the preflight the same way', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .options('/api/auth/pair/preview')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('still serves allowed, dynamic and origin-less requests with CORS headers', async () => {
    const { app } = makeApp();
    const allowed = await request(app).post('/api/auth/pair/preview').set('Origin', 'http://localhost:5173').send({});
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const dynamic = await request(app).post('/api/auth/pair/preview').set('Origin', 'https://192.168.1.20:3100').send({});
    expect(dynamic.status).toBe(200);
    expect((await request(app).post('/api/auth/pair/preview').send({})).status).toBe(200);
  });
});

describe('error responses never carry a stack (F-9)', () => {
  it('omits the stack even in development, and logs it with the requestId', async () => {
    process.env['NODE_ENV'] = 'development';
    const { app, log } = makeApp();
    const res = await request(app).get('/api/boom');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.error.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('[ErrorHandler]'),
      expect.objectContaining({ requestId: 'req-1', stack: expect.stringContaining('kaboom') }),
    );
  });
});
