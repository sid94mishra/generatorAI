import { createApiClient, type AgentMode } from '@generatorai/client-core';
import type { AuthedFetch } from './http';

export interface ChatUpload { name: string; data: Uint8Array; mimeType?: string }
export interface ChatPrompt { message: string; mode?: AgentMode | undefined }

export async function sendChatPrompt(fetch: AuthedFetch, id: string, input: ChatPrompt, files: ChatUpload[]): Promise<unknown> {
  const api = createApiClient(fetch);
  return files.length
    ? api.chats.sendWithAttachments(id, input, files)
    : api.chats.send(id, input);
}
