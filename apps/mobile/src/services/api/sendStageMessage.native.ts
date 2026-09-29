import { createApiClient, type StageMessageResult } from '@generatorai/client-core';
import { File, Paths } from 'expo-file-system';
import type { ApiFetch as AuthedFetch } from '@generatorai/client-core';
import type { ChatPrompt, ChatUpload } from './sendChatPrompt';

/** RN multipart accepts file URIs, but its Blob constructor rejects raw bytes (see sendChatPrompt.native). */
export async function sendStageMessage(
  fetch: AuthedFetch,
  runId: string,
  instanceId: string,
  input: ChatPrompt,
  files: ChatUpload[],
): Promise<StageMessageResult> {
  if (!files.length) return createApiClient(fetch).runs.stageMessage(runId, instanceId, input);
  const temporary: File[] = [];
  const form = new FormData();
  form.append('prompt', input.message);
  if (input.mode) form.append('mode', input.mode);
  try {
    for (const upload of files) {
      const file = new File(Paths.cache, `stage-upload-${globalThis.crypto.randomUUID()}`);
      temporary.push(file);
      file.write(upload.data);
      form.append('attachments', {
        uri: file.uri, name: upload.name, type: upload.mimeType || 'application/octet-stream',
        bytes: () => file.bytes(),
      } as unknown as Blob);
    }
    return createApiClient(fetch).runs.stageMessageMultipart(runId, instanceId, form);
  } finally {
    for (const file of temporary) {
      try { if (file.exists) file.delete(); } catch { /* Do not hide a send result on cleanup failure. */ }
    }
  }
}
