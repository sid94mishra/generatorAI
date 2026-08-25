// AUTO-GENERATED — do not edit. Run `pnpm generate:schemas` to update.
// Schema version: opencode@1.4.0
// Source: schemas/opencode/openapi.json (GET /doc from running opencode serve)
// CI check: pnpm generate:schemas && git diff --exit-code packages/agent-harness-providers/src/protocol/

/* eslint-disable */
/* W45 — generated OpenCode protocol types */

/** Create a new conversation session. POST /session */
export interface OpenCodeCreateSessionRequest {
  model?: string;
  systemPrompt?: string;
}

export interface OpenCodeSession {
  id: string;
  model?: string;
  createdAt?: string;
}

/** Send a message to a session. POST /session/{sessionId}/message */
export interface OpenCodeSendMessageRequest {
  content: string;
  attachments?: OpenCodeAttachment[];
}

/** SSE event emitted by POST /session/{sessionId}/message */
export interface OpenCodeMessageEvent {
  type:
    | 'message.start'
    | 'message.delta'
    | 'message.stop'
    | 'tool.input'
    | 'tool.output'
    | 'error';
  delta?: string;
  toolCall?: OpenCodeToolCall;
  toolOutput?: OpenCodeToolOutput;
  error?: string;
  stopReason?: 'end_turn' | 'max_tokens' | 'tool_use';
}

export interface OpenCodeToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface OpenCodeToolOutput {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface OpenCodeAttachment {
  type: 'image' | 'file';
  url?: string;
  base64?: string;
  mimeType?: string;
}

export interface OpenCodeModel {
  id: string;
  name: string;
  provider?: string;
  contextLength?: number;
  supportsStreaming?: boolean;
}

/** Default port for opencode serve. Override with OPENCODE_PORT env var. */
export const OPENCODE_DEFAULT_PORT = 4096 as const;

/** Stop reasons that indicate truncation — must fail all tool calls in batch (W13/B1). */
export const OPENCODE_TRUNCATION_STOP_REASONS = ['max_tokens'] as const;
