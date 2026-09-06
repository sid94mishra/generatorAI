// ────────────────────────────────────────────────────────────────
// POST /api/workflow-runs/:runId/stages/:stageId/wake
//
// The stage timeline has shown a "Wake now" button beside every sleeping
// stage for a while, wired to nothing: its only handler was
// `e.stopPropagation()`. The whole wake path existed (`stageRunRepo.wake`,
// `DurableSleepService`'s sweeper and its `onWake` resume) but had no
// on-demand entry point, so an operator watching a stage parked for six
// hours could not say "go now" short of restarting the server.
//
// These cases pin the route's contract, including the two ways it must
// refuse: a stage that belongs to a different run, and a stage that is not
// actually asleep.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { NotFoundError } from '@generatorai/shared';

import { createTestApp } from '../helpers/testApp.js';
import type { Container } from '../../src/composition-root.js';

const RUN_ID = '11111111-1111-1111-1111-111111111111';
const STAGE_ID = '22222222-2222-2222-2222-222222222222';

describe('POST /api/workflow-runs/:runId/stages/:stageId/wake', () => {
  let app: Express;
  let container: Container;

  beforeEach(() => {
    ({ app, container } = createTestApp());
  });

  /** A sleeping stage row belonging to RUN_ID. */
  function sleepingStage(overrides: Record<string, unknown> = {}) {
    return {
      id: STAGE_ID,
      workflowRunId: RUN_ID,
      status: 'sleeping',
      wakeAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      ...overrides,
    };
  }

  it('wakes a sleeping stage and reports it as accepted', async () => {
    (container.stageRunRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(sleepingStage());

    const res = await request(app).post(`/api/workflow-runs/${RUN_ID}/stages/${STAGE_ID}/wake`);

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ stageId: STAGE_ID });
    expect(container.durableSleepService.wakeNow).toHaveBeenCalledWith(STAGE_ID);
  });

  it('refuses a stage that belongs to a different run', async () => {
    // Without this check any run id in the path would serve as cover for
    // waking any stage in the system.
    (container.stageRunRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      sleepingStage({ workflowRunId: 'a-different-run' }),
    );

    const res = await request(app).post(`/api/workflow-runs/${RUN_ID}/stages/${STAGE_ID}/wake`);

    expect(res.status).toBe(404);
    expect(container.durableSleepService.wakeNow).not.toHaveBeenCalled();
  });

  it('returns 404 for a stage that does not exist', async () => {
    // The real repository REJECTS on an unknown id (`Promise<StageRun>`,
    // throwing `NotFoundError`) rather than resolving undefined. An
    // unguarded lookup would surface that as a 500.
    (container.stageRunRepo.getById as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NotFoundError('StageRun', STAGE_ID),
    );

    const res = await request(app).post(`/api/workflow-runs/${RUN_ID}/stages/${STAGE_ID}/wake`);

    expect(res.status).toBe(404);
    expect(container.durableSleepService.wakeNow).not.toHaveBeenCalled();
  });

  it('also returns 404 if a repository resolves undefined instead of throwing', async () => {
    (container.stageRunRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const res = await request(app).post(`/api/workflow-runs/${RUN_ID}/stages/${STAGE_ID}/wake`);

    expect(res.status).toBe(404);
    expect(container.durableSleepService.wakeNow).not.toHaveBeenCalled();
  });

  it('answers 409, not 404, when the stage is not sleeping', async () => {
    // A double-click lands here once the first press has already woken the
    // stage. It must not read as a broken link.
    (container.stageRunRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(
      sleepingStage({ status: 'running' }),
    );
    (container.durableSleepService.wakeNow as ReturnType<typeof vi.fn>).mockResolvedValue(
      'not_sleeping',
    );

    const res = await request(app).post(`/api/workflow-runs/${RUN_ID}/stages/${STAGE_ID}/wake`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STAGE_NOT_SLEEPING');
  });

  it('reports 404 when the service loses the row between the check and the wake', async () => {
    (container.stageRunRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue(sleepingStage());
    (container.durableSleepService.wakeNow as ReturnType<typeof vi.fn>).mockResolvedValue(
      'not_found',
    );

    const res = await request(app).post(`/api/workflow-runs/${RUN_ID}/stages/${STAGE_ID}/wake`);

    expect(res.status).toBe(404);
  });
});
