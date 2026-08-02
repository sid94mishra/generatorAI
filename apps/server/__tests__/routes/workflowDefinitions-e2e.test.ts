// ────────────────────────────────────────────────────────────────
// E2E: Workflow Definition API Flow — Integration Tests (P9.2)
// Tests the complete workflow definition lifecycle via API
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import type { Express } from 'express';
import type { Container } from '../../src/composition-root.js';

describe('E2E: Workflow Definition API Flow', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  describe('POST /api/workflow-definitions — Create Definition', () => {
    it('should create a new workflow definition', async () => {
      const res = await request(app)
        .post('/api/workflow-definitions')
        .send({
          name: 'Test Workflow',
          description: 'A test workflow',
          sessionMode: 'auto',
          tags: ['test'],
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name');
      expect(container.workflowDefinitionService.createDefinition).toHaveBeenCalled();
    });
  });

  describe('GET /api/workflow-definitions — List Definitions', () => {
    it('should return all definitions', async () => {
      const res = await request(app).get('/api/workflow-definitions');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(container.workflowDefinitionService.listDefinitions).toHaveBeenCalled();
    });
  });

  describe('GET /api/workflow-definitions/:id — Get Definition with Stages', () => {
    it('should return definition with stages and edges', async () => {
      const res = await request(app).get('/api/workflow-definitions/def-1');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', 'def-1');
      expect(res.body).toHaveProperty('stages');
      expect(res.body).toHaveProperty('edges');
    });
  });

  describe('PATCH /api/workflow-definitions/:id — Update Definition', () => {
    it('should update definition', async () => {
      const res = await request(app)
        .patch('/api/workflow-definitions/def-1')
        .send({ name: 'Updated Workflow' });

      expect([200, 201]).toContain(res.status);
      expect(container.workflowDefinitionService.updateDefinition).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/workflow-definitions/:id — Delete Definition', () => {
    it('should delete definition', async () => {
      const res = await request(app).delete('/api/workflow-definitions/def-1');

      expect([200, 204]).toContain(res.status);
      expect(container.workflowDefinitionService.deleteDefinition).toHaveBeenCalledWith('def-1');
    });
  });

  describe('Stage Management', () => {
    it('POST /api/workflow-definitions/:id/stages — Add Stage', async () => {
      const res = await request(app)
        .post('/api/workflow-definitions/def-1/stages')
        .send({ name: 'Stage A', prompts: [{ label: 'step1', text: 'Do something', waitForCompletion: true }] });

      expect([200, 201]).toContain(res.status);
      expect(container.workflowDefinitionService.addStage).toHaveBeenCalled();
    });

    it('DELETE /api/workflow-definitions/:id/stages/:stageId — Remove Stage', async () => {
      const res = await request(app)
        .delete('/api/workflow-definitions/def-1/stages/stage-1');

      expect([200, 204]).toContain(res.status);
      expect(container.workflowDefinitionService.deleteStage).toHaveBeenCalledWith('stage-1');
    });
  });

  describe('Edge Management', () => {
    it('POST /api/workflow-definitions/:id/edges — Add Edge', async () => {
      const res = await request(app)
        .post('/api/workflow-definitions/def-1/edges')
        .send({
          fromStageId: '22222222-2222-2222-2222-222222222221',
          toStageId: '22222222-2222-2222-2222-222222222222',
          edgeType: 'on_success',
        });

      expect([200, 201]).toContain(res.status);
      expect(container.workflowDefinitionService.addEdge).toHaveBeenCalled();
    });

    it('DELETE /api/workflow-definitions/:id/edges/:edgeId — Remove Edge', async () => {
      const res = await request(app)
        .delete('/api/workflow-definitions/def-1/edges/edge-1');

      expect([200, 204]).toContain(res.status);
      expect(container.workflowDefinitionService.deleteEdge).toHaveBeenCalledWith('edge-1');
    });
  });

  describe('DAG Validation', () => {
    it('POST /api/workflow-definitions/:id/validate — Validate DAG', async () => {
      const res = await request(app)
        .post('/api/workflow-definitions/def-1/validate');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('valid', true);
    });
  });

  describe('Full Definition Lifecycle', () => {
    it('should support create → add stages → add edges → validate → delete flow', async () => {
      // 1. Create definition
      const createRes = await request(app)
        .post('/api/workflow-definitions')
        .send({ name: 'Full Lifecycle Workflow', sessionMode: 'auto' });
      expect(createRes.status).toBe(201);

      // 2. Add stage
      const stageRes = await request(app)
        .post('/api/workflow-definitions/def-1/stages')
        .send({ name: 'Stage A', prompts: [] });
      expect([200, 201]).toContain(stageRes.status);

      // 3. Add edge
      const edgeRes = await request(app)
        .post('/api/workflow-definitions/def-1/edges')
        .send({ fromStageId: '22222222-2222-2222-2222-222222222221', toStageId: '22222222-2222-2222-2222-222222222222', edgeType: 'on_success' });
      expect([200, 201]).toContain(edgeRes.status);

      // 4. Validate
      const validateRes = await request(app)
        .post('/api/workflow-definitions/def-1/validate');
      expect(validateRes.status).toBe(200);

      // 5. Delete
      const deleteRes = await request(app)
        .delete('/api/workflow-definitions/def-1');
      expect([200, 204]).toContain(deleteRes.status);
    });
  });
});
