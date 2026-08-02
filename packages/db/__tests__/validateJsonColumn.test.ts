// ────────────────────────────────────────────────────────────────
// validateJsonColumn tests (DB-03)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validateJsonColumn, JsonColumnValidationError } from '../src/utils/validateJsonColumn.js';
import { stringArray, jsonRecord } from '../src/utils/jsonColumnSchemas.js';

describe('validateJsonColumn (DB-03)', () => {
  it('returns parsed value for a valid payload', () => {
    const v = validateJsonColumn(['a', 'b'], stringArray, { column: 'tags', table: 'chats' });
    expect(v).toEqual(['a', 'b']);
  });

  it('passes null/undefined through unchanged', () => {
    expect(validateJsonColumn(null, stringArray, { column: 'tags' })).toBeNull();
    expect(validateJsonColumn(undefined, stringArray, { column: 'tags' })).toBeUndefined();
  });

  it('throws JsonColumnValidationError on bad shape', () => {
    expect(() =>
      validateJsonColumn(['a', 42, 'c'], stringArray, { column: 'tags', table: 'chats' }),
    ).toThrow(JsonColumnValidationError);
  });

  it('error carries column + table + issues', () => {
    try {
      validateJsonColumn('not-an-object', jsonRecord, { column: 'config', table: 'workflows' });
    } catch (err) {
      expect(err).toBeInstanceOf(JsonColumnValidationError);
      const jce = err as JsonColumnValidationError;
      expect(jce.code).toBe('JSON_COLUMN_VALIDATION');
      expect(jce.column).toBe('config');
      expect(jce.message).toContain('workflows');
      expect(jce.issues).toBeDefined();
    }
  });

  it('supports caller-supplied schema', () => {
    const strict = z.object({ a: z.number(), b: z.string() });
    const v = validateJsonColumn({ a: 1, b: 'x' }, strict, { column: 'payload' });
    expect(v).toEqual({ a: 1, b: 'x' });
    expect(() =>
      validateJsonColumn({ a: 'not-a-number', b: 'x' }, strict, { column: 'payload' }),
    ).toThrow(JsonColumnValidationError);
  });
});
