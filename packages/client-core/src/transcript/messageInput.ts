import type { ChatMessage } from '@generatorai/shared';

/** Only fields consumed by persisted-block derivation; transport dates/ids are irrelevant. */
export type TranscriptMessageInput = Pick<ChatMessage, 'content' | 'metadata'>;

/** Fields used to group turns; wire transports need no synthetic Date/sessionId. */
export type TranscriptTurnMessage = Pick<ChatMessage,
  'id' | 'role' | 'content' | 'metadata' | 'toolName' | 'toolArgs' | 'toolResult'
> & { attachments?: readonly { name: string; path: string; mimeType?: string }[] };
