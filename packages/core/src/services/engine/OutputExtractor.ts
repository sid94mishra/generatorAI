// ────────────────────────────────────────────────────────────────
// OutputExtractor — a stage's output contract, checked BEFORE the stage
// completes (P03 WP-3.5, RV-9, G5 §3.4; fixes F-5/F-6/F-7/B-11/W-17).
//
// A `json` stage's structured output comes from the first strategy that
// produced one, in the order the provider's capabilities allow:
//   1. native            the provider constrains the final prompt turn to
//                        the schema (claude-agent `outputFormat`, Codex
//                        `outputSchema`) and returns the value;
//   2. tool              the model called the `submit_output` host tool,
//                        which validates with ajv as it is called;
//   3. final_json_block  the last JSON block of the attempt's prompt-turn
//                        messages (never the whole conversation, B-11).
// Then the value is validated against the schema (ajv, draft 2020-12) and
// the hard rules run on the output text of the prompt turns only (F-6/F-7).
// A failure is `repairable`: the executor sends the specific failures back
// as a repair turn while its repair budget lasts.
// ────────────────────────────────────────────────────────────────

import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import type { ResultValidationRule } from '@generatorai/workflow-spec';
import type { HostToolsLevel, StructuredOutputLevel } from '../../domain/ports/IProviderInstance.js';
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import { classified, type ClassifiedError } from '../../domain/errors/StageError.js';
import { describeRule, evaluateOutputRule, type RuleContext } from './outputRules.js';

export type ExtractionStrategy = 'native' | 'tool' | 'final_json_block';

export interface OutputContractInput {
  format: 'text' | 'json';
  schema?: Record<string, unknown> | undefined;
  extraction: 'auto' | ExtractionStrategy;
  rules: readonly ResultValidationRule[];
}

export interface StrategyChoice {
  strategies: ExtractionStrategy[];
  /** Why a declared or preferred strategy could not be used (emitted as `harness.session_info`). */
  warnings: string[];
}

/**
 * The strategies a stage uses, in order. `resumedStartOnly`: a provider
 * that binds host tools only when a thread starts (Codex) resumed an
 * existing one, so `submit_output` is not reachable (RV-9, C-11).
 */
export function chooseStrategies(
  contract: OutputContractInput,
  levels: { structuredOutput: StructuredOutputLevel; hostTools: HostToolsLevel },
  opts: { resumedStartOnly?: boolean } = {},
): StrategyChoice {
  if (contract.format !== 'json') return { strategies: [], warnings: [] };
  const native = levels.structuredOutput === 'native';
  const tool = levels.hostTools === 'full' || (levels.hostTools === 'start_only' && !opts.resumedStartOnly);
  const warnings: string[] = [];
  if (contract.extraction !== 'auto') {
    const wanted = contract.extraction;
    const available = wanted === 'final_json_block' || (wanted === 'native' && native) || (wanted === 'tool' && tool);
    if (available) return { strategies: wanted === 'final_json_block' ? [wanted] : [wanted, 'final_json_block'], warnings };
    warnings.push(`output.extraction '${wanted}' is not available on this provider; the final JSON block is used instead`);
    return { strategies: ['final_json_block'], warnings };
  }
  const strategies: ExtractionStrategy[] = [];
  if (native) strategies.push('native');
  if (tool) strategies.push('tool');
  else if (levels.hostTools === 'start_only' && opts.resumedStartOnly) {
    warnings.push('submit_output is bound only when a Codex thread starts; this resumed thread uses the final JSON block');
  }
  strategies.push('final_json_block');
  return { strategies, warnings };
}

/** What the attempt's prompt turns produced so far (replayed turns included). */
export interface TurnOutputs {
  /** Native structured outputs returned with turns, oldest first. */
  native: unknown[];
  /** Accepted `submit_output` calls, oldest first. */
  submitted: unknown[];
  /** Assistant texts of the prompt, repair and revision turns, oldest first. */
  texts: string[];
}

const JSON_BLOCK = /```(?:json)?[^\n`]*\n([\s\S]*?)```/g;

/** The last JSON value in a text: its last ```json block, else the whole text when it parses. */
export function lastJsonBlock(text: string): { found: true; value: unknown } | { found: false } {
  const blocks = [...text.matchAll(JSON_BLOCK)].map((m) => m[1] ?? '');
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      return { found: true, value: JSON.parse(blocks[i]!.trim()) };
    } catch {
      /* an earlier block may parse */
    }
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { found: true, value: JSON.parse(trimmed) };
    } catch {
      /* not JSON */
    }
  }
  return { found: false };
}

/** The structured output under the strategies, first one that has a value. */
export function extractStructured(strategies: readonly ExtractionStrategy[], outputs: TurnOutputs): { value?: unknown; source?: ExtractionStrategy } {
  for (const s of strategies) {
    if (s === 'native' && outputs.native.length > 0) return { value: outputs.native[outputs.native.length - 1], source: s };
    if (s === 'tool' && outputs.submitted.length > 0) return { value: outputs.submitted[outputs.submitted.length - 1], source: s };
    if (s === 'final_json_block') {
      for (let i = outputs.texts.length - 1; i >= 0; i--) {
        const hit = lastJsonBlock(outputs.texts[i]!);
        if (hit.found) return { value: hit.value, source: s };
      }
    }
  }
  return {};
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const compiled = new Map<string, ValidateFunction>();

function validatorFor(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema);
  let v = compiled.get(key);
  if (!v) {
    v = ajv.compile(schema);
    compiled.set(key, v);
  }
  return v;
}

/** `/path: message` lines for ajv errors. */
export function schemaErrors(errors: readonly ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || '/'}: ${e.message ?? 'is invalid'}`);
}

/** Validate a value against a JSON Schema; an unusable schema is reported, never thrown. */
export function validateAgainstSchema(schema: Record<string, unknown>, value: unknown): { ok: true } | { ok: false; errors: string[] } {
  try {
    const v = validatorFor(schema);
    return v(value) ? { ok: true } : { ok: false, errors: schemaErrors(v.errors) };
  } catch (err) {
    return { ok: false, errors: [`the output schema is invalid: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

export type ContractResult =
  | { ok: true; data?: unknown; source?: ExtractionStrategy }
  | { ok: false; error: ClassifiedError; failures: string[] };

/**
 * Check the contract: extraction and schema for `json`, then the hard rules
 * on `text` (the prompt turns' output). Failures are `repairable`.
 */
export async function checkOutputContract(
  contract: OutputContractInput,
  strategies: readonly ExtractionStrategy[],
  outputs: TurnOutputs,
  text: string,
  ctx: RuleContext,
): Promise<ContractResult> {
  let data: unknown;
  let source: ExtractionStrategy | undefined;
  if (contract.format === 'json') {
    const hit = extractStructured(strategies, outputs);
    if (!('value' in hit)) {
      const failures = ['No structured output was found in the answer.'];
      return { ok: false, failures, error: classified('output_schema', failures[0]!, { details: { failures } }) };
    }
    data = hit.value;
    source = hit.source;
    if (contract.schema) {
      const r = validateAgainstSchema(contract.schema, data);
      if (!r.ok) {
        return {
          ok: false,
          failures: r.errors,
          error: classified('output_schema', `The output does not match the schema: ${r.errors.join('; ')}`, { details: { failures: r.errors } }),
        };
      }
    }
  }
  const failures: string[] = [];
  const failed: number[] = [];
  for (const [i, rule] of contract.rules.entries()) {
    if (!(await evaluateOutputRule(rule, text, ctx))) {
      failures.push(rule.message ?? describeRule(rule));
      failed.push(i);
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      failures,
      error: classified('validation_rule', `Output rules failed: ${failures.join('; ')}`, { details: { failures, rules: failed } }),
    };
  }
  return { ok: true, ...(contract.format === 'json' ? { data, ...(source ? { source } : {}) } : {}) };
}

/** The repair turn's message: the specific failures and how to resubmit (G5 §3.4). */
export function repairMessage(failures: readonly string[], strategies: readonly ExtractionStrategy[], format: 'text' | 'json'): string {
  const how =
    format !== 'json'
      ? 'Answer again with the complete corrected output.'
      : strategies.includes('tool')
        ? 'Resubmit the complete corrected output by calling submit_output.'
        : 'Answer again with the complete corrected output as a single ```json block.';
  return `Your output does not satisfy this stage's output contract:\n${failures.map((f) => `- ${f}`).join('\n')}\n\n${how}`;
}

export const SUBMIT_OUTPUT_TOOL_NAME = 'submit_output';

/**
 * The `submit_output` host tool (RV-9): validates the value with ajv as it
 * is called, so the model can correct it within the turn; an accepted value
 * is handed to `accept`.
 */
export function createSubmitOutputTool(schema: Record<string, unknown> | undefined, accept: (value: unknown) => void): ToolDefinition {
  return {
    name: SUBMIT_OUTPUT_TOOL_NAME,
    description:
      "Submit this stage's structured output. Call it once your work is done, with the complete output as `output`. " +
      'The value is validated against the stage schema; when it is rejected, fix the listed problems and call it again.',
    parametersSchema: {
      type: 'object',
      properties: { output: schema ?? {} },
      required: ['output'],
      additionalProperties: false,
    },
    // Recording an output writes nothing the user owns.
    skipPermission: true,
    owner: 'workflow-engine',
    handler: async (args) => {
      const value = (args as { output?: unknown }).output;
      if (value === undefined) return { accepted: false, errors: ['`output` is required'] };
      if (schema) {
        const r = validateAgainstSchema(schema, value);
        if (!r.ok) return { accepted: false, errors: r.errors };
      }
      accept(value);
      return { accepted: true };
    },
  };
}
