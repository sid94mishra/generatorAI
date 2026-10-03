// POST /api/agents/import/preview (mobile MG-12): the HTTP contract around
// AgentService.previewImport — 200 preview, 400 PARSE_ERROR, 413 TOO_LARGE —
// and the policy: it is an authoring call, same scope as the import.

import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requiredScopesFor } from '@generatorai/auth';
import { ValidationError } from '@generatorai/shared';
import { createAgentApiRoutes } from '../routes/agents.js';
import { createErrorMiddleware } from '../middleware/errorHandler.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function appWith(previewImport: ReturnType<typeof vi.fn>) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/agents', createAgentApiRoutes({ agentService: { previewImport }, agentResolver: {}, logger } as never));
  app.use(createErrorMiddleware(logger as never));
  return app;
}

describe('POST /api/agents/import/preview', () => {
  it('returns the preview and passes scope + project', async () => {
    const preview = { parsed: { name: 'A' }, warnings: [] };
    const fn = vi.fn(async () => preview);
    const res = await request(appWith(fn))
      .post('/api/agents/import/preview')
      .send({ markdown: '---\nname: A\n---\nbody', scope: 'project', projectId: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(preview);
    expect(fn).toHaveBeenCalledWith('---\nname: A\n---\nbody', { scope: 'project', projectId: 'p1' });
  });

  it('maps a parse failure to 400 PARSE_ERROR', async () => {
    const fn = vi.fn(async () => {
      throw new ValidationError('Agent frontmatter is missing `name`');
    });
    const res = await request(appWith(fn)).post('/api/agents/import/preview').send({ markdown: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: 'PARSE_ERROR', message: 'Agent frontmatter is missing `name`' });
  });

  it('refuses a document over 256 KB with 413', async () => {
    const fn = vi.fn();
    const res = await request(appWith(fn))
      .post('/api/agents/import/preview')
      .send({ markdown: 'a'.repeat(256 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('TOO_LARGE');
    expect(fn).not.toHaveBeenCalled();
  });

  it('needs the same scope as the import', () => {
    expect(requiredScopesFor('POST', '/agents/import/preview').scopes).toEqual(
      requiredScopesFor('POST', '/agents/import').scopes,
    );
  });
});
