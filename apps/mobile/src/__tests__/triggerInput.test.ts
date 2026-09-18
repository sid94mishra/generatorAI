import { describe, expect, it } from 'vitest';

import {
  checkDataset,
  datasetPlaceholder,
  defaultDatasetOf,
  formatFromFileName,
  schemaFieldsOf,
  schemaFormatOf,
  splitCsvLine,
} from '../components/work/triggerInput';

const SCHEMA = {
  version: 1,
  format: 'csv',
  fields: [
    { name: 'name', type: 'string' },
    { name: 'priority', type: 'string', required: false },
    { type: 'string' },
  ],
};

describe('schema reading', () => {
  it('reads fields with required defaulting to true', () => {
    expect(schemaFieldsOf(SCHEMA)).toEqual([
      { name: 'name', type: 'string', required: true },
      { name: 'priority', type: 'string', required: false },
    ]);
    expect(schemaFieldsOf(undefined)).toEqual([]);
    expect(schemaFormatOf(SCHEMA)).toBe('csv');
    expect(schemaFormatOf({ format: 'xml' })).toBe('json_array');
  });

  it('only offers a usable saved default', () => {
    expect(defaultDatasetOf({ format: 'jsonl', data: '{"a":1}' })).toEqual({ format: 'jsonl', data: '{"a":1}' });
    expect(defaultDatasetOf({ format: 'csv', data: '   ' })).toBeNull();
    expect(defaultDatasetOf(null)).toBeNull();
  });
});

describe('file names', () => {
  it('guesses the format from the extension', () => {
    expect(formatFromFileName('rows.CSV')).toBe('csv');
    expect(formatFromFileName('rows.jsonl')).toBe('jsonl');
    expect(formatFromFileName('rows.json')).toBe('json_array');
    expect(formatFromFileName('rows.txt')).toBeNull();
  });
});

describe('checkDataset', () => {
  const fields = schemaFieldsOf(SCHEMA);

  it('requires text unless a default can stand in', () => {
    expect(checkDataset('csv', '  ', fields).ok).toBe(false);
    expect(checkDataset('csv', '', fields, { allowEmpty: true })).toEqual({ ok: true, rowCount: null, errors: [] });
  });

  it('parses CSV with quoted cells and checks required columns', () => {
    expect(splitCsvLine('a,"b, c","say ""hi"""')).toEqual(['a', 'b, c', 'say "hi"']);
    expect(checkDataset('csv', 'name,priority\napi,high\nweb,low\n', fields)).toEqual({ ok: true, rowCount: 2, errors: [] });
    const missing = checkDataset('csv', 'name,priority\napi,high\n,low', fields);
    expect(missing.ok).toBe(false);
    expect(missing.errors[0]).toContain('Row 2');
  });

  it('rejects malformed JSON and non-array JSON', () => {
    expect(checkDataset('json_array', '[{"name":', fields).errors[0]).toMatch(/Not valid JSON/);
    expect(checkDataset('json_array', '{"name":"a"}', fields).errors[0]).toMatch(/array/);
    expect(checkDataset('json_array', '[{"name":"a"}]', fields)).toMatchObject({ ok: true, rowCount: 1 });
    expect(checkDataset('json_array', '[]', fields)).toMatchObject({ ok: false, rowCount: 0 });
  });

  it('reports the JSONL line that fails', () => {
    expect(checkDataset('jsonl', '{"name":"a"}\nnope', fields).errors[0]).toBe('Line 2 is not valid JSON.');
    expect(checkDataset('jsonl', '{"name":"a"}\n\n{"name":"b"}', fields)).toMatchObject({ ok: true, rowCount: 2 });
  });

  it('builds a placeholder from the schema', () => {
    expect(datasetPlaceholder('csv', fields)).toBe('name,priority\n…,…');
  });
});
