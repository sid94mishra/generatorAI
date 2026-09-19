// The shell's close/quit guard reads one boolean. These pin the only thing
// that matters about it: it starts false (so a clean window closes without a
// prompt) and it is the renderer's answer, not an accumulating flag.

import { beforeEach, describe, expect, it } from 'vitest';
import { hasUnsavedWork, setUnsavedWork } from '../unsaved-work';

describe('unsaved-work flag', () => {
  beforeEach(() => setUnsavedWork(false));

  it('defaults to false so an untouched window closes without asking', () => {
    expect(hasUnsavedWork()).toBe(false);
  });

  it('follows the renderer in both directions', () => {
    setUnsavedWork(true);
    expect(hasUnsavedWork()).toBe(true);
    setUnsavedWork(false);
    expect(hasUnsavedWork()).toBe(false);
  });
});
