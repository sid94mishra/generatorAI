import { describe, it, expect } from 'vitest';
import { matchesHostPattern, matchesAnyHostPattern, isLoopbackHost } from '../hostMatcher.js';

describe('matchesHostPattern', () => {
  it('matches an exact host', () => {
    expect(matchesHostPattern('example.com', 'example.com')).toBe(true);
    expect(matchesHostPattern('example.com', 'other.com')).toBe(false);
  });

  it('treats a bare * as allow-all', () => {
    expect(matchesHostPattern('anything.dev', '*')).toBe(true);
  });

  it('matches subdomains and the apex for *.example.com', () => {
    expect(matchesHostPattern('api.example.com', '*.example.com')).toBe(true);
    expect(matchesHostPattern('a.b.example.com', '*.example.com')).toBe(true);
    // The apex is deliberately included — an allowlist of "*.example.com"
    // that rejected example.com itself would surprise every user.
    expect(matchesHostPattern('example.com', '*.example.com')).toBe(true);
  });

  it('does not let a wildcard leak past the dot boundary', () => {
    expect(matchesHostPattern('notexample.com', '*.example.com')).toBe(false);
    expect(matchesHostPattern('example.com.evil.net', '*.example.com')).toBe(false);
    expect(matchesHostPattern('evil.com', '*.example.com')).toBe(false);
  });

  // DNS is case-insensitive. Comparing raw made `*.GitHub.com` match
  // nothing — and since an allowlist that matches nothing blocks
  // everything, the feature looked broken rather than strict.
  it('is case-insensitive on both sides', () => {
    expect(matchesHostPattern('example.com', 'EXAMPLE.COM')).toBe(true);
    expect(matchesHostPattern('EXAMPLE.COM', 'example.com')).toBe(true);
    expect(matchesHostPattern('api.example.com', '*.Example.COM')).toBe(true);
    expect(matchesHostPattern('API.EXAMPLE.COM', '*.example.com')).toBe(true);
  });
});

describe('matchesAnyHostPattern', () => {
  it('allows everything when the list is empty or absent', () => {
    expect(matchesAnyHostPattern('example.com', undefined)).toBe(true);
    expect(matchesAnyHostPattern('example.com', [])).toBe(true);
  });

  it('allows a host matching any one entry', () => {
    expect(matchesAnyHostPattern('api.github.com', ['example.com', '*.github.com'])).toBe(true);
  });

  it('blocks a host matching no entry', () => {
    expect(matchesAnyHostPattern('evil.com', ['example.com', '*.github.com'])).toBe(false);
  });
});

describe('isLoopbackHost', () => {
  it('accepts the usual loopback spellings', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
  });

  it('accepts the whole 127.0.0.0/8 block, not just .1', () => {
    expect(isLoopbackHost('127.0.0.2')).toBe(true);
    expect(isLoopbackHost('127.1.2.3')).toBe(true);
    expect(isLoopbackHost('128.0.0.1')).toBe(false);
  });

  it('ignores a port', () => {
    expect(isLoopbackHost('localhost:3000')).toBe(true);
    expect(isLoopbackHost('127.0.0.1:8443')).toBe(true);
    expect(isLoopbackHost('[::1]:5173')).toBe(true);
  });

  it('accepts a full URL', () => {
    expect(isLoopbackHost('https://localhost:3000/app')).toBe(true);
    expect(isLoopbackHost('https://example.com/')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
  });

  // The reason this helper exists is to gate the self-signed-cert
  // exemption, so a lookalike must not slip through.
  it('rejects hosts that merely look loopback', () => {
    expect(isLoopbackHost('localhost.evil.com')).toBe(false);
    expect(isLoopbackHost('notlocalhost')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('')).toBe(false);
  });
});
