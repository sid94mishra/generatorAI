import { beforeEach, describe, expect, it } from 'vitest';

import {
  SELECTION_TTL_MS,
  _resetTerminalFocusForTests,
  currentTerminalSelection,
  forgetTerminal,
  noteActiveTerminal,
  noteTerminalSelection,
  pickCaptureSession,
} from '../terminalFocus';

describe('terminalFocus', () => {
  beforeEach(() => _resetTerminalFocusForTests());

  it('prefers the last-viewed shell while it is alive', () => {
    expect(pickCaptureSession('w', ['a', 'b'])).toBe('a');
    noteActiveTerminal('w', 'b');
    expect(pickCaptureSession('w', ['a', 'b'])).toBe('b');
    expect(pickCaptureSession('w', ['a'])).toBe('a');
    expect(pickCaptureSession('other', [])).toBeNull();
  });

  it('keeps a selection per workspace, clears it on empty and expires it', () => {
    noteTerminalSelection('w', 'a', 'hello', 1_000);
    expect(currentTerminalSelection('w', 1_000)).toBe('hello');
    expect(currentTerminalSelection('x', 1_000)).toBeNull();
    expect(currentTerminalSelection('w', 1_000 + SELECTION_TTL_MS + 1)).toBeNull();

    // An empty report from ANOTHER shell does not clear this one's selection.
    noteTerminalSelection('w', 'b', '', 1_000);
    expect(currentTerminalSelection('w', 1_000)).toBe('hello');
    noteTerminalSelection('w', 'a', '   ', 1_000);
    expect(currentTerminalSelection('w', 1_000)).toBeNull();
  });

  it('forgets a killed shell', () => {
    noteActiveTerminal('w', 'a');
    noteTerminalSelection('w', 'a', 'sel', 5);
    forgetTerminal('w', 'a');
    expect(currentTerminalSelection('w', 5)).toBeNull();
    expect(pickCaptureSession('w', ['b'])).toBe('b');
  });
});
