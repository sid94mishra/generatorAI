import { expect, it, vi } from 'vitest';
import { createApiClient } from '../client.js';
import { artifactDownloadName } from '../artifactDownload.js';
it('downloads bytes without Buffer and decodes a safe native filename', async () => {
  const bytes = new Uint8Array([0, 255, 137, 80]);
  const fetch = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'image/png', 'content-disposition': "attachment; filename*=UTF-8''..%2Fdiagram%20%E2%9C%93.png" } }));
  expect(await createApiClient(fetch).artifacts.download('id/a')).toEqual({ bytes, mimeType: 'image/png', name: 'diagram ✓.png' });
  expect(fetch).toHaveBeenCalledWith('/api/artifacts/id%2Fa/download', undefined);
});
it('retains server errors and handles malformed or missing filename headers', async () => {
  await expect(createApiClient(async () => new Response('{"error":{"message":"No file access"}}', { status: 403 })).artifacts.download('id')).rejects.toMatchObject({ status: 403, message: 'No file access' });
  expect(artifactDownloadName('attachment; filename="../a.txt"', 'id')).toBe('a.txt');
  expect(artifactDownloadName("attachment; filename*=UTF-8''%GG", 'id')).toBe('id');
  expect(artifactDownloadName('attachment; filename=".."', 'id')).toBe('id');
});
