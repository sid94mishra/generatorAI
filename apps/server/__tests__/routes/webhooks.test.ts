// ────────────────────────────────────────────────────────────────
// Webhook Routes — Integration Tests
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import type { Express } from 'express';
import type { Container } from '../../src/composition-root.js';

describe('Webhook Routes', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  describe('POST /api/webhooks/github', () => {
    it('should process a GitHub webhook without secret', async () => {
      const res = await request(app)
        .post('/api/webhooks/github')
        .set('x-github-event', 'push')
        .set('x-github-delivery', 'delivery-1')
        .send({ ref: 'refs/heads/main' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Webhook processed');
      expect(container.webhookService.handleGitHub).toHaveBeenCalledOnce();
    });

    it('should verify HMAC signature when secret is configured', async () => {
      const secret = 'test-secret';
      ({ app, container } = createTestApp({
        webhooks: {
          enabled: true,
          githubSecret: secret,
          rateLimitPerMinute: 60,
        },
      } as Record<string, unknown>));

      const body = JSON.stringify({ ref: 'refs/heads/main' });
      const hmac = crypto.createHmac('sha256', secret);
      const signature = 'sha256=' + hmac.update(body).digest('hex');

      const res = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-github-event', 'push')
        .set('x-github-delivery', 'delivery-1')
        .set('x-hub-signature-256', signature)
        .send(body);

      expect(res.status).toBe(200);
    });

    it('should reject invalid HMAC signature', async () => {
      ({ app, container } = createTestApp({
        webhooks: {
          enabled: true,
          githubSecret: 'correct-secret',
          rateLimitPerMinute: 60,
        },
      } as Record<string, unknown>));

      const res = await request(app)
        .post('/api/webhooks/github')
        .set('x-github-event', 'push')
        .set('x-github-delivery', 'delivery-1')
        .set('x-hub-signature-256', 'sha256=invalid')
        .send({ ref: 'refs/heads/main' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /api/webhooks/custom/:trigger', () => {
    it('should process a custom webhook trigger', async () => {
      const res = await request(app)
        .post('/api/webhooks/custom/deploy')
        .send({ environment: 'production' });

      expect(res.status).toBe(200);
      expect(res.body.trigger).toBe('deploy');
      // Third arg is the optional Idempotency-Key header value; undefined
      // when the client didn't send one.
      expect(container.webhookService.handleCustom).toHaveBeenCalledWith(
        'deploy',
        { environment: 'production' },
        undefined,
      );
    });

    it('should require auth when webhookToken is configured', async () => {
      ({ app, container } = createTestApp({
        webhooks: {
          enabled: true,
          webhookToken: 'my-secret-token',
          rateLimitPerMinute: 60,
        },
      } as Record<string, unknown>));

      // Without auth
      const res1 = await request(app)
        .post('/api/webhooks/custom/deploy')
        .send({});

      expect(res1.status).toBe(401);

      // With valid token
      const res2 = await request(app)
        .post('/api/webhooks/custom/deploy')
        .set('Authorization', 'Bearer my-secret-token')
        .send({});

      expect(res2.status).toBe(200);
    });
  });

  describe('Webhook Registrations CRUD', () => {
    it('GET /api/webhooks/registrations should return list', async () => {
      const res = await request(app).get('/api/webhooks/registrations');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('POST /api/webhooks/registrations should create registration', async () => {
      const res = await request(app)
        .post('/api/webhooks/registrations')
        .send({
          name: 'PR Review Trigger',
          source: 'github',
          eventType: 'pull_request.opened',
          templateId: 'code-review',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('PR Review Trigger');
    });

    it('DELETE /api/webhooks/registrations/:id should return 204', async () => {
      const res = await request(app).delete('/api/webhooks/registrations/reg-1');

      expect(res.status).toBe(204);
      expect(container.webhookService.deleteRegistration).toHaveBeenCalledWith('reg-1');
    });
  });
});
