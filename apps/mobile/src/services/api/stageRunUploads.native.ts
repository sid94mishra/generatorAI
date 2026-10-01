import { createAdminApi } from '@generatorai/client-core';
import { File, Paths } from 'expo-file-system';
import type { ApiFetch as AuthedFetch } from '@generatorai/client-core';
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
    return (await createAdminApi(fetch).workflows.uploadMultipart(form)).uploads;
  } finally {
    for (const file of temporary) {
      try { if (file.exists) file.delete(); } catch { /* Do not hide an upload result on cleanup failure. */ }
    }
  }
}
