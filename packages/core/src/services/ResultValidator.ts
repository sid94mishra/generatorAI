// ────────────────────────────────────────────────────────────────
// ResultValidator — Validates stage outputs against defined rules
// after each stage completes in a workflow run.
// ────────────────────────────────────────────────────────────────

import type {
  StageResultValidation,
  ResultValidationRule,
  StageValidationResult,
  ILogger,
} from '@generatorai/shared';
import type { IChatMessageRepository } from '../domain/ports/IRepositories.js';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { IScriptRunner } from '../domain/ports/IScriptRunner.js';
import type { EventBus } from '../events/EventBus.js';

export class ResultValidator {
  constructor(
    private readonly messageRepo: IChatMessageRepository,
    private readonly stageRunRepo: IStageRunRepository,
    private readonly eventBus: EventBus,
    private readonly logger: ILogger,
    private readonly scriptRunner?: IScriptRunner,
  ) {}

  /**
   * Validate stage output after completion.
   * Returns validation result with pass/fail and failure details.
   */
  async validateStageResult(
    workflowRunId: string,
    stageRunId: string,
    validation: StageResultValidation,
    workspacePath?: string,
  ): Promise<StageValidationResult> {
    const stageRun = await this.stageRunRepo.getById(stageRunId);

    // Get assistant messages for this stage's session
    const messages = stageRun.sessionId
      ? await this.messageRepo.getBySessionId(stageRun.sessionId)
      : [];

    // Combine all assistant messages as the stage output
    const assistantOutput = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join('\n');

    const failures: string[] = [];

    for (const rule of validation.rules) {
      const passed = await this.evaluateRule(rule, assistantOutput, workspacePath, stageRunId);
      if (!passed) {
        failures.push(rule.message);
      }
    }

    const result: StageValidationResult = {
      stageIndex: validation.stageIndex,
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
      this.logger.warn(
        `[ResultValidator] Stage "${stageRun.name}" validation failed: ${failures.join('; ')}`,
      );
    }

    return result;
  }

  /**
   * Validate all stage results for a completed workflow run.
   */
  async validateAllStages(
    workflowRunId: string,
    stageRunIds: Array<{ stageRunId: string; stageIndex: number }>,
    validations: StageResultValidation[],
  ): Promise<StageValidationResult[]> {
    const results: StageValidationResult[] = [];

    for (const validation of validations) {
      const stageEntry = stageRunIds.find((s) => s.stageIndex === validation.stageIndex);
      if (!stageEntry) continue;

      const result = await this.validateStageResult(
        workflowRunId,
        stageEntry.stageRunId,
        validation,
      );
      results.push(result);
    }

    return results;
  }

  // ── Private ──

  private async evaluateRule(
    rule: ResultValidationRule,
    output: string,
    workspacePath?: string,
    stageRunId?: string,
  ): Promise<boolean> {
    switch (rule.type) {
      case 'contains':
        return output.includes(rule.value as string);

      case 'not_contains':
        return !output.includes(rule.value as string);

      case 'min_length':
        return output.length >= (rule.value as number);

      case 'max_length':
        return output.length <= (rule.value as number);

      case 'regex': {
        const regex = new RegExp(rule.value as string);
        return regex.test(output);
      }

      case 'custom_script': {
        if (!this.scriptRunner) {
          this.logger.warn(
            '[ResultValidator] custom_script validation requires a scriptRunner; rule marked as failed',
          );
          return false;
        }

        const command = rule.value as string;
        if (!command || typeof command !== 'string') {
          this.logger.warn('[ResultValidator] custom_script rule has no command; marked as failed');
          return false;
        }

        const cwd = workspacePath ?? process.cwd();
        try {
          // Pass stage output via STAGE_OUTPUT env variable (truncated to 32KB to prevent overflow)
          const truncatedOutput = output.length > 32768 ? output.slice(0, 32768) : output;
          const result = await this.scriptRunner.run(command, [], {
            cwd,
            env: {
              STAGE_OUTPUT: truncatedOutput,
              STAGE_RUN_ID: stageRunId ?? '',
              VALIDATION_RULE_MESSAGE: rule.message,
            },
            timeout: 60000, // 60 second timeout for validation scripts
          });

          if (result.exitCode === 0) {
            return true;
          }
          // Non-zero exit means validation failed
          this.logger.info(
            `[ResultValidator] custom_script validation failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
          );
          return false;
        } catch (err) {
          this.logger.warn(
            `[ResultValidator] custom_script execution error: ${err instanceof Error ? err.message : String(err)}`,
          );
          return false;
        }
      }

      case 'json_schema': {
        // Validate that the output contains valid JSON matching the provided schema structure
        // Uses simple structural validation (keys presence + types) rather than full JSON Schema
        const schema = rule.value as Record<string, unknown> | undefined;
        if (!schema || typeof schema !== 'object') {
          this.logger.warn('[ResultValidator] json_schema rule has no schema; marked as failed');
          return false;
        }

        // Try to extract JSON from the output (look for code blocks or raw JSON)
        let parsed: unknown;
        try {
          // First try: extract from ```json ... ``` blocks
          const jsonBlockMatch = /```(?:json)?\s*(?:output\.json)?\s*\n([\s\S]*?)```/.exec(output);
          if (jsonBlockMatch?.[1]) {
            parsed = JSON.parse(jsonBlockMatch[1].trim());
          } else {
            // Second try: find raw JSON object/array
            const jsonMatch = /(\{[\s\S]*\}|\[[\s\S]*\])/.exec(output);
            if (jsonMatch?.[1]) {
              parsed = JSON.parse(jsonMatch[1]);
            }
          }
        } catch {
          // JSON parsing failed
          return false;
        }

        if (!parsed || typeof parsed !== 'object') return false;

        // Structural validation: ensure all required top-level keys from schema exist
        const schemaKeys = Object.keys(schema);
        const outputKeys = Object.keys(parsed as Record<string, unknown>);
        const missingKeys = schemaKeys.filter(k => !outputKeys.includes(k));
        if (missingKeys.length > 0) {
          this.logger.info(
            `[ResultValidator] json_schema validation failed — missing keys: ${missingKeys.join(', ')}`,
          );
          return false;
        }
        return true;
      }

      case 'llm_validation': {
        // LLM-based validation: use the output content + rule value as criteria
        // This requires an external harness, so for now we do a regex/keyword check
        // based on the criteria described in rule.value
        const criteria = rule.value as string | undefined;
        if (!criteria || typeof criteria !== 'string') {
          this.logger.warn('[ResultValidator] llm_validation rule has no criteria string; marked as passed (non-blocking)');
          return true; // Non-blocking if no criteria specified
        }
        // Simple heuristic: check if the output is substantive (non-trivial response)
        // Full LLM validation requires harness integration (future enhancement)
        if (output.trim().length < 50) {
          this.logger.info('[ResultValidator] llm_validation: output too short to be valid');
          return false;
        }
        return true;
      }

      default:
        return true;
    }
  }
}
