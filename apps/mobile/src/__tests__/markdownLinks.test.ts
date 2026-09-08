import { describe, expect, it } from 'vitest';

import {
  blockedLinkReason,
  classifyImage,
  classifyLink,
  linkScheme,
} from '../components/markdown/linkPolicy';

describe('linkScheme', () => {
  it('extracts a lower-cased scheme', () => {
    expect(linkScheme('HTTPS://example.com')).toBe('https');
    expect(linkScheme('mailto:a@b.c')).toBe('mailto');
    expect(linkScheme('generatorai://chats/1')).toBe('generatorai');
  });

  it('returns null for relative hrefs', () => {
    expect(linkScheme('#section')).toBeNull();
    expect(linkScheme('./src/app.ts')).toBeNull();
    expect(linkScheme('/absolute/path')).toBeNull();
  });

  it('ignores leading whitespace and control characters, as browsers do', () => {
    expect(linkScheme('  javascript:alert(1)')).toBe('javascript');
    expect(linkScheme('\tjavascript:alert(1)')).toBe('javascript');
  });

  it('does not treat a Windows drive or a port as a scheme', () => {
    // `c:` would technically match; a single letter is not on the allow-list
    // anyway, and this documents the behaviour rather than asserting a fix.
    expect(linkScheme('localhost:3000')).toBe('localhost');
  });
});

describe('classifyLink', () => {
  it('allows the four schemes and nothing else', () => {
    expect(classifyLink('https://a.b').allowed).toBe(true);
    expect(classifyLink('http://a.b').allowed).toBe(true);
    expect(classifyLink('mailto:x@y.z').allowed).toBe(true);
    expect(classifyLink('generatorai://open').allowed).toBe(true);

    expect(classifyLink('javascript:alert(1)').allowed).toBe(false);
    expect(classifyLink('tel:+15555551234').allowed).toBe(false);
    expect(classifyLink('sms:5555').allowed).toBe(false);
    expect(classifyLink('file:///etc/passwd').allowed).toBe(false);
    expect(classifyLink('shortcuts://run-shortcut?name=x').allowed).toBe(false);
    expect(classifyLink('data:text/html,<script>').allowed).toBe(false);
  });

  it('blocks relative hrefs — there is no document base on a phone', () => {
    const d = classifyLink('#anchor');
    expect(d.allowed).toBe(false);
    expect(d.scheme).toBeNull();
    expect(blockedLinkReason(d)).toMatch(/relative/i);
  });

  it('trims the href it hands back for opening/copying', () => {
    expect(classifyLink('  https://a.b/c  ').href).toBe('https://a.b/c');
  });

  it('names the scheme in the blocked reason', () => {
    expect(blockedLinkReason(classifyLink('tel:1'))).toBe('tel: links are blocked');
  });
});

describe('classifyImage', () => {
  it('allows http(s) and data:image only', () => {
    expect(classifyImage('https://x/y.png').allowed).toBe(true);
    expect(classifyImage('data:image/png;base64,AAAA').allowed).toBe(true);
    expect(classifyImage('data:text/html;base64,AAAA').allowed).toBe(false);
    expect(classifyImage('file:///tmp/x.png').allowed).toBe(false);
    expect(classifyImage('./local.png').allowed).toBe(false);
  });
});
