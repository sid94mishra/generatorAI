// ────────────────────────────────────────────────────────────────
// ResultValidator — checks a completed stage's output against the
// stage's `output.rules` (the v2 rule shapes of @generatorai/workflow-spec)
// before the run moves on.
// ────────────────────────────────────────────────────────────────

import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ILogger, StageValidationResult } from '@generatorai/shared';
import { compileSafeRegex, renderTemplate, type ResultValidationRule } from '@generatorai/workflow-spec';
import type { IChatMessageRepository } from '../domain/ports/IRepositories.js';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { IScriptRunner } from '../domain/ports/IScriptRunner.js';
import type { EventBus } from '../events/EventBus.js';

/** The rules of one stage. */
export interface StageRules {
  stageKey: string;
  rules: readonly ResultValidationRule[];
}

/** Default failure text per rule type, used when a rule carries no `message`. */
function describe(rule: ResultValidationRule): string {
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
function extractJson(output: string): unknown {
  try {
    const block = /```(?:json)?\s*(?:output\.json)?\s*\n([\s\S]*?)```/.exec(output);
    if (block?.[1]) return JSON.parse(block[1].trim());
    const raw = /(\{[\s\S]*\}|\[[\s\S]*\])/.exec(output);
    return raw?.[1] ? JSON.parse(raw[1]) : undefined;
  } catch {
    return undefined;
  }
}

export class ResultValidator {
  private readonly ajv = new Ajv2020({ allErrors: false, strict: false });

  constructor(
    private readonly messageRepo: IChatMessageRepository,
    private readonly stageRunRepo: IStageRunRepository,
    private readonly eventBus: EventBus,
    private readonly logger: ILogger,
    private readonly scriptRunner?: IScriptRunner,
  ) {}

  /**
   * Validate stage output after completion.
   * `scope` renders the templated env values of `custom_script` rules
   * (commands and arguments are literals; values reach them only as env).
   */
  async validateStageResult(
    workflowRunId: string,
    stageRunId: string,
    validation: StageRules,
    workspacePath?: string,
    scope: Record<string, unknown> = {},
  ): Promise<StageValidationResult> {
    const stageRun = await this.stageRunRepo.getById(stageRunId);

    // Only THIS stage's turns: in shared-session mode every stage talks
    // through one conversation, and every message the executor persists is
    // tagged with `metadata.stageRunId`.
    const messages = stageRun.sessionId
      ? await this.messageRepo.getBySessionAndStageRunId(stageRun.sessionId, stageRunId)
      : [];
    const assistantOutput = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join('\n');

    const failures: string[] = [];
    for (const rule of validation.rules) {
      const passed = await this.evaluateRule(rule, assistantOutput, workspacePath, stageRunId, scope);
      if (!passed) failures.push(rule.message ?? describe(rule));
    }

    const result: StageValidationResult = {
      stageKey: validation.stageKey,
      stageName: stageRun.name,
      passed: failures.length === 0,
      failures,
    };

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.stage_validation',
      data: {
        workflowRunId,
        stageRunId,
        stageName: stageRun.name,
        passed: result.passed,
        failures,
      },
    });

    if (!result.passed) {
      this.logger.warn(`[ResultValidator] Stage "${stageRun.name}" validation failed: ${failures.join('; ')}`);
    }
    return result;
  }

  // ── Private ──

  private async evaluateRule(
    rule: ResultValidationRule,
    output: string,
    workspacePath: string | undefined,
    stageRunId: string,
    scope: Record<string, unknown>,
  ): Promise<boolean> {
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
          this.logger.warn(`[ResultValidator] regex rule has an unsupported pattern (${compiled.error.message}); rule marked as failed`);
          return false;
        }
        return compiled.regex.test(output);
      }

      case 'custom_script': {
        if (!this.scriptRunner) {
          this.logger.warn('[ResultValidator] custom_script validation requires a scriptRunner; rule marked as failed');
          return false;
        }
        const env: Record<string, string> = {};
        for (const [name, value] of Object.entries(rule.env ?? {})) {
          const rendered = renderTemplate(value, scope);
          env[name] = rendered.ok ? rendered.text : value;
        }
        try {
          // Stage output via STAGE_OUTPUT (truncated to 32 KB).
          const result = await this.scriptRunner.run(rule.command, [...rule.args], {
            cwd: workspacePath ?? process.cwd(),
            env: {
              ...env,
              STAGE_OUTPUT: output.length > 32768 ? output.slice(0, 32768) : output,
              STAGE_RUN_ID: stageRunId,
              VALIDATION_RULE_MESSAGE: rule.message ?? describe(rule),
            },
            timeout: rule.timeoutMs,
          });
          if (result.exitCode === 0) return true;
          this.logger.info(
            `[ResultValidator] custom_script validation failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
          );
          return false;
        } catch (err) {
          this.logger.warn(`[ResultValidator] custom_script execution error: ${err instanceof Error ? err.message : String(err)}`);
          return false;
        }
      }

      case 'json_schema': {
        const parsed = extractJson(output);
        if (parsed === undefined) return false;
        try {
          const valid = this.ajv.validate(rule.schema, parsed);
          if (!valid) {
            this.logger.info(`[ResultValidator] json_schema validation failed: ${this.ajv.errorsText(this.ajv.errors)}`);
          }
          return valid;
        } catch (err) {
          this.logger.warn(`[ResultValidator] json_schema rule has an invalid schema (${err instanceof Error ? err.message : String(err)}); rule marked as failed`);
          return false;
        }
      }
    }
  }
}
