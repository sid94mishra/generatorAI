import { describe, expect, it } from 'vitest';
import { heldByPausedStages } from './pausedStages.js';

describe('heldByPausedStages (U-32)', () => {
  it('names the paused stages of a live run nothing else moves', () => {
    expect(
      heldByPausedStages({ status: 'waiting', stages: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'paused' }, { id: 'c', status: 'pending' }] }),
    ).toEqual(['b']);
  });

  it('is empty while another stage runs, waits on a person, or the run itself is paused', () => {
    expect(heldByPausedStages({ status: 'running', stages: [{ id: 'a', status: 'running' }, { id: 'b', status: 'paused' }] })).toEqual([]);
    expect(heldByPausedStages({ status: 'waiting', stages: [{ id: 'a', status: 'awaiting_input' }, { id: 'b', status: 'paused' }] })).toEqual([]);
    expect(heldByPausedStages({ status: 'paused', stages: [{ id: 'b', status: 'paused' }] })).toEqual([]);
  });
});
