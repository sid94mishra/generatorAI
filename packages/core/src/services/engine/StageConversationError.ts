// ────────────────────────────────────────────────────────────────
// StageConversationError — why the stage conversation API refused a
// message, a turn stop or a gate answer (P03b WP-3b.1), with the HTTP
// status the routes answer. Chat parity: a busy stage is 409 `STAGE_BUSY`
// like a busy chat's `CHAT_BUSY` (PD-3), an open gate 409
// `INTERACTION_PENDING` like a chat's.
// ────────────────────────────────────────────────────────────────

import { GeneratorAIError } from '@generatorai/shared';

export type StageConversationErrorCode =
  /** Mid-turn, or finishing its attempt (PD-3). */
  | 'STAGE_BUSY'
  /** Parked on a human gate: answer it first. */
  | 'INTERACTION_PENDING'
  /** Not started yet (pending, ready, retrying): there is no conversation to talk to. */
  | 'STAGE_NOT_STARTED'
  /** Failed, skipped or cancelled (or not an agent stage): a re-run is a fork. */
  | 'STAGE_NOT_CONVERSABLE'
  /** A turn stop with no turn in flight. */
  | 'NO_ACTIVE_TURN'
  /** A gate answer for an interaction the stage is not waiting on. */
  | 'INTERACTION_STALE'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  /** No engine in this process (another process owns the database). */
  | 'ENGINE_UNAVAILABLE';

const HTTP_STATUS: Record<StageConversationErrorCode, number> = {
  STAGE_BUSY: 409,
  INTERACTION_PENDING: 409,
  STAGE_NOT_STARTED: 409,
  STAGE_NOT_CONVERSABLE: 409,
  NO_ACTIVE_TURN: 409,
  INTERACTION_STALE: 409,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  ENGINE_UNAVAILABLE: 503,
};

export class StageConversationError extends GeneratorAIError {
  readonly category = 'state' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = true;
  readonly httpStatus: number;
  constructor(
    code: StageConversationErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message, code);
    this.httpStatus = HTTP_STATUS[code];
  }
}
