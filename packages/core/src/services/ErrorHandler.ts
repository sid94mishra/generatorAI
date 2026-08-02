// ────────────────────────────────────────────────────────────────
// ErrorHandler — centralized error normalization and surfacing
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import {
  GeneratorAIError,
  ProcessNotFoundError,
  HarnessConnectionError,
  DAGValidationError,
  SessionAllocationError,
  StageExecutionError,
  UnknownError,
} from '@generatorai/shared';
import type { EventBus } from '../events/EventBus.js';

export class ErrorHandler {
  constructor(
    private eventBus: EventBus,
    private logger: ILogger,
  ) {}

  /** Central error handler. All caught errors flow through here. */
  handle(
    error: unknown,
    context: { sessionId?: string; workflowId?: string; workflowRunId?: string; stageRunId?: string },
  ): void {
    const gaiError = this.normalize(error);

    // 1. Log with context
    this.logger.error(
      `[${gaiError.category}:${gaiError.code}] ${gaiError.message}`,
      {
        sessionId: context.sessionId,
        workflowId: context.workflowId,
        workflowRunId: context.workflowRunId,
        stageRunId: context.stageRunId,
        stack: gaiError.stack,
      },
    );

    // 2. Surface to UI via event stream
    if (context.sessionId) {
      this.eventBus.emit(context.sessionId, {
        kind: 'session.error',
        data: {
          sessionId: context.sessionId,
          message: gaiError.message,
          code: gaiError.code,
          category: gaiError.category,
          recoverable: gaiError.recoverable,
        },
      }).catch((emitErr) => {
        this.logger.error('[ErrorHandler] Failed to emit error event', { error: String(emitErr) });
      });
    }

    // 3. Trigger recovery if possible
    if (gaiError.recoverable) {
      this.attemptRecovery(gaiError, context);
    }
  }

  private normalize(error: unknown): GeneratorAIError {
    if (error instanceof GeneratorAIError) return error;

    if (error instanceof Error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return new ProcessNotFoundError(`Process not found: ${error.message}`, error);
      }
      if (nodeError.code === 'ECONNREFUSED') {
        return new HarnessConnectionError(`Connection refused: ${error.message}`, undefined, error);
      }
      // v2: Check for DAG / stage / session errors by message pattern
      if (error.message.includes('cycle') || error.message.includes('DAG')) {
        return new DAGValidationError(error.message);
      }
      if (error.message.includes('session allocation') || error.message.includes('Session allocation')) {
        return new SessionAllocationError(error.message, error);
      }
      if (error.message.includes('stage execution') || error.message.includes('Stage execution')) {
        return new StageExecutionError(error.message, undefined, error);
      }
      return new UnknownError(error.message, error);
    }

    return new UnknownError(String(error));
  }

  private attemptRecovery(
    error: GeneratorAIError,
    _context: { sessionId?: string; workflowRunId?: string; stageRunId?: string },
  ): void {
    switch (error.code) {
      case 'COPILOT_CONNECTION':
        // CopilotAdapter handles this via auto-restart monitoring
        break;
      case 'COPILOT_TIMEOUT':
        // Could queue a retry - handled at StageExecutionService level
        break;
      case 'GIT_ERROR':
        // Log for debugging, user can retry manually
        break;
      case 'DAG_VALIDATION':
        // User must fix definition — no automatic recovery
        break;
      case 'SESSION_ALLOCATION':
        // Retry at service level with backoff
        break;
      case 'STAGE_EXECUTION':
        // StageExecutionService handles retry with exponential backoff
        break;
    }
  }
}
