import { describe, expect, it } from 'vitest';
import { dropOptionalNulls, toStrictSchema } from '../strictSchema.js';

// The stock fix-review-loop triage and fix schemas: an open object with an optional property, and nested
// objects whose `note` is optional — both rejected by OpenAI strict mode as they stand.
const triage = { type: 'object', required: ['summary', 'plan'], properties: { summary: { type: 'string' }, plan: { type: 'array', items: { type: 'string' } }, files: { type: 'array', items: { type: 'string' } } } };
const fix = {
  type: 'object',
  required: ['changes', 'addressed'],
  properties: {
    changes: { type: 'string' },
    addressed: {
      type: 'array',
      items: { type: 'object', required: ['id', 'resolution'], properties: { id: { type: 'string' }, resolution: { enum: ['fixed', 'wontfix'] }, note: { type: 'string' } } },
    },
  },
};

describe('Codex strict structured output', () => {
  it('closes every object, requires every property and lets the optional ones be null', () => {
    expect(toStrictSchema(triage)).toEqual({
      type: 'object',
      required: ['summary', 'plan', 'files'],
      additionalProperties: false,
      properties: { summary: { type: 'string' }, plan: { type: 'array', items: { type: 'string' } }, files: { type: ['array', 'null'], items: { type: 'string' } } },
    });
    const item = ((toStrictSchema(fix) as { properties: { addressed: { items: Record<string, unknown> } } }).properties.addressed.items);
    expect(item).toMatchObject({ additionalProperties: false, required: ['id', 'resolution', 'note'] });
    expect((item['properties'] as Record<string, unknown>)['note']).toEqual({ type: ['string', 'null'] });
  });

  it('makes an optional enum-only property nullable, and an untyped one an anyOf with null; oneOf becomes anyOf', () => {
    const s = toStrictSchema({ type: 'object', properties: { r: { enum: ['a', 'b'] }, x: { description: 'free' }, u: { oneOf: [{ type: 'string' }, { type: 'number' }] } } }) as { properties: Record<string, unknown> };
    expect(s.properties['r']).toEqual({ enum: ['a', 'b', null] });
    expect(s.properties['x']).toEqual({ anyOf: [{ description: 'free' }, { type: 'null' }] });
    expect(s.properties['u']).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] });
  });

  it('drops the nulls strict mode put in optional places, keeping required nulls and nested values', () => {
    expect(dropOptionalNulls({ summary: 's', plan: [], files: null }, triage)).toEqual({ summary: 's', plan: [] });
    expect(dropOptionalNulls({ changes: 'c', addressed: [{ id: '1', resolution: 'fixed', note: null }] }, fix)).toEqual({
      changes: 'c',
      addressed: [{ id: '1', resolution: 'fixed' }],
    });
  });
});
