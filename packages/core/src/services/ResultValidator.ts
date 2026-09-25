// ────────────────────────────────────────────────────────────────
// ResultValidator — checks a completed stage's output against the
// stage's `output.rules` (the v2 rule shapes of @generatorai/workflow-spec)
// before the run moves on.
// ────────────────────────────────────────────────────────────────

import type { ILogger, StageValidationResult } from '@generatorai/shared';
import type { ResultValidationRule } from '@generatorai/workflow-spec';
import type { IChatMessageRepository } from '../domain/ports/IRepositories.js';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { IScriptRunner } from '../domain/ports/IScriptRunner.js';
import type { EventBus } from '../events/EventBus.js';
import { describeRule, evaluateOutputRule } from './engine/outputRules.js';

/** The rules of one stage. */
export interface StageRules {
  stageKey: string;
  rules: readonly ResultValidationRule[];
}

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
      const passed = await evaluateOutputRule(rule, assistantOutput, {
        logger: this.logger,
        scriptRunner: this.scriptRunner,
        workspacePath,
        stageRunId,
        scope,
      });
      if (!passed) failures.push(rule.message ?? describeRule(rule));
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
}
