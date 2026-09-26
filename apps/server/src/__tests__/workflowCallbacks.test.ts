import { describe, expect, it } from 'vitest';
import { defaultDeliveryKey } from '../routes/workflowCallbacks.js';

describe('workflow callbacks (P05 §4.3)', () => {
  // MAPWAIT-R4: two waits on one event key each get their own delivery of the same data.
  it('keys a delivery without an idempotency key by its wait and its data', () => {
    const data = { build: 'passed' };
    expect(defaultDeliveryKey('wait-1', data)).toBe(defaultDeliveryKey('wait-1', { build: 'passed' })); // a retry replays
    expect(defaultDeliveryKey('wait-1', data)).not.toBe(defaultDeliveryKey('wait-2', data));
    expect(defaultDeliveryKey('wait-1', data)).not.toBe(defaultDeliveryKey('wait-1', { build: 'failed' }));
  });
});
