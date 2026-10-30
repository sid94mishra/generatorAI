import { describe, expect, it } from 'vitest';

import { toSharePayload } from '../../services/native/sharePayload';
import { fileKind, formatSize, shareProblem, shareTarget, textPreview } from './shareModel';

const file = (name: string, size: number | null, mimeType = 'text/plain') => ({ name, size, mimeType, uri: `file:///${name}` });

describe('share sheet model', () => {
  it('describes files the board way', () => {
    expect([fileKind('text/plain'), fileKind('image/png'), fileKind('application/pdf'), fileKind('application/x-thing')]).toEqual(['Plain text', 'Image', 'PDF', 'File']);
    expect([formatSize(120), formatSize(48 * 1024), formatSize(1.25 * 1024 * 1024), formatSize(null)]).toEqual(['120 B', '48 KB', '1.3 MB', null]);
  });

  it('stops Send over the ingest limits, before it is pressed', () => {
    expect(shareProblem(null)).toBe('Nothing to share.');
    expect(shareProblem({ files: [file('a', 1)], at: 0 })).toBeNull();
    expect(shareProblem({ files: Array.from({ length: 6 }, (_, i) => file(`f${i}`, 1)), at: 0 })).toBe('Up to 5 files can be sent at once.');
    expect(shareProblem({ files: [file('big.log', 11 * 1024 * 1024)], at: 0 })).toBe('big.log is larger than 10 MB.');
  });

  it('targets the picked chat or a new one', () => {
    expect(shareTarget('existing', null, {})).toBeNull();
    expect(shareTarget('existing', 'c1', { agentRef: 'x' })).toEqual({ chatId: 'c1' });
    expect(shareTarget('new', 'c1', { agentRef: 'user:a', projectId: null })).toEqual({ newChat: { agentRef: 'user:a' } });
  });

  it('maps the module intent: file paths become file URIs, a link is not repeated as text', () => {
    expect(toSharePayload({ type: 'weburl', text: 'https://x.dev/a', webUrl: 'https://x.dev/a', files: null }, 1)).toEqual({ url: 'https://x.dev/a', files: [], at: 1 });
    expect(
      toSharePayload({ type: 'file', text: null, webUrl: null, files: [{ fileName: 'ci.log', mimeType: 'text/plain', path: '/private/var/group/ci.log', size: 10, width: null, height: null, duration: null }] }, 2),
    ).toEqual({ files: [{ name: 'ci.log', mimeType: 'text/plain', size: 10, uri: 'file:///private/var/group/ci.log' }], at: 2 });
    expect(toSharePayload({ type: null, text: null, webUrl: null, files: null }, 3)).toBeNull();
    expect(textPreview('\n  first line\nsecond')).toBe('first line');
  });
});
