import { ApiError, createApiClient } from '@generatorai/client-core';
import { File, Paths } from 'expo-file-system';
import type { AuthedFetch } from './http';
import type { ChatPrompt, ChatUpload } from './sendChatPrompt';

/** RN multipart accepts file URIs, but its Blob constructor rejects raw bytes. */
export async function sendChatPrompt(fetch: AuthedFetch, id: string, input: ChatPrompt, files: ChatUpload[]): Promise<unknown> {
  if (!files.length) return createApiClient(fetch).chats.send(id, input);
  const temporary: File[] = [];
  const form = new FormData();
  form.append('prompt', input.message);
  if (input.mode) form.append('mode', input.mode);
  try {
    for (const upload of files) {
      const file = new File(Paths.cache, `chat-upload-${globalThis.crypto.randomUUID()}`);
      temporary.push(file);
      file.write(upload.data);
      // RN fetch consumes `uri`; Expo 57's default fetch consumes `bytes()`.
      // Supply both contracts without constructing RN's unsupported byte Blob.
      form.append('attachments', {
        uri: file.uri, name: upload.name, type: upload.mimeType || 'application/octet-stream',
        bytes: () => file.bytes(),
      } as unknown as Blob);
    }
    const path = `/api/chats/${encodeURIComponent(id)}/prompt`;
    const response = await fetch(path, { method: 'POST', body: form });
    const body = await response.json();
    if (!response.ok) throw new ApiError(response.status, path, body?.error?.message || `HTTP ${response.status}`);
    return body;
  } finally {
    for (const file of temporary) {
      try { if (file.exists) file.delete(); } catch { /* Do not hide a send result on cleanup failure. */ }
    }
  }
}
