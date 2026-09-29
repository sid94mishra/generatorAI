import { describe, expect, it, vi } from 'vitest';
import { createApiClient, ApiError } from '../client.js';
import { createAdminApi } from '../admin.js';
import { resourcePaths } from '../resources.js';

describe('caller-built multipart', () => {
  it('retains the FormData identity and lets the transport set its boundary', async () => {
    const fetch = vi.fn(async () => new Response('{"uploads":[]}', { status: 200 }));
    const api = createApiClient(fetch);
    const form = new FormData();
    form.append('prompt', 'Review');
    await api.chats.sendMultipart('c/a', form);
    await api.runs.stageMessageMultipart('r/a', 'i/b', form);
    await createAdminApi(fetch).workflows.uploadMultipart(form);
    expect(fetch.mock.calls).toEqual([
      ['/api/chats/c%2Fa/prompt', { method: 'POST', body: form }],
      ['/api/workflow-runs/r%2Fa/instances/i%2Fb/messages', { method: 'POST', body: form }],
      ['/api/workflow-invocations/uploads', { method: 'POST', body: form }],
    ]);
  });
});

describe('native resource contracts', () => {
  it('clamps terminal lines and encodes identifiers', async () => {
    const fetch = vi.fn(async () => new Response('{"lines":[]}'));
    const { resources } = createApiClient(fetch);
    await resources.terminalLines('ws 1', 'sid', 50);
    expect(fetch).toHaveBeenLastCalledWith('/api/workspaces/ws%201/terminals/sid/scrollback?format=text&tailLines=50', undefined);
    await resources.terminalLines('w', 's', 0);
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('tailLines=1'), undefined);
    await resources.terminalLines('w', 's', 1e9);
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('tailLines=5000'), undefined);
  });

  it('keeps image/PTY bytes intact and carries the response content type', async () => {
    const bytes = new Uint8Array([0, 255, 27, 65]);
    const fetch = vi.fn(async () => new Response(bytes, { headers: { 'Content-Type': 'image/png; charset=binary' } }));
    const { resources } = createApiClient(fetch);
    expect(await resources.computerFrame('w/a', 'f/b')).toEqual({ data: bytes, contentType: 'image/png' });
    expect(fetch).toHaveBeenLastCalledWith('/api/workspaces/w%2Fa/computer/frames/f%2Fb', undefined);
    const clip = { x: 0, y: 0, width: 800, height: 600 };
    await resources.browserCapture('w/a', clip);
    expect(fetch).toHaveBeenLastCalledWith('/api/workspaces/w%2Fa/browser/capture', expect.objectContaining({ method: 'POST', body: JSON.stringify({ clip }) }));
    await resources.terminalBytes('w', 's', 4096);
    expect(fetch).toHaveBeenLastCalledWith('/api/workspaces/w/terminals/s/scrollback?tailBytes=4096', undefined);
  });

  it('retains status and the server reason for binary endpoint failures', async () => {
    const api = createApiClient(async () => new Response('{"error":{"code":"OFFLINE","message":"Browser is not running"}}', { status: 409 }));
    await expect(api.resources.browserScreencast('w', 45, 1)).rejects.toMatchObject({ status: 409, message: 'Browser is not running', body: { error: { code: 'OFFLINE', message: 'Browser is not running' } } });
    await expect(api.resources.browserScreencast('w', 45, 1)).rejects.toBeInstanceOf(ApiError);
  });

  it('normalizes resource paths without interpreting filename query delimiters', () => {
    expect(resourcePaths.browserFile('w/a', '\\shots\\image #1.png')).toBe('/api/workspaces/w%2Fa/browser/files/shots/image%20%231.png');
    expect(resourcePaths.terminalStream('w/a', 's/b')).toBe('/api/workspaces/w%2Fa/terminals/s%2Fb/stream');
    expect(resourcePaths.voiceStream('stt')).toBe('/api/stt/stream');
  });
});
