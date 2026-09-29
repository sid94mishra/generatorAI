import { ApiError, describeErrorBody } from '@generatorai/client-core';
import { File, Paths } from 'expo-file-system';
import type { AuthedFetch } from './http';
import type { RunUpload, StagedUpload } from './stageRunUploads';

/** RN multipart accepts file URIs, but its Blob constructor rejects raw bytes (see sendChatPrompt.native). */
export async function stageRunUploads(fetch: AuthedFetch, files: RunUpload[]): Promise<StagedUpload[]> {
  if (!files.length) return [];
  const temporary: File[] = [];
  const form = new FormData();
  try {
    for (const upload of files) {
      const file = new File(Paths.cache, `run-upload-${globalThis.crypto.randomUUID()}`);
      temporary.push(file);
      file.write(upload.data);
      // Files go under their category's field name (`skills|agents|prompts`).
      form.append(upload.category, {
        uri: file.uri, name: upload.name, type: upload.mimeType || 'application/octet-stream',
        bytes: () => file.bytes(),
      } as unknown as Blob);
    }
    const path = '/api/workflow-invocations/uploads';
    const response = await fetch(path, { method: 'POST', body: form });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, path, describeErrorBody(body) ?? `HTTP ${response.status}`, body);
    return (body as { uploads: StagedUpload[] }).uploads;
  } finally {
    for (const file of temporary) {
      try { if (file.exists) file.delete(); } catch { /* Do not hide an upload result on cleanup failure. */ }
    }
  }
}
