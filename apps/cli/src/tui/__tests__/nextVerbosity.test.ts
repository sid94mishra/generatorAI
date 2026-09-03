import { describe, expect, it } from 'vitest';
import { nextVerbosity } from '../App.js';

// Phase 6 item 4 — `run.verbosity` was a registered keymap id with zero
// handler; pulled the cycle order out as a pure function for the same
// reason `decideClosePane` was.
describe('nextVerbosity', () => {
  it('cycles minimal -> normal -> verbose -> minimal', () => {
    expect(nextVerbosity('minimal')).toBe('normal');
    expect(nextVerbosity('normal')).toBe('verbose');
    expect(nextVerbosity('verbose')).toBe('minimal');
  });

  it('is a genuine 3-cycle — three presses return to the start', () => {
    let level: 'minimal' | 'normal' | 'verbose' = 'minimal';
    for (let i = 0; i < 3; i++) level = nextVerbosity(level);
    expect(level).toBe('minimal');
  });
});
