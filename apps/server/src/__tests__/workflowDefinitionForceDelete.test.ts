// DELETE /workflow-definitions/:id?force=true also deletes the definition's
// runs, so it must require exec:agent like deleting a run directly does.
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createWorkflowDefinitionRoutes } from '../routes/workflowDefinitions.js';

function makeApp(scopes: string[] | null) {
  const deleteDefinition = vi.fn(async () => undefined);
  const container = {
    workflowDefinitionService: { deleteDefinition },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const app = express();
  app.use((req, _res, next) => {
    if (scopes) (req as unknown as { principal: unknown }).principal = { type: 'device', id: 'd1', scopes };
    next();
  });
  app.use('/workflow-definitions', createWorkflowDefinitionRoutes(container as never));
  return { app, deleteDefinition };
}

describe('workflow definition force delete', () => {
  it('refuses a cascading delete without exec:agent', async () => {
    const { app, deleteDefinition } = makeApp(['write:workflows']);
    const res = await request(app).delete('/workflow-definitions/w1?force=true');
    expect(res.status).toBe(403);
    expect(deleteDefinition).not.toHaveBeenCalled();
  });

  it('allows a plain delete with write:workflows', async () => {
    const { app, deleteDefinition } = makeApp(['write:workflows']);
    const res = await request(app).delete('/workflow-definitions/w1');
    expect(res.status).toBe(204);
    expect(deleteDefinition).toHaveBeenCalledWith('w1', { force: false });
  });

  it('allows a cascading delete with exec:agent', async () => {
    const { app, deleteDefinition } = makeApp(['write:workflows', 'exec:agent']);
    const res = await request(app).delete('/workflow-definitions/w1?force=true');
    expect(res.status).toBe(204);
    expect(deleteDefinition).toHaveBeenCalledWith('w1', { force: true });
  });
});
