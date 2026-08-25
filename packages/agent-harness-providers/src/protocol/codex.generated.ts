// AUTO-GENERATED — do not edit. Run `pnpm generate:schemas` to update.
// Schema version: codex@1.0.0
// Source: schemas/codex/codex-rpc-schema.json (generated from pinned codex binary)
// CI check: pnpm generate:schemas && git diff --exit-code packages/agent-harness-providers/src/protocol/

/* eslint-disable */
/* W45 — generated Codex app-server JSON-RPC protocol types */

/** JSON-RPC 2.0 request envelope. */
export interface CodexJsonRpcRequest<P = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: P;
}

/** JSON-RPC 2.0 response envelope. */
export interface CodexJsonRpcResponse<R = unknown> {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: R;
  error?: CodexJsonRpcError;
}

/** JSON-RPC 2.0 notification (no id — used for streamed turn events). */
export interface CodexJsonRpcNotification<P = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: P;
}

export interface CodexJsonRpcError {
  /**
   * -32001 = rate limited.
   * When received, apply exponential backoff before retrying.
   * W13/W37: treat as a non-fatal recoverable error, not a session failure.
   */
  code: number;
  message: string;
  data?: unknown;
}

// ── session.create ───────────────────────────────────────────────

export interface CodexSessionCreateParams {
  model: string;
  systemPrompt?: string;
  tools?: CodexToolSpec[];
  maxTurns?: number;
}

export interface CodexSessionCreateResult {
  sessionId: string;
}

// ── session.delete ───────────────────────────────────────────────

export interface CodexSessionDeleteParams {
  sessionId: string;
}

// ── turn ─────────────────────────────────────────────────────────

export interface CodexTurnParams {
  sessionId: string;
  input: string;
  attachments?: CodexTurnAttachment[];
}

/** Events delivered as JSON-RPC notifications during a turn. */
export interface CodexTurnEvent {
  type: 'turn.start' | 'token' | 'tool.call' | 'tool.result' | 'turn.end' | 'error';
  sessionId: string;
  token?: string;
  toolCall?: CodexToolCall;
  toolResult?: CodexToolResult;
  /** Present on turn.end. */
  stopReason?: 'end_turn' | 'length' | 'tool_use' | 'cancelled';
  usage?: CodexUsage;
  error?: CodexJsonRpcError;
}

// ── turn.steer ───────────────────────────────────────────────────

export interface CodexTurnSteerParams {
  sessionId: string;
  /**
   * Signal primitive. Maps to ACP cancellation semantics.
   * 'cancel' → emit harness.cancelled (not harness.error).
   */
  signal: 'cancel' | 'continue';
}

// ── model.list ───────────────────────────────────────────────────

export interface CodexModelListResult {
  models: CodexModelInfo[];
}

export interface CodexModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  supportsReasoning?: boolean;
}

// ── Shared types ─────────────────────────────────────────────────

export interface CodexToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CodexToolResult {
  toolCallId: string;
  content?: string;
  isError?: boolean;
}

export interface CodexToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CodexTurnAttachment {
  type: 'image' | 'file';
  base64?: string;
  mimeType?: string;
  filePath?: string;
}

export interface CodexUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Stop reasons that indicate truncation — must fail all tool calls in batch (W13/B1). */
export const CODEX_TRUNCATION_STOP_REASONS = ['length'] as const;

/** JSON-RPC error code for rate limiting. Apply exponential backoff on receipt. */
export const CODEX_RATE_LIMIT_ERROR_CODE = -32001 as const;
