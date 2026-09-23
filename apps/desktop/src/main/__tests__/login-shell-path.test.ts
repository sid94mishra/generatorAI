// A GUI launch gets a bare PATH; the app has to find the user's real one.
// (Reproduced live: started with `/usr/bin:/bin:/usr/sbin:/sbin`, the app could
// not start its server at all, and a packaged build would lose the Claude CLI,
// node/npm and Homebrew tools.)

import { describe, expect, it } from 'vitest';
import { mergePathLists, parsePathFromEnvOutput, readLoginShellPath, wellKnownToolDirs } from '../login-shell-path';

describe('parsePathFromEnvOutput', () => {
  it('finds PATH between the markers, whatever the rc files printed around them', () => {
    const out = [
      'Welcome to fish!', 'PATH=/decoy/from/a/banner',
      '__GAI_ENV_START__', 'HOME=/Users/me', 'PATH=/opt/homebrew/bin:/Users/me/.local/bin:/usr/bin', 'SHELL=/bin/zsh', '__GAI_ENV_END__',
      'goodbye',
    ].join('\n');
    expect(parsePathFromEnvOutput(out)).toBe('/opt/homebrew/bin:/Users/me/.local/bin:/usr/bin');
  });

  it('returns null rather than guessing when the shell printed nothing usable', () => {
    expect(parsePathFromEnvOutput('')).toBeNull();
    expect(parsePathFromEnvOutput('__GAI_ENV_START__\nHOME=/x\n__GAI_ENV_END__')).toBeNull();
    expect(parsePathFromEnvOutput('PATH=/usr/bin')).toBeNull();
  });
});

describe('mergePathLists', () => {
  it('keeps the shell\'s order first, then what only this process had, then fallbacks — no duplicates', () => {
    expect(
      mergePathLists('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin:/custom', ['/usr/local/bin', '/opt/homebrew/bin'], ':'),
    ).toBe('/opt/homebrew/bin:/usr/bin:/bin:/custom:/usr/local/bin');
  });

  it('still improves a bare PATH when the shell could not be asked', () => {
    expect(mergePathLists(null, '/usr/bin:/bin', ['/opt/homebrew/bin'], ':')).toBe('/usr/bin:/bin:/opt/homebrew/bin');
  });
});

describe('platform handling', () => {
  it('does nothing on Windows, where GUI processes already get the user PATH', async () => {
    expect(await readLoginShellPath({ SHELL: 'C:\\nope' }, 'win32')).toBeNull();
    expect(wellKnownToolDirs('C:\\Users\\me', 'win32')).toEqual([]);
  });

  it('only offers fallback directories that exist', () => {
    expect(wellKnownToolDirs('/definitely/not/a/home', 'linux').every((d) => !d.startsWith('/definitely'))).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('asks a real shell and gets a PATH back', async () => {
    const p = await readLoginShellPath({ ...process.env, SHELL: '/bin/sh' }, process.platform, 8_000);
    expect(p).toMatch(/\/bin/);
  });

  it('survives a shell that does not exist', async () => {
    expect(await readLoginShellPath({ SHELL: '/no/such/shell' }, 'linux', 2_000)).toBeNull();
  });
});
