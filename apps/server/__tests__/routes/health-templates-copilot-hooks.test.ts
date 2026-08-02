// ────────────────────────────────────────────────────────────────
// Health, Templates, Copilot, Hooks Routes — Integration Tests
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import type { Express } from 'express';
import type { Container } from '../../src/composition-root.js';

describe('Health Routes', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  describe('GET /api/health', () => {
    it('should return ok status when copilot is alive', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.copilot).toBe(true);
      expect(res.body.db).toBe(true);
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('should return degraded status when copilot is down', async () => {
      (container.harness.ping as ReturnType<typeof import('vitest').vi.fn>).mockResolvedValue(false);

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('degraded');
      expect(res.body.copilot).toBe(false);
    });
  });

  describe('GET /api/health/config', () => {
    it('should return public config without sensitive data', async () => {
      const res = await request(app).get('/api/health/config');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('port');
      expect(res.body).toHaveProperty('maxConcurrentSessions');
      expect(res.body).toHaveProperty('copilot.defaultModel', 'gpt-4.1');
      expect(res.body).toHaveProperty('streaming.heartbeatIntervalMs');
      // Should not expose secrets
      expect(res.body).not.toHaveProperty('webhooks.githubSecret');
      expect(res.body).not.toHaveProperty('security');
    });
  });
});

describe('Template Routes', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  describe('GET /api/templates', () => {
    it('should list all templates', async () => {
      const res = await request(app).get('/api/templates');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('should filter templates by category', async () => {
      const res = await request(app).get('/api/templates?category=generation');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].category).toBe('generation');
    });
  });

  describe('GET /api/templates/:id', () => {
    it('should return a template by ID', async () => {
      const res = await request(app).get('/api/templates/code-gen');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', 'code-gen');
    });

    it('should return 404 for non-existent template', async () => {
      const res = await request(app).get('/api/templates/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});

describe('Copilot Routes', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  describe('GET /api/copilot/models', () => {
    it('should return available models', async () => {
      const res = await request(app).get('/api/copilot/models');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toHaveProperty('id', 'gpt-4.1');
    });
  });

  describe('GET /api/copilot/state', () => {
    it('should return client state', async () => {
      const res = await request(app).get('/api/copilot/state');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('state', 'running');
    });
  });

  describe('GET /api/copilot/conversations', () => {
    it('should list active conversations', async () => {
      const res = await request(app).get('/api/copilot/conversations');

      expect(res.status).toBe(200);
      expect(res.body).toContain('conv-1');
    });
  });

  describe('POST /api/copilot/ping', () => {
    it('should return alive status', async () => {
      const res = await request(app).post('/api/copilot/ping');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('alive', true);
    });
  });
});

describe('Hooks Routes', () => {
  let app: Express;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  describe('GET /api/hooks/phases', () => {
    it('should return all 22 hook phases', async () => {
      const res = await request(app).get('/api/hooks/phases');

      expect(res.status).toBe(200);
      expect(res.body.totalPhases).toBe(22);
      expect(res.body).toHaveProperty('categories');
      expect(res.body).toHaveProperty('phases');
    });
  });
});

describe('API 404 Catch-all', () => {
  let app: Express;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  it('should return JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('API endpoint not found');
  });
});
