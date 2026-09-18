import { describe, expect, it } from 'vitest';

import {
  MAX_DRAFT_CAPTURE_CHARS,
  captureDestination,
  captureToAttachment,
  formatPageText,
  formatTerminalLines,
  fullFrameClip,
  insertCaptureIntoDraft,
  pageCaptureName,
  plainTextFromPty,
  terminalCaptureName,
  terminalScrollbackPath,
  utf8ByteLength,
} from '../captures';
import { validateAttachment } from '../attachmentPolicy';

describe('terminal captures', () => {
  it('trims padded VT rows and blank screen below the prompt', () => {
    expect(formatTerminalLines(['', '$ ls   ', 'a  b', '', '   ', ''])).toBe('$ ls\na  b');
    expect(formatTerminalLines([])).toBe('');
  });

  it('builds the scrollback path with a clamped tail', () => {
    expect(terminalScrollbackPath('ws 1', 'sid', 50)).toBe(
      '/api/workspaces/ws%201/terminals/sid/scrollback?format=text&tailLines=50',
    );
    expect(terminalScrollbackPath('w', 's', 0)).toContain('tailLines=1');
    expect(terminalScrollbackPath('w', 's', 1e9)).toContain('tailLines=5000');
  });

  it('names captures the way web does', () => {
    expect(terminalCaptureName('selection', 42)).toBe('terminal-selection-42.txt');
    expect(terminalCaptureName('output', 7)).toBe('terminal-output-7.txt');
  });

  it('turns raw PTY bytes into the last N readable lines', () => {
    const raw =
      '\x1b]0;user@host: ~\x07\x1b[1;32muser\x1b[0m$ build\r\n' +
      'progress 10%\rprogress 100%\r\n' +
      'line a\r\nline b\r\n\x1b(B\x1b[?2004h$ ';
    expect(plainTextFromPty(raw, 200)).toEqual(['user$ build', 'progress 100%', 'line a', 'line b', '$']);
    expect(plainTextFromPty(raw, 2)).toEqual(['line b', '$']);
    expect(plainTextFromPty('\x1b[2J', 10)).toEqual([]);
  });
});

describe('browser captures', () => {
  it('clips the full viewport, with a fallback before one is known', () => {
    expect(fullFrameClip({ width: 1440.4, height: 900 })).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
    expect(fullFrameClip(null)).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
    expect(fullFrameClip({ width: 0, height: -1 })).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
  });

  it('formats read-page output as markdown with the tree fenced', () => {
    const md = formatPageText({ url: 'https://x.dev/a', title: ' Docs ', snapshot: '- heading "Hi"\n' });
    expect(md).toContain('# Docs');
    expect(md).toContain('URL: https://x.dev/a');
    expect(md).toContain('```\n- heading "Hi"\n```');
    expect(formatPageText({})).toContain('# Untitled page');
  });

  it('names page captures by host', () => {
    expect(pageCaptureName('https://docs.example.com:8080/x', 'text', 5)).toBe('page-docs-example-com-5.md');
    expect(pageCaptureName(null, 'screenshot', 5)).toBe('capture-page-5.png');
  });
});

describe('captureToAttachment', () => {
  it('makes a text capture an inline-text chip the policy accepts', () => {
    const a = captureToAttachment(
      { source: 'terminal', kind: 'text', name: 't.txt', mimeType: 'text/plain', text: 'héllo', label: 'Terminal' },
      1,
    );
    expect(a).toMatchObject({ kind: 'capture', name: 't.txt', mimeType: 'text/plain', text: 'héllo', uri: '', size: 6 });
    expect(validateAttachment(a, [])).toEqual({ ok: true });
  });

  it('makes a screenshot a data-URI chip with its decoded size and a preview', () => {
    const a = captureToAttachment(
      { source: 'browser', kind: 'image', name: 'c.png', mimeType: 'image/png', base64: 'AAAA', label: 'Screenshot' },
      1,
    );
    expect(a.uri).toBe('data:image/png;base64,AAAA');
    expect(a.previewUri).toBe(a.uri);
    expect(a.size).toBe(3);
    expect(a.kind).toBe('capture');
  });

  it('gives every capture a unique id', () => {
    const input = { source: 'terminal', kind: 'text', name: 'x', mimeType: 'text/plain', text: 'x', label: 'x' } as const;
    expect(captureToAttachment(input, 1).id).not.toBe(captureToAttachment(input, 1).id);
  });
});

describe('draft fallback', () => {
  it('routes by permission and capture kind', () => {
    expect(captureDestination({ kind: 'image' }, true)).toBe('attach');
    expect(captureDestination({ kind: 'text' }, false)).toBe('draft');
    expect(captureDestination({ kind: 'image' }, false)).toBe('refuse');
  });

  it('appends a fenced block after the typed text', () => {
    const out = insertCaptureIntoDraft('why does this fail?', { label: 'Terminal output', text: 'Error: x' });
    expect(out.text).toBe('why does this fail?\n\nTerminal output:\n```\nError: x\n```\n');
    expect(out.caret).toBe(out.text.length);
    expect(insertCaptureIntoDraft('', { label: 'L', text: 't' }).text).toBe('L:\n```\nt\n```\n');
  });

  it('uses a fence longer than any backtick run inside', () => {
    const out = insertCaptureIntoDraft('', { label: 'L', text: 'a ```` b' });
    expect(out.text).toContain('`````\na ```` b\n`````');
  });

  it('keeps the tail of an oversized capture and says so', () => {
    const text = `${'x'.repeat(10)}\n${'y'.repeat(MAX_DRAFT_CAPTURE_CHARS + 50)}\nlast`;
    const out = insertCaptureIntoDraft('', { label: 'Log', text });
    expect(out.truncated).toBe(true);
    expect(out.text.startsWith('Log (last part):')).toBe(true);
    expect(out.text).toContain('last');
    expect(out.text.length).toBeLessThan(MAX_DRAFT_CAPTURE_CHARS + 100);
  });

  it('counts UTF-8 bytes', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });
});
