import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { renderFieldsMarkdown, toJSONSchema } from '../src/jsonschema.js';
import { parseGraph } from '../src/index.js';
import { validGraph } from './arbitraries.js';
import { agent, graph } from './fixtures.js';

const schemas = toJSONSchema();
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schemas['workflow.schema.json']!);

describe('generated JSON Schema', () => {
  it('matches the committed files', () => {
    for (const [name, schema] of Object.entries(schemas)) {
      const committed = readFileSync(resolve(import.meta.dirname, '../generated', name), 'utf8').replace(/\r\n/g, '\n');
      expect(committed, `${name} is stale: run pnpm generate:workflow-spec`).toBe(`${JSON.stringify(schema, null, 2)}\n`);
    }
  });

  it('accepts every valid graph, authored and parsed (property)', () => {
    fc.assert(
      fc.property(validGraph, (input) => {
        expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
        expect(validate(JSON.parse(JSON.stringify(parseGraph(input)))), JSON.stringify(validate.errors)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('is strict like the zod schema', () => {
    expect(validate(graph([agent('a', { condition: {} })]))).toBe(false);
    expect(validate({ ...graph([agent('a')]), extra: 1 })).toBe(false);
    expect(validate(graph([agent('Bad Key')]))).toBe(false);
    expect(validate(graph([agent('a')], [], { lifecycle: { preprocessingSteps: [{ name: 'c', config: { type: 'conditional', condition: 'true', thenSteps: [{ name: 'x', config: { type: 'nope' } }] } }] } }))).toBe(false);
  });

  it('carries descriptions', () => {
    const text = JSON.stringify(schemas['workflow.schema.json']);
    expect(text).toContain('Stable stage key, unique per workflow');
    expect(text).toContain('Expression v2');
  });

  it('renders FIELDS.md with the grammar, codes and state tables', () => {
    const md = renderFieldsMarkdown();
    for (const heading of ['## WorkflowGraph', '## Expression v2', '### Functions', '## Validation codes', '## Stage-run state machine', '## InvocationRequest']) {
      expect(md).toContain(heading);
    }
    expect(md).toContain('`count(list, x => condition) → number`');
    expect(md).toContain('| `engine-unsupported` |');
  });
});
