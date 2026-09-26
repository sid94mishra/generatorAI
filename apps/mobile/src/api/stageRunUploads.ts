import { createAdminApi, type InvocationUploadCategory } from '@generatorai/client-core';
import type { AuthedFetch } from './http';

/** One file a run start stages before invoking. */
export interface RunUpload { category: InvocationUploadCategory; name: string; data: Uint8Array; mimeType?: string }
/** What `POST /workflow-invocations/uploads` staged: the ids go into the invocation's `uploads`. */
export interface StagedUpload { uploadId: string; category: InvocationUploadCategory; name: string }

/** Stages run files (TTL 1 h) through `workflows.uploads`. */
export async function stageRunUploads(fetch: AuthedFetch, files: RunUpload[]): Promise<StagedUpload[]> {
  if (!files.length) return [];
  return (await createAdminApi(fetch).workflows.uploads(files)).uploads;
}
