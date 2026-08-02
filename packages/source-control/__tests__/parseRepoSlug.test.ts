import { describe, it, expect } from 'vitest';
import { parseRepoSlug } from '../src/parseRepoSlug.js';

describe('parseRepoSlug', () => {
  it('parses HTTPS github URLs', () => {
    expect(parseRepoSlug('https://github.com/acme/web.git')).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'web',
    });
    expect(parseRepoSlug('https://github.com/acme/web')).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'web',
    });
  });

  it('parses scp-like SSH URLs', () => {
    expect(parseRepoSlug('git@github.com:acme/web.git')).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'web',
    });
  });

  it('parses ssh:// URLs', () => {
    expect(parseRepoSlug('ssh://git@github.com/acme/web.git')).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'web',
    });
  });

  it('parses enterprise hosts', () => {
    expect(parseRepoSlug('git@ghe.acme.com:team/repo.git')).toEqual({
      host: 'ghe.acme.com',
      owner: 'team',
      repo: 'repo',
    });
  });

  it('returns null for non-repo strings', () => {
    expect(parseRepoSlug('')).toBeNull();
    expect(parseRepoSlug('not a url')).toBeNull();
  });
});
