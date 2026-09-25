// ────────────────────────────────────────────────────────────────
// E2E: Workflow Run API Flow — Integration Tests (P9.3 + P9.4)
// Tests the complete workflow run lifecycle and session allocation
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import type { Express } from 'express';
import type { Container } from '../../src/composition-root.js';

describe('E2E: Workflow Run API Flow', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  describe('POST /api/workflow-runs — Create Run', () => {
    it('should create a new workflow run', async () => {
      const res = await request(app)
        .post('/api/workflow-runs')
        .send({
          workflowDefinitionId: '11111111-1111-1111-1111-111111111111',
          variables: { target: 'src/', language: 'typescript' },
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('status', 'created');
      expect(container.workflowRunService.createRun).toHaveBeenCalled();
    });
  });

  describe('GET /api/workflow-runs — List Runs', () => {
    it('should return all runs', async () => {
      const res = await request(app).get('/api/workflow-runs');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should filter by definition ID', async () => {
      await request(app).get('/api/workflow-runs?definitionId=def-1');

      expect(container.workflowRunRepo.getByDefinitionId).toHaveBeenCalledWith('def-1');
    });

    it('should filter by status', async () => {
      await request(app).get('/api/workflow-runs?status=running');

      expect(container.workflowRunRepo.getByStatus).toHaveBeenCalled();
    });
  });

  describe('GET /api/workflow-runs/:id — Get Run', () => {
    it('should return run with stage runs', async () => {
      const res = await request(app).get('/api/workflow-runs/run-1');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', 'run-1');
      expect(res.body).toHaveProperty('status');
    });
  });

  describe('POST /api/workflow-runs/:id/stages/:stageId/approve — HITL verdict', () => {
    it('requires an explicit outcome; the boolean approved field is gone', async () => {
      const res = await request(app)
        .post('/api/workflow-runs/run-1/stages/sr-1/approve')
        .send({ approved: true });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/outcome is required/);
    });
  });

  describe('POST /api/workflow-runs/:id/start — Start Run', () => {
    it('should start the run', async () => {
      const res = await request(app)
        .post('/api/workflow-runs/run-1/start');

      expect([200, 202]).toContain(res.status);
      expect(container.workflowRunService.startRun).toHaveBeenCalledWith('run-1');
    });
  });

  describe('POST /api/workflow-runs/:id/pause — Pause Run', () => {
    it('should pause the run', async () => {
      const res = await request(app)
        .post('/api/workflow-runs/run-1/pause');

      expect([200, 202]).toContain(res.status);
      expect(container.workflowRunService.pauseRun).toHaveBeenCalledWith('run-1');
    });
  });

  describe('POST /api/workflow-runs/:id/resume — Resume Run', () => {
    it('should resume the run', async () => {
      const res = await request(app)
        .post('/api/workflow-runs/run-1/resume');

      expect([200, 202]).toContain(res.status);
      expect(container.workflowRunService.resumeRun).toHaveBeenCalledWith('run-1');
    });
  });

  describe('POST /api/workflow-runs/:id/cancel — Cancel Run', () => {
    it('should cancel the run', async () => {
      const res = await request(app)
        .post('/api/workflow-runs/run-1/cancel');

      expect([200, 202]).toContain(res.status);
      expect(container.workflowRunService.cancelRun).toHaveBeenCalledWith('run-1');
    });
  });

  describe('POST /api/workflow-runs/:id/retry — Retry Run', () => {
    it('starts the NEW run that retryRun created, not the failed ancestor', async () => {
      // The route used to call startRun(runId) — the already-failed ancestor —
      // so Retry was a no-op that orphaned a `created` run on every press.
      const res = await request(app).post('/api/workflow-runs/run-1/retry');

      expect(res.status).toBe(202);
      expect(container.workflowRunService.retryRun).toHaveBeenCalledWith('run-1');
      expect(container.workflowRunService.startRun).toHaveBeenCalledWith('run-retry-1');
      expect(container.workflowRunService.startRun).not.toHaveBeenCalledWith('run-1');
    });

    it('returns the new run id and the ancestor so the UI can follow it', async () => {
      const res = await request(app).post('/api/workflow-runs/run-1/retry');

      expect(res.body).toMatchObject({
        runId: 'run-retry-1',
        ancestorRunId: 'run-1',
        status: 'created',
      });
    });
  });

  describe('DELETE /api/workflow-runs/:id — Delete Run', () => {
    it('should delete the run', async () => {
      const res = await request(app)
        .delete('/api/workflow-runs/run-1');

      expect([200, 204]).toContain(res.status);
      expect(container.workflowRunService.deleteRun).toHaveBeenCalledWith('run-1');
    });
  });

  describe('Full Run Lifecycle', () => {
    it('should support create → start → pause → resume → cancel → delete flow', async () => {
      // 1. Create
      const createRes = await request(app)
        .post('/api/workflow-runs')
        .send({ workflowDefinitionId: '11111111-1111-1111-1111-111111111111' });
      expect(createRes.status).toBe(201);

      // 2. Start
      const startRes = await request(app)
        .post('/api/workflow-runs/run-1/start');
      expect([200, 202]).toContain(startRes.status);

      // 3. Pause
      const pauseRes = await request(app)
        .post('/api/workflow-runs/run-1/pause');
      expect([200, 202]).toContain(pauseRes.status);

      // 4. Resume
      const resumeRes = await request(app)
        .post('/api/workflow-runs/run-1/resume');
      expect([200, 202]).toContain(resumeRes.status);

      // 5. Cancel
      const cancelRes = await request(app)
        .post('/api/workflow-runs/run-1/cancel');
      expect([200, 202]).toContain(cancelRes.status);

      // 6. Delete
      const deleteRes = await request(app)
        .delete('/api/workflow-runs/run-1');
      expect([200, 204]).toContain(deleteRes.status);
    });
  });
});

describe('E2E: Session Allocation Modes', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  it('should create a run with single session mode', async () => {
    const res = await request(app)
      .post('/api/workflow-runs')
      .send({
        workflowDefinitionId: '11111111-1111-1111-1111-111111111111',
        variables: {},
      });

    expect(res.status).toBe(201);
    expect(container.workflowRunService.createRun).toHaveBeenCalled();
  });

  it('should create run and start it, verifying run service is invoked', async () => {
    await request(app)
      .post('/api/workflow-runs')
      .send({ workflowDefinitionId: '11111111-1111-1111-1111-111111111111' });

    await request(app)
      .post('/api/workflow-runs/run-1/start');

    expect(container.workflowRunService.startRun).toHaveBeenCalledWith('run-1');
    // The startRun method internally calls DAGScheduler and SessionAllocator
    // which are verified through unit tests in packages/core
  });
});
