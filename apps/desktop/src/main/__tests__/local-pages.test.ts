import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() } }));

const { isLocalPageUrl, localPageUrl, resolveLocalPage } = await import('../local-pages');

describe('local pages (splash, error, prompt) over gai-local://', () => {
  it('builds page URLs with an optional query', () => {
    expect(localPageUrl('splash.html')).toBe('gai-local://pages/splash.html');
    expect(localPageUrl('error.html', new URLSearchParams({ message: 'Server exited (1)' }))).toBe(
      'gai-local://pages/error.html?message=Server+exited+%281%29',
    );
    expect(isLocalPageUrl(localPageUrl('prompt.html', 'a=1'))).toBe(true);
    expect(isLocalPageUrl('http://127.0.0.1:3100/')).toBe(false);
  });

  it('serves only the allow-listed pages and fonts', () => {
    expect(resolveLocalPage('gai-local://pages/error.html?message=x')).toEqual({ file: 'error.html', contentType: 'text/html; charset=utf-8' });
    expect(resolveLocalPage('gai-local://pages/fonts/jetbrains-mono-latin-wght-normal.woff2')?.contentType).toBe('font/woff2');
    expect(resolveLocalPage('gai-local://pages/icon.png')).toBeNull();
    expect(resolveLocalPage('gai-local://pages/../main/index.js')).toBeNull();
    expect(resolveLocalPage('gai-local://pages/%2e%2e/package.json')).toBeNull();
    expect(resolveLocalPage('gai-local://other/error.html')).toBeNull();
    expect(resolveLocalPage('file:///etc/passwd')).toBeNull();
    expect(resolveLocalPage('not a url')).toBeNull();
  });
});
