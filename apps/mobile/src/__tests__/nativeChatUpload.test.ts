import { afterEach, describe, expect, it, vi } from 'vitest';
const disk = vi.hoisted(() => ({ files: [] as Array<{ uri: string; data?: Uint8Array; exists: boolean; delete: ReturnType<typeof vi.fn> }> }));
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string;
    data?: Uint8Array;
    exists = false;
    delete = vi.fn(() => { this.exists = false; });
    constructor(root: string, name: string) { this.uri = `${root}/${name}`; disk.files.push(this); }
    write(data: Uint8Array) { this.data = data; this.exists = true; }
    async bytes() { return this.data; }
  },
}));
import { sendChatPrompt } from '../api/sendChatPrompt.native';

afterEach(() => { disk.files.length = 0; vi.unstubAllGlobals(); });
describe('native chat uploads', () => {
  it('uses URI parts with exact binary bytes and retains them until fetch completes', async () => {
    const parts: Array<[string, unknown]> = [];
    vi.stubGlobal('FormData', class { append(name: string, value: unknown) { parts.push([name, value]); } });
    vi.stubGlobal('Blob', class { constructor() { throw new Error('RN does not support byte blobs'); } });
    const bytes = new Uint8Array([0, 255, 128, 42]);
    const fetch = vi.fn(async (_path: string, init?: RequestInit) => {
      expect(disk.files[0]?.data).toEqual(bytes);
      expect(disk.files[0]?.exists).toBe(true);
      expect(init?.headers).toBeUndefined();
      const part = parts.find(([name]) => name === 'attachments')?.[1] as { bytes: () => Promise<Uint8Array> };
      expect(await part.bytes()).toEqual(bytes);
      return Response.json({ sessionId: 's' });
    });
    await sendChatPrompt(fetch, 'chat', { message: 'Review', mode: 'plan' }, [{ name: 'capture.png', data: bytes, mimeType: 'image/png' }]);
    expect(parts).toEqual([['prompt', 'Review'], ['mode', 'plan'], ['attachments', { uri: disk.files[0]?.uri, name: 'capture.png', type: 'image/png', bytes: expect.any(Function) }]]);
    expect(disk.files[0]?.delete).toHaveBeenCalledOnce();
  });
  it('cleans up temporary files and preserves server errors on failure', async () => {
    vi.stubGlobal('FormData', class { append() {} });
    const fetch = vi.fn(async () => Response.json({ error: { message: 'Answer the approval first' } }, { status: 409 }));
    await expect(sendChatPrompt(fetch, 'chat', { message: 'Review' }, [{ name: 'notes.md', data: new Uint8Array([10]) }])).rejects.toMatchObject({ status: 409, message: 'Answer the approval first' });
    expect(disk.files[0]?.delete).toHaveBeenCalledOnce();
  });
  it('sends text-only prompts as JSON without a temporary file', async () => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => Response.json({ sessionId: 's' }));
    await sendChatPrompt(fetch, 'chat', { message: 'hello' }, []);
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toMatchObject({ prompt: 'hello' });
    expect(disk.files).toHaveLength(0);
  });
});
