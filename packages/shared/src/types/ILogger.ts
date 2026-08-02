// ────────────────────────────────────────────────────────────────
// ILogger — Port interface for logging
// ────────────────────────────────────────────────────────────────

export interface ILogger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): ILogger;
}
