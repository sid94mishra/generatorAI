// ────────────────────────────────────────────────────────────────
// Review 6.6 — a substituted default must never be silent.
//
// When a stored JSON column does not match what the code expects, the reader
// quietly substitutes a default, and the next unrelated save writes that
// default back — so the real value is gone for good. The hook that would have
// made this visible was passed at 0 of 59 call sites, which is exactly why it
// was never noticed. The DEFAULT is now the observable path.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { safeJsonColumn, setInvalidJsonColumnReporter } from '../src/utils/safeJsonColumn.js';

const schema = z.object({ a: z.string() });

afterEach(() => {
  // Restore a reporter that does not print during the rest of the suite.
  setInvalidJsonColumnReporter(() => {});
});

describe('safeJsonColumn reporting', () => {
  it('reports through the process-wide reporter when no hook is passed', () => {
    const reporter = vi.fn();
    setInvalidJsonColumnReporter(reporter);

    // Every one of the 59 real call sites looks like this — no `onInvalid`.
    const out = safeJsonColumn({ a: 42 }, schema, { fallback: undefined });

    expect(out).toBeUndefined();
    expect(reporter).toHaveBeenCalledTimes(1);
    const [, rawValue] = reporter.mock.calls[0]!;
    // The raw value travels with the report, so the operator can see what was
    // about to be thrown away.
    expect(rawValue).toEqual({ a: 42 });
  });

  it("prefers a call site's own hook when it has something more specific to say", () => {
    const processWide = vi.fn();
    const local = vi.fn();
    setInvalidJsonColumnReporter(processWide);

    safeJsonColumn({ a: 42 }, schema, { fallback: undefined, onInvalid: local });

    expect(local).toHaveBeenCalledTimes(1);
    expect(processWide).not.toHaveBeenCalled();
  });

  it('stays quiet for a valid value and for null', () => {
    const reporter = vi.fn();
    setInvalidJsonColumnReporter(reporter);

    expect(safeJsonColumn({ a: 'ok' }, schema)).toEqual({ a: 'ok' });
    expect(safeJsonColumn(null, schema, { fallback: undefined })).toBeUndefined();
    expect(reporter).not.toHaveBeenCalled();
  });
});
