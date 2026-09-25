// ────────────────────────────────────────────────────────────────
// Middleware — Integration Tests (requestId, error handling, CORS)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import type { Express } from 'express';
import type { Container } from '../../src/composition-root.js';
import { InvalidTransitionError, ValidationError } from '@generatorai/shared';

describe('Middleware Integration', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  describe('Request ID Middleware', () => {
    it('should generate request ID when not provided', async () => {
      const res = await request(app).get('/api/health');

      expect(res.headers['x-request-id']).toBeDefined();
      expect(typeof res.headers['x-request-id']).toBe('string');
    });

    it('should propagate provided request ID', async () => {
      const customId = 'custom-request-id-123';
      const res = await request(app)
        .get('/api/health')
        .set('x-request-id', customId);

      expect(res.headers['x-request-id']).toBe(customId);
    });
  });

  describe('CORS Middleware', () => {
    it('should return CORS headers', async () => {
      const res = await request(app)
        .options('/api/health')
        .set('Origin', 'http://localhost:5173');

      expect(res.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('Error Handler Middleware', () => {
    it('should map InvalidTransitionError to 409', async () => {
      (container.workflowRunService.startRun as ReturnType<typeof import('vitest').vi.fn>)
        .mockRejectedValue(new InvalidTransitionError('Cannot start from current state'));

      const res = await request(app).post('/api/workflow-runs/run-1/start');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(res.body.error.category).toBe('state');
    });

    it('should map ValidationError to 400', async () => {
      (container.workflowDefinitionService.create as ReturnType<typeof import('vitest').vi.fn>)
        .mockRejectedValue(new ValidationError('Invalid config', { name: ['too short'] }));

      const res = await request(app)
        .post('/api/workflow-definitions')
        .send({ name: 'x' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should map unknown errors to 502', async () => {
      (container.workflowDefinitionService.list as ReturnType<typeof import('vitest').vi.fn>)
        .mockRejectedValue(new Error('Something unexpected'));

      const res = await request(app).get('/api/workflow-definitions');

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('UNKNOWN_ERROR');
    });
  });
});
