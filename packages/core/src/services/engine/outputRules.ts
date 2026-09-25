// ────────────────────────────────────────────────────────────────
// The hard output rules of a stage (`output.rules`), evaluated on a text.
//
// Evaluated by the engine's `OutputExtractor` (the output contract). Every rule is bounded: `regex` runs on the linear-time
// engine (RV-21), `custom_script` has its own timeout.
// ────────────────────────────────────────────────────────────────

import { Ajv2020 } from 'ajv/dist/2020.js';
import { compileSafeRegex, renderTemplate, type ResultValidationRule } from '@generatorai/workflow-spec';
import type { ILogger } from '@generatorai/shared';
import type { IScriptRunner } from '../../domain/ports/IScriptRunner.js';

/** Default failure text per rule type, used when a rule carries no `message`. */
export function describeRule(rule: ResultValidationRule): string {
  switch (rule.type) {
    case 'contains':
      return `Output must contain "${rule.value}"`;
    case 'not_contains':
      return `Output must not contain "${rule.value}"`;
    case 'min_length':
      return `Output must be at least ${rule.value} characters`;
    case 'max_length':
      return `Output must be at most ${rule.value} characters`;
    case 'regex':
      return `Output must match /${rule.pattern}/${rule.flags ?? ''}`;
    case 'custom_script':
      return `Validation script '${rule.command}' failed`;
    case 'json_schema':
      return 'Output must be JSON matching the schema';
  }
}

/** The JSON value in a stage output: a ```json block, else the first object/array. */
export function extractJsonValue(output: string): unknown {
  try {
    const block = /```(?:json)?\s*(?:output\.json)?\s*\n([\s\S]*?)```/.exec(output);
    if (block?.[1]) return JSON.parse(block[1].trim());
    const raw = /(\{[\s\S]*\}|\[[\s\S]*\])/.exec(output);
    return raw?.[1] ? JSON.parse(raw[1]) : undefined;
  } catch {
    return undefined;
  }
}

export interface RuleContext {
  logger?: ILogger | undefined;
  scriptRunner?: IScriptRunner | undefined;
  /** The directory a `custom_script` rule runs in. */
  workspacePath?: string | undefined;
  stageRunId: string;
  /** Renders the templated env values of `custom_script` rules. */
  scope?: Record<string, unknown> | undefined;
}

const ajv = new Ajv2020({ allErrors: false, strict: false });

/** Whether `output` satisfies `rule`. Never throws: an unusable rule fails. */
export async function evaluateOutputRule(rule: ResultValidationRule, output: string, ctx: RuleContext): Promise<boolean> {
  const { logger } = ctx;
  switch (rule.type) {
    case 'contains':
      return output.includes(rule.value);
    case 'not_contains':
      return !output.includes(rule.value);
    case 'min_length':
      return output.length >= rule.value;
    case 'max_length':
      return output.length <= rule.value;

    case 'regex': {
      // Linear-time engine: model output cannot trigger catastrophic backtracking (RV-21).
      const compiled = compileSafeRegex(rule.pattern, rule.flags ?? '');
      if (!compiled.ok) {
        logger?.warn(`[outputRules] regex rule has an unsupported pattern (${compiled.error.message}); rule marked as failed`);
        return false;
      }
      return compiled.regex.test(output);
    }

    case 'custom_script': {
      if (!ctx.scriptRunner) {
        logger?.warn('[outputRules] custom_script validation requires a scriptRunner; rule marked as failed');
        return false;
      }
      const env: Record<string, string> = {};
      for (const [name, value] of Object.entries(rule.env ?? {})) {
        const rendered = renderTemplate(value, ctx.scope ?? {});
        env[name] = rendered.ok ? rendered.text : value;
      }
      try {
        // Stage output via STAGE_OUTPUT (truncated to 32 KB).
        const result = await ctx.scriptRunner.run(rule.command, [...rule.args], {
          cwd: ctx.workspacePath ?? process.cwd(),
          env: {
            ...env,
            STAGE_OUTPUT: output.length > 32768 ? output.slice(0, 32768) : output,
            STAGE_RUN_ID: ctx.stageRunId,
            VALIDATION_RULE_MESSAGE: rule.message ?? describeRule(rule),
          },
          timeout: rule.timeoutMs,
        });
        if (result.exitCode === 0) return true;
        logger?.info(`[outputRules] custom_script validation failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
        return false;
      } catch (err) {
        logger?.warn(`[outputRules] custom_script execution error: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    }

    case 'json_schema': {
      const parsed = extractJsonValue(output);
      if (parsed === undefined) return false;
      try {
        const valid = ajv.validate(rule.schema, parsed);
        if (!valid) logger?.info(`[outputRules] json_schema validation failed: ${ajv.errorsText(ajv.errors)}`);
        return valid;
      } catch (err) {
        logger?.warn(`[outputRules] json_schema rule has an invalid schema (${err instanceof Error ? err.message : String(err)}); rule marked as failed`);
        return false;
      }
    }
  }
}
