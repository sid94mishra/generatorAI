// ────────────────────────────────────────────────────────────────
// P03 WP-3.5 — the output contract (RV-9, G5 §3.4): strategy choice per
// provider level, extraction order, schema and rule checks, and the
// submit_output tool. Whole-run repair scenarios live in the testkit.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  checkOutputContract,
  chooseStrategies,
  createSubmitOutputTool,
  extractStructured,
  lastJsonBlock,
  type OutputContractInput,
} from '../../src/services/engine/OutputExtractor.js';
import { journalEpoch } from '../../src/services/engine/StageExecutor.js';

const json = (schema?: Record<string, unknown>, extraction: OutputContractInput['extraction'] = 'auto'): OutputContractInput => ({
  format: 'json',
  schema,
  extraction,
  rules: [],
});

describe('chooseStrategies (RV-9)', () => {
  it('orders native → tool → final block by what the provider can do', () => {
    const c = json({ type: 'object' });
    // claude-agent
    expect(chooseStrategies(c, { structuredOutput: 'native', hostTools: 'full' }).strategies).toEqual(['native', 'tool', 'final_json_block']);
    // copilot
    expect(chooseStrategies(c, { structuredOutput: 'tool', hostTools: 'full' }).strategies).toEqual(['tool', 'final_json_block']);
    // opencode, ACP
    expect(chooseStrategies(c, { structuredOutput: 'none', hostTools: 'none' }).strategies).toEqual(['final_json_block']);
    // codex, new thread
    expect(chooseStrategies(c, { structuredOutput: 'native', hostTools: 'start_only' }).strategies).toEqual(['native', 'tool', 'final_json_block']);
  });

  it('a resumed Codex thread cannot reach submit_output: final block, with a warning', () => {
    const r = chooseStrategies(json({ type: 'object' }), { structuredOutput: 'native', hostTools: 'start_only' }, { resumedStartOnly: true });
    expect(r.strategies).toEqual(['native', 'final_json_block']);
    expect(r.warnings[0]).toMatch(/submit_output/);
  });

  it('an explicit extraction the provider lacks falls back to the final block and says so', () => {
    const r = chooseStrategies(json({ type: 'object' }, 'native'), { structuredOutput: 'tool', hostTools: 'full' });
    expect(r).toEqual({ strategies: ['final_json_block'], warnings: [expect.stringMatching(/native/)] });
    expect(chooseStrategies(json(undefined, 'tool'), { structuredOutput: 'none', hostTools: 'full' }).strategies).toEqual(['tool', 'final_json_block']);
  });

  it('a text stage has no structured output', () => {
    expect(chooseStrategies({ format: 'text', extraction: 'auto', rules: [] }, { structuredOutput: 'native', hostTools: 'full' }).strategies).toEqual([]);
  });
});

describe('extraction', () => {
  it('the LAST json block of the LATEST turn wins; an earlier broken block is skipped', () => {
    expect(lastJsonBlock('a\n```json\n{"x":1}\n```\nb\n```json\n{"x":2}\n```')).toEqual({ found: true, value: { x: 2 } });
    expect(lastJsonBlock('```json\n{"x":1}\n```\n```json\n{broken\n```')).toEqual({ found: true, value: { x: 1 } });
    expect(lastJsonBlock('{"bare": true}')).toEqual({ found: true, value: { bare: true } });
    expect(lastJsonBlock('no json here')).toEqual({ found: false });
    const outputs = { native: [], submitted: [], texts: ['```json\n{"v":"old"}\n```', 'repaired:\n```json\n{"v":"new"}\n```'] };
    expect(extractStructured(['final_json_block'], outputs)).toEqual({ value: { v: 'new' }, source: 'final_json_block' });
  });

  it('native beats tool beats the final block', () => {
    const outputs = { native: [{ n: 1 }], submitted: [{ s: 1 }], texts: ['```json\n{"t":1}\n```'] };
    expect(extractStructured(['native', 'tool', 'final_json_block'], outputs).source).toBe('native');
    expect(extractStructured(['tool', 'final_json_block'], outputs).source).toBe('tool');
    expect(extractStructured(['native', 'tool', 'final_json_block'], { ...outputs, native: [] }).value).toEqual({ s: 1 });
  });
});

describe('checkOutputContract', () => {
  const schema = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] };

  it('missing output and schema errors are repairable output_schema failures with ajv paths', async () => {
    const none = await checkOutputContract(json(schema), ['final_json_block'], { native: [], submitted: [], texts: ['prose only'] }, 'prose only', { stageRunId: 's' });
    expect(none).toMatchObject({ ok: false, error: { class: 'repairable', code: 'output_schema' } });
    const bad = await checkOutputContract(json(schema), ['final_json_block'], { native: [], submitted: [], texts: ['```json\n{"n":"x"}\n```'] }, '', { stageRunId: 's' });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.failures[0]).toMatch(/^\/n: /);
    const good = await checkOutputContract(json(schema), ['final_json_block'], { native: [], submitted: [], texts: ['```json\n{"n":3}\n```'] }, '', { stageRunId: 's' });
    expect(good).toEqual({ ok: true, data: { n: 3 }, source: 'final_json_block' });
  });

  it('hard rules run on the given text and fail as validation_rule', async () => {
    const contract: OutputContractInput = { format: 'text', extraction: 'auto', rules: [{ type: 'contains', value: 'DONE' }, { type: 'max_length', value: 10, message: 'too long' }] };
    const r = await checkOutputContract(contract, [], { native: [], submitted: [], texts: [] }, 'not finished yet', { stageRunId: 's' });
    expect(r).toMatchObject({ ok: false, failures: ['Output must contain "DONE"', 'too long'], error: { code: 'validation_rule', class: 'repairable' } });
    expect(await checkOutputContract(contract, [], { native: [], submitted: [], texts: [] }, 'DONE', { stageRunId: 's' })).toEqual({ ok: true });
  });
});

describe('submit_output', () => {
  it('validates as it is called and hands only an accepted value on', async () => {
    const accepted: unknown[] = [];
    const tool = createSubmitOutputTool({ type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] }, (v) => accepted.push(v));
    expect(await tool.handler({ output: { n: 'x' } })).toEqual({ accepted: false, errors: [expect.stringMatching(/^\/n/)] });
    expect(await tool.handler({})).toEqual({ accepted: false, errors: ['`output` is required'] });
    expect(await tool.handler({ output: { n: 2 } })).toEqual({ accepted: true });
    expect(accepted).toEqual([{ n: 2 }]);
  });
});

describe('journalEpoch', () => {
  it('a resume continues the journal of the attempt it resumes; a restart starts its own', () => {
    const attempts = [
      { attemptNo: 1, mode: 'fresh' as const },
      { attemptNo: 2, mode: 'resume' as const },
      { attemptNo: 3, mode: 'restart' as const },
      { attemptNo: 4, mode: 'resume' as const },
      { attemptNo: 5, mode: 'resume' as const },
    ];
    expect([1, 2, 3, 4, 5].map((n) => journalEpoch(attempts, n))).toEqual([1, 1, 3, 3, 3]);
  });
});
