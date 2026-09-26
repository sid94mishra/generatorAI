// P02 acceptance — a stage's widget reaches that stage's stream on the run
// page: the render event carries the stage run id as well as the run id.

import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@generatorai/shared';
import { WidgetService } from '../../src/services/WidgetService.js';
import type { EventBus } from '../../src/events/EventBus.js';

describe('stage widgets', () => {
  it('the render event carries workflowRunId and stageRunId', async () => {
    const emitted: AgentEvent[] = [];
    const eventBus = { emit: vi.fn(async (_s: string, e: AgentEvent) => void emitted.push(e)) } as unknown as EventBus;
    const svc = new WidgetService(
      { create: async () => undefined } as never,
      {
        get: () => ({ id: 'ext/chart', extensionId: 'ext', component: 'chart', entry: 'chart.html', title: 'Chart' }),
      } as never,
      { get: () => ({ enabled: true, ready: true, rootPath: '' }) } as never,
      eventBus,
    );
    await svc.createInstance({
      descriptorId: 'ext/chart',
      sessionId: 'sess-stage',
      workflowRunId: 'run-1',
      stageRunId: 'sr-1',
    } as never);
    expect(emitted[0]).toMatchObject({
      kind: 'harness.widget.render',
      data: { workflowRunId: 'run-1', stageRunId: 'sr-1' },
    });
  });
});
