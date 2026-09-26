import { createApiClient, type StageMessageResult } from '@generatorai/client-core';
import type { AuthedFetch } from './http';
import type { ChatPrompt, ChatUpload } from './sendChatPrompt';

/**
 * An operator message to a workflow stage (the stage conversation API):
 * queued between turns, an amendment of a completed stage, a retry of a
 * paused one. JSON without files, multipart with them — the chat's send,
 * pointed at the stage.
 */
export async function sendStageMessage(
  fetch: AuthedFetch,
  runId: string,
  instanceId: string,
  input: ChatPrompt,
  files: ChatUpload[],
): Promise<StageMessageResult> {
  const api = createApiClient(fetch);
  return files.length
    ? api.runs.stageMessageWithAttachments(runId, instanceId, input, files)
    : api.runs.stageMessage(runId, instanceId, input);
}
