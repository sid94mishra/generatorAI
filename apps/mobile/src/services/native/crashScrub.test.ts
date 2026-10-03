import { describe, expect, it } from 'vitest';

import { baseName, dsnHost, isValidDsn, scrubEvent, stripQuery, type CrashEvent } from './crashScrub';

describe('crash-report DSN', () => {
  it('accepts Sentry-compatible DSNs and refuses everything else', () => {
    expect(isValidDsn('https://abc123@o1.ingest.sentry.io/4507')).toBe(true);
    expect(isValidDsn(' https://key@glitchtip.example.com/3 ')).toBe(true);
    expect(isValidDsn('https://key@sentry.example.com:9000/sub/12')).toBe(true);
    expect(isValidDsn('http://key@192.168.1.4:8000/1')).toBe(true);
    expect(isValidDsn('')).toBe(false);
    expect(isValidDsn('https://sentry.example.com/1')).toBe(false); // no public key
    expect(isValidDsn('https://key:secret@sentry.example.com/1')).toBe(false); // legacy secret
    expect(isValidDsn('https://key@sentry.example.com/project')).toBe(false);
    expect(isValidDsn('ftp://key@h/1')).toBe(false);
    expect(isValidDsn('not a url')).toBe(false);
    expect(dsnHost('https://key@glitchtip.example.com/3')).toBe('glitchtip.example.com');
    expect(dsnHost('nope')).toBeNull();
  });
});

describe('scrubEvent', () => {
  const event: CrashEvent = {
    event_id: 'e1',
    level: 'fatal',
    platform: 'javascript',
    release: 'dev.generatorai.app@0.1.0',
    message: 'Prompt: deploy to prod with key sk-123',
    user: { id: 'device-1', ip_address: '10.0.0.4' },
    extra: { prompt: 'secret' },
    server_name: 'my-laptop',
    transaction: '/Users/me/project/src/app.ts',
    exception: {
      values: [{
        type: 'TypeError',
        value: "Cannot read 'x' of /Users/me/secret/file.ts",
        mechanism: { type: 'onerror', handled: false },
        stacktrace: { frames: [{ filename: 'app:///Users/me/bundle/index.js?platform=ios', abs_path: '/Users/me/bundle/index.js', function: 'send', lineno: 10, colno: 2, in_app: true, vars: { token: 't' }, context_line: 'const key = "k"' }] },
      }],
    },
    breadcrumbs: [{ type: 'http', category: 'fetch', level: 'info', timestamp: 1, message: 'GET http://10.0.0.4:3100/api/chats?token=x', data: { url: 'http://10.0.0.4:3100' } }],
    request: { url: 'http://10.0.0.4:3100/api/chats?token=x#f', headers: { Authorization: 'DPoP x' }, data: 'body' },
    contexts: { app: { app_version: '0.1.0' }, os: { name: 'iOS' }, device: { model: 'iPhone18,1' }, state: { secret: true }, trace: { id: 1 } },
    tags: { platform: 'ios' },
  };

  it('keeps types, frame names, bases and app / os / device context; drops every text, path and identity', () => {
    const out = scrubEvent(event);
    expect(out.message).toBeUndefined();
    expect(out.user).toBeUndefined();
    expect(out.extra).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.transaction).toBe('app.ts');
    expect(out.exception?.values?.[0]).toEqual({
      type: 'TypeError',
      value: '[redacted]',
      mechanism: { type: 'onerror', handled: false },
      stacktrace: { frames: [{ filename: 'index.js', function: 'send', lineno: 10, colno: 2, in_app: true }] },
    });
    expect(out.breadcrumbs).toEqual([{ type: 'http', category: 'fetch', level: 'info', timestamp: 1 }]);
    expect(out.request).toEqual({ url: 'http://10.0.0.4:3100/api/chats' });
    expect(Object.keys(out.contexts ?? {}).sort()).toEqual(['app', 'device', 'os']);
    expect(out.tags).toEqual({ platform: 'ios' });
    expect(out.release).toBe('dev.generatorai.app@0.1.0');
    expect(JSON.stringify(out)).not.toMatch(/sk-123|secret|token=|\/Users\/me|DPoP|body/);
  });

  it('does not mutate the SDK event and copes with a bare event', () => {
    const before = JSON.stringify(event);
    scrubEvent(event);
    expect(JSON.stringify(event)).toBe(before);
    expect(scrubEvent({ level: 'error' })).toEqual({ level: 'error' });
  });

  it('path helpers', () => {
    expect(baseName('C:\\a\\b\\c.tsx')).toBe('c.tsx');
    expect(baseName('/a/b.js?x=1')).toBe('b.js');
    expect(stripQuery('https://h/p?q=1#f')).toBe('https://h/p');
  });
});
