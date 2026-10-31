import { describe, expect, it } from 'vitest';
import { firstLine, renderToolListing, schemaToType, toolSignature } from '../signatures.js';

describe('schemaToType', () => {
  it('renders primitives, optionals and nested objects', () => {
    expect(
      schemaToType({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'integer' },
          c: { type: 'boolean' },
          d: { type: 'object', properties: { e: { type: 'number' } }, required: ['e'] },
        },
        required: ['a'],
      }),
    ).toBe('{a: string; b?: number; c?: boolean; d?: {e: number}}');
  });

  it('renders enums, consts, unions, nullables and arrays', () => {
    expect(schemaToType({ enum: ['x', 'y', 1] })).toBe('"x" | "y" | 1');
    expect(schemaToType({ const: 'only' })).toBe('"only"');
    expect(schemaToType({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe('string | number');
    expect(schemaToType({ type: ['string', 'null'] })).toBe('string | null');
    expect(schemaToType({ type: 'array', items: { type: 'string' } })).toBe('string[]');
    expect(schemaToType({ type: 'array', items: { enum: ['a', 'b'] } })).toBe('("a" | "b")[]');
    expect(schemaToType({ type: 'array' })).toBe('unknown[]');
    expect(schemaToType({ type: 'object', additionalProperties: { type: 'number' } })).toBe('Record<string, number>');
    expect(schemaToType({})).toBe('unknown');
  });

  it('quotes keys that are not identifiers and collapses deep objects', () => {
    expect(schemaToType({ type: 'object', properties: { 'x-y': { type: 'string' } } })).toBe('{"x-y"?: string}');
    const deep = { type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'object', properties: { c: { type: 'string' } } } } } } };
    expect(schemaToType(deep)).toBe('{a?: {b?: object}}');
  });
});

describe('toolSignature', () => {
  it('writes name(args): Promise<unknown>', () => {
    expect(toolSignature('open_page', { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] })).toBe(
      'open_page(args: {url: string}): Promise<unknown>',
    );
    expect(toolSignature('noargs', { type: 'object', properties: {} })).toBe('noargs(args?: object): Promise<unknown>');
    expect(toolSignature('odd-name', undefined)).toBe('["odd-name"](args?: object): Promise<unknown>');
  });

  it('shortens long signatures', () => {
    const properties = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`field${i}`, { type: 'object', properties: { inner: { type: 'string' } } }]),
    );
    const sig = toolSignature('big', { type: 'object', properties }, { maxChars: 200 });
    expect(sig.length).toBeLessThanOrEqual(200);
    expect(sig.endsWith('…}): Promise<unknown>')).toBe(true);
  });
});

describe('renderToolListing', () => {
  it('lists signatures with the first description line and names the overflow', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      name: `t${i}`,
      description: `Tool ${i}.\nSecond line.`,
      parametersSchema: { type: 'object', properties: { q: { type: 'string' } } },
    }));
    const full = renderToolListing(entries);
    expect(full.split('\n')).toHaveLength(5);
    expect(full).toContain('- t0(args: {q?: string}): Promise<unknown> — Tool 0.');
    expect(full).not.toContain('Second line');
    const capped = renderToolListing(entries, 120);
    expect(capped).toMatch(/… and \d+ more .*: .*t4$/);
  });

  it('clips first lines', () => {
    expect(firstLine('x'.repeat(200), 20)).toHaveLength(20);
    expect(firstLine(undefined)).toBe('');
  });
});
