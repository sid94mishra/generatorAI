// AUTO-GENERATED — do not edit. Run `pnpm generate:schemas` to update.
// Schema version: acp@0.2.1
// Source: schemas/acp/acp-schema.json
// CI check: pnpm generate:schemas && git diff --exit-code packages/agent-harness-providers/src/protocol/

/* eslint-disable */
/* W45 — generated ACP protocol types */

/** ACP v0.2.1 initialize request. */
export interface AcpInitializeRequest {
  protocolVersion: string;
  clientInfo: {
    name: string;
    version: string;
  };
  capabilities?: {
    /** ACP v2: always false — terminal/* removed (correction C1). */
    terminal?: false;
    /** ACP v2: always false — fs/* removed (correction C1). */
    fs?: false;
    approval?: boolean;
  };
}

/** ACP v0.2.1 initialize response. */
export interface AcpInitializeResponse {
  protocolVersion: string;
  serverInfo: {
    name: string;
    version: string;
  };
  capabilities?: {
    approval?: boolean;
    streaming?: boolean;
  };
}

/** A turn request (user message). */
export interface AcpTurnRequest {
  messageId: string;
  role: 'user';
  content: string;
  attachments?: AcpAttachment[];
}

/** A streamed chunk from the server. */
export interface AcpTurnChunk {
  messageId: string;
  type: 'text' | 'tool_call' | 'tool_result' | 'usage_update' | 'done' | 'error';
  text?: string;
  toolCall?: AcpToolCall;
  toolResult?: AcpToolResult;
  usageUpdate?: AcpUsageUpdate;
  error?: AcpErrorInfo;
}

/** Request to cancel an in-flight message. Cancellation is a SUCCESS value, not an error. */
export interface AcpCancelRequest {
  messageId: string;
}

/** Response to a cancel request. */
export interface AcpCancelResponse {
  success: boolean;
  reason?: string;
}

/** Approval request sent from server to client before executing a tool. */
export interface AcpApprovalRequest {
  requestId: string;
  toolCall: AcpToolCall;
}

/** Client's approval decision. */
export interface AcpApprovalResponse {
  requestId: string;
  decision: 'allow' | 'deny';
  modifiedInput?: Record<string, unknown>;
}

export interface AcpToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AcpToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface AcpUsageUpdate {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface AcpErrorInfo {
  code: string;
  message: string;
}

export interface AcpAttachment {
  type: 'text' | 'image';
  content: string;
  mimeType?: string;
}

/** ACP protocol version constant. Never negotiate downward from this. */
export const ACP_PROTOCOL_VERSION = '0.2' as const;
