// ────────────────────────────────────────────────────────────────
// Workflow Script Upload Route — gating tests (SCRIPT-1)
//
// The upload endpoint exposes an RCE surface (scripts run in-process with
// full server privileges), so it must be DISABLED unless the operator
// explicitly opts in via GENERATORAI_ALLOW_SCRIPT_UPLOAD=true.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import type { Express } from 'express';

describe('POST /api/workflow-scripts/upload — opt-in gate (SCRIPT-1)', () => {
  let app: Express;
  const prev = process.env['GENERATORAI_ALLOW_SCRIPT_UPLOAD'];

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  afterEach(() => {
    if (prev === undefined) delete process.env['GENERATORAI_ALLOW_SCRIPT_UPLOAD'];
    else process.env['GENERATORAI_ALLOW_SCRIPT_UPLOAD'] = prev;
  });

  it('returns 403 when upload is not explicitly enabled', async () => {
    delete process.env['GENERATORAI_ALLOW_SCRIPT_UPLOAD'];
    const res = await request(app)
      .post('/api/workflow-scripts/upload')
      .send({ filename: 'x.workflow.mjs', source: 'export default {};' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SCRIPT_UPLOAD_DISABLED');
  });

  it('rejects a bad filename even when enabled (400, not RCE)', async () => {
    process.env['GENERATORAI_ALLOW_SCRIPT_UPLOAD'] = 'true';
    const res = await request(app)
      .post('/api/workflow-scripts/upload')
      .send({ filename: '../escape.workflow.mjs', source: 'export default {};' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SCRIPT');
  });

  it('requires filename and source when enabled', async () => {
    process.env['GENERATORAI_ALLOW_SCRIPT_UPLOAD'] = 'true';
    const res = await request(app).post('/api/workflow-scripts/upload').send({ filename: 'x.workflow.mjs' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
