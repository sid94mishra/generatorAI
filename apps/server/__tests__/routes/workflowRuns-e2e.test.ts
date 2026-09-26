// ────────────────────────────────────────────────────────────────
// E2E: Workflow Run API Flow — the run routes over mocked services: start
// (the one invocation route), the commands API, delete
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  describe('POST /api/workflow-invocations — Start a run', () => {
    it('hands the request to the invocation service with a server-derived trigger (202)', async () => {
      const body = {
        target: { kind: 'definition', workflowDefinitionId: '11111111-1111-1111-1111-111111111111', testRun: true },
        variables: { target: 'src/', language: 'typescript' },
        client: 'web',
      };
      const res = await request(app).post('/api/workflow-invocations').send(body);
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ runId: 'run-1', status: 'starting' });
      expect(container.workflowInvocationService.invoke).toHaveBeenCalledWith(
        body,
        expect.objectContaining({ trigger: expect.objectContaining({ kind: 'user', client: 'web' }) }),
        [],
      );
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

      expect(container.workflowRunRepo.search).toHaveBeenCalledWith({ definitionId: 'def-1' });
    });

    it('should filter by status', async () => {
      await request(app).get('/api/workflow-runs?status=running');

      expect(container.workflowRunRepo.search).toHaveBeenCalledWith({ statuses: ['running'] });
    });
  });

  describe('GET /api/workflow-runs/:id — Get Run', () => {
    it('should return run with stage runs ordered by its pinned graph', async () => {
      (container.runDefinitionReader.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        stages: [{ key: 'plan' }, { key: 'build' }],
      });
      (container.stageRunRepo.getByRunId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'sr-build', stageKey: 'build' },
        { id: 'sr-plan', stageKey: 'plan' },
      ]);
      const res = await request(app).get('/api/workflow-runs/run-1');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', 'run-1');
      expect(res.body).toHaveProperty('status');
      expect(container.runDefinitionReader.get).toHaveBeenCalledWith('ver-1');
      expect(res.body.stageRuns.map((s: { id: string }) => s.id)).toEqual(['sr-plan', 'sr-build']);
    });
  });

  describe('POST /api/workflow-runs/:id/commands — the commands API', () => {
    it('passes a run command to the engine and answers 202', async () => {
      const res = await request(app).post('/api/workflow-runs/run-1/commands').send({ command: 'pause', mode: 'interrupt' });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ runId: 'run-1', command: 'pause' });
      expect(container.workflowRunService.command).toHaveBeenCalledWith('run-1', { command: 'pause', mode: 'interrupt' }, expect.any(Object));
    });

    it('answers an instance gate with approve (outcome, feedback, data)', async () => {
      const res = await request(app)
        .post('/api/workflow-runs/run-1/commands')
        .send({ command: 'approve', instanceId: 'sr-1', outcome: 'approved', data: { answers: { q1: ['yes'] } } });
      expect(res.status).toBe(202);
      expect(container.workflowRunService.command).toHaveBeenCalledWith('run-1', {
        command: 'approve',
        instanceId: 'sr-1',
        outcome: 'approved',
        data: { answers: { q1: ['yes'] } },
      });
    });

    it('rejects an unknown or malformed command with 400', async () => {
      for (const body of [{ command: 'explode' }, { command: 'approve', instanceId: 'sr-1' }, { command: 'resume', extra: 1 }]) {
        const res = await request(app).post('/api/workflow-runs/run-1/commands').send(body);
        expect(res.status).toBe(400);
      }
      expect(container.workflowRunService.command).not.toHaveBeenCalled();
    });

    it.each([
      ['not_found', 404],
      ['invalid_state', 409],
      ['version_conflict', 409],
      ['invalid_command', 400],
      ['engine_unavailable', 503],
    ] as const)('maps a %s refusal to %i', async (code, status) => {
      (container.workflowRunService.command as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, code, message: code });
      const res = await request(app).post('/api/workflow-runs/run-1/commands').send({ command: 'cancel' });
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code.toUpperCase());
    });
  });

  describe('Removed routes', () => {
    it('the per-action routes are gone', async () => {
      for (const path of ['start', 'fork', 'pause', 'resume', 'cancel', 'retry', 'stages/sr-1/approve', 'stages/sr-1/retry']) {
        const res = await request(app).post(`/api/workflow-runs/run-1/${path}`).send({});
        expect(res.status).toBe(404);
      }
      expect((await request(app).get('/api/workflow-runs/run-1/pending-interrupts')).status).toBe(404);
      expect((await request(app).post('/api/workflow-runs').send({})).status).toBe(404);
      expect((await request(app).post('/api/orchestrator/runs').send({})).status).toBe(404);
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
    it('supports invoke → pause → resume → cancel → delete through the commands API', async () => {
      const target = { kind: 'definition', workflowDefinitionId: '11111111-1111-1111-1111-111111111111' };
      expect((await request(app).post('/api/workflow-invocations').send({ target })).status).toBe(202);
      for (const command of ['pause', 'resume', 'cancel']) {
        expect((await request(app).post('/api/workflow-runs/run-1/commands').send({ command })).status).toBe(202);
      }
      expect([200, 204]).toContain((await request(app).delete('/api/workflow-runs/run-1')).status);
    });
  });
});
