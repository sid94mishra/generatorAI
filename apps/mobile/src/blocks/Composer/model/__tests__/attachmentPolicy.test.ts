import { describe, expect, it } from 'vitest';

import {
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  attachmentKindFor,
  base64ByteLength,
  decodeBase64,
  formatBytes,
  guessMimeType,
  parseDataUri,
  pastedImageName,
  validateAttachment,
} from '../attachmentPolicy';

const MB = 1024 * 1024;

describe('validateAttachment', () => {
  it('accepts an ordinary file', () => {
    expect(validateAttachment({ name: 'a.pdf', mimeType: 'application/pdf', size: 2 * MB }, [])).toEqual({ ok: true });
  });

  it('refuses the sixth attachment — the server multer cap is 5', () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => ({ name: `f${i}`, size: 1 }));
    const verdict = validateAttachment({ name: 'x', mimeType: 'text/plain', size: 1 }, existing);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toMatch(/Up to 5 attachments/);
  });

  it('caps images at 8 MB and files at 10 MB', () => {
    expect(validateAttachment({ name: 'p.png', mimeType: 'image/png', size: MAX_IMAGE_BYTES + 1 }, []).ok).toBe(false);
    expect(validateAttachment({ name: 'p.png', mimeType: 'image/png', size: MAX_IMAGE_BYTES }, []).ok).toBe(true);
    expect(validateAttachment({ name: 'z.zip', mimeType: 'application/zip', size: MAX_FILE_BYTES + 1 }, []).ok).toBe(false);
    expect(validateAttachment({ name: 'z.zip', mimeType: 'application/zip', size: MAX_FILE_BYTES }, []).ok).toBe(true);
  });

  it('names the size and the cap in the refusal', () => {
    const verdict = validateAttachment({ name: 'big.jpg', mimeType: 'image/jpeg', size: 9 * MB }, []);
    expect(!verdict.ok && verdict.reason).toContain('9.0 MB');
    expect(!verdict.ok && verdict.reason).toContain('8.0 MB');
  });

  it('refuses an exact duplicate (same name and size)', () => {
    const verdict = validateAttachment(
      { name: 'a.txt', mimeType: 'text/plain', size: 10 },
      [{ name: 'a.txt', size: 10 }],
    );
    expect(verdict.ok).toBe(false);
  });

  it('checks the count before the size, since the count cannot be fixed by picking differently', () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => ({ name: `f${i}`, size: 1 }));
    const verdict = validateAttachment({ name: 'huge', mimeType: 'image/png', size: 50 * MB }, existing);
    expect(!verdict.ok && verdict.reason).toMatch(/attachments per message/);
  });
});

describe('mime + kind', () => {
  it('trusts a specific reported type', () => {
    expect(guessMimeType('x.bin', 'application/pdf')).toBe('application/pdf');
  });
  it('falls back to the extension for octet-stream or nothing', () => {
    expect(guessMimeType('photo.HEIC', 'application/octet-stream')).toBe('image/heic');
    expect(guessMimeType('notes.md', null)).toBe('text/markdown');
    expect(guessMimeType('weird', null)).toBe('application/octet-stream');
  });
  it('classifies images vs files', () => {
    expect(attachmentKindFor('image/webp')).toBe('image');
    expect(attachmentKindFor('image/svg+xml')).toBe('image');
    expect(attachmentKindFor('text/plain')).toBe('file');
  });
});

describe('formatBytes', () => {
  it('renders sensible units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(300 * 1024)).toBe('300 KB');
    expect(formatBytes(3.25 * MB)).toBe('3.3 MB');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('base64 helpers', () => {
  it('computes byte length without decoding', () => {
    expect(base64ByteLength('aGVsbG8=')).toBe(5); // "hello"
    expect(base64ByteLength('aGk=')).toBe(2);
    expect(base64ByteLength('')).toBe(0);
  });
  it('decodes bytes exactly', () => {
    expect(Array.from(decodeBase64('aGVsbG8='))).toEqual([104, 101, 108, 108, 111]);
    expect(Array.from(decodeBase64('aGk='))).toEqual([104, 105]);
    expect(Array.from(decodeBase64('AAEC'))).toEqual([0, 1, 2]);
  });
  it('parses data URIs and names pasted images like web', () => {
    expect(parseDataUri('data:image/png;base64,AAEC')).toEqual({ mimeType: 'image/png', base64: 'AAEC' });
    expect(parseDataUri('file:///tmp/x.png')).toBeNull();
    expect(pastedImageName('image/jpeg', 123)).toBe('pasted-123.jpg');
    expect(pastedImageName('image/png', 123)).toBe('pasted-123.png');
  });
});
