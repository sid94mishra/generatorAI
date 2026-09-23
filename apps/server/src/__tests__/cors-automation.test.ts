import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCorsMiddleware } from '../middleware/cors.js';

describe('automation trigger preflight', () => {
  const origin = 'http://localhost:8081';
  function app() {
    const server = express();
    server.use(createCorsMiddleware({ origins: [origin] }));
    return server;
  }
  it('allows authenticated cross-origin triggers with either idempotency header', async () => {
    const response = await request(app()).options('/api/automations/example/trigger')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,dpop,content-type,idempotency-key,x-idempotency-key')
      .expect(204);
    const allowed = String(response.headers['access-control-allow-headers']).toLowerCase().split(',');
    expect(allowed).toEqual(expect.arrayContaining(['authorization', 'dpop', 'content-type', 'idempotency-key', 'x-idempotency-key']));
    expect(response.headers['access-control-allow-origin']).toBe(origin);
  });
  it('does not grant an unlisted origin access', async () => {
    const response = await request(app()).options('/api/automations/example/trigger')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
