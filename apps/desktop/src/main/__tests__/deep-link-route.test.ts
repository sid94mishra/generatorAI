// G-08: a deep link keeps its path and only the allowlisted query keys. These
// are the rules every OS path (macOS open-url, Windows/Linux argv) goes through.

import { describe, expect, it } from 'vitest';
import { DEEP_LINK_QUERY_KEYS, deepLinkToRoute, findDeepLinkInArgv, isDeepLink, resolveDeepLink } from '../deep-link-route';

describe('deepLinkToRoute', () => {
  it('maps host and empty-host forms to the same route', () => {
    expect(deepLinkToRoute('generatorai://chats/abc')).toBe('/chats/abc');
    expect(deepLinkToRoute('generatorai:///chats/abc')).toBe('/chats/abc');
    expect(deepLinkToRoute('generatorai://')).toBe('/');
    expect(deepLinkToRoute('generatorai:///')).toBe('/');
  });

  it('keeps every allowlisted key and drops the rest and the hash', () => {
    expect(deepLinkToRoute('generatorai://chats/abc?dock=changes&evil=1#frag')).toBe('/chats/abc?dock=changes');
    expect(deepLinkToRoute('generatorai://chats/abc?tab=files&kind=agent&run=r1&x=y')).toBe(
      '/chats/abc?tab=files&kind=agent&run=r1',
    );
    expect(deepLinkToRoute('generatorai://settings/general?returnTo=https://evil')).toBe('/settings/general');
    expect(DEEP_LINK_QUERY_KEYS).toEqual(['pair', 'dock', 'tab', 'kind', 'run']);
  });

  it('re-encodes values instead of passing raw text through', () => {
    expect(deepLinkToRoute('generatorai://chats/a?dock=a%20b&dock=c')).toBe('/chats/a?dock=a+b&dock=c');
  });

  it('turns the pairing link into the ?pair= the pairing screen reads (was broken)', () => {
    expect(deepLinkToRoute('generatorai://pair?code=ABCD-EFGH-JKLM')).toBe('/?pair=ABCD-EFGH-JKLM');
    // Windows adds a slash after the host of an unknown-scheme URL.
    expect(deepLinkToRoute('generatorai://pair/?code=ABCD-EFGH-JKLM')).toBe('/?pair=ABCD-EFGH-JKLM');
    expect(deepLinkToRoute('generatorai:///pair?code=X&other=1')).toBe('/?pair=X');
    expect(deepLinkToRoute('generatorai://?pair=X&other=1')).toBe('/?pair=X');
    expect(deepLinkToRoute('generatorai://pair')).toBe('/');
  });

  it('accepts the scheme in any case (Windows may pass it as typed)', () => {
    expect(deepLinkToRoute('GeneratorAI://chats')).toBe('/chats');
  });

  it('rejects other schemes and dot segments', () => {
    expect(deepLinkToRoute('https://example.com/chats')).toBeNull();
    expect(deepLinkToRoute('generatorai-evil://chats')).toBeNull();
    expect(deepLinkToRoute('generatorai://chats/../../api/x')).toBeNull();
    expect(deepLinkToRoute('generatorai://chats/%2e%2e/settings')).toBeNull();
    expect(deepLinkToRoute('generatorai://chats/%2E/x')).toBeNull();
    expect(deepLinkToRoute('generatorai://chats/%E0%A4%A')).toBeNull();
    expect(deepLinkToRoute('')).toBeNull();
  });
});

describe('findDeepLinkInArgv (Windows / Linux)', () => {
  it('finds the link among Chromium switches (second-instance argv)', () => {
    const argv = [
      'C:\\Program Files\\GeneratorAI\\GeneratorAI.exe',
      '--allow-file-access-from-files',
      '--original-process-start-time=1',
      'generatorai://pair?code=ABCD-EFGH-JKLM',
    ];
    expect(findDeepLinkInArgv(argv)).toBe('generatorai://pair?code=ABCD-EFGH-JKLM');
  });

  it('finds a Linux xdg-open argv link after the app path', () => {
    expect(findDeepLinkInArgv(['/opt/GeneratorAI/generatorai', 'generatorai://chats/c1?dock=tasks'])).toBe(
      'generatorai://chats/c1?dock=tasks',
    );
  });

  it('unwraps a quoted argument and ignores argv without a link', () => {
    expect(findDeepLinkInArgv(['app.exe', '"generatorai://workflows"'])).toBe('generatorai://workflows');
    expect(findDeepLinkInArgv(['app.exe', '--flag'])).toBeUndefined();
  });

  it('isDeepLink is a prefix check on the scheme only', () => {
    expect(isDeepLink('generatorai://x')).toBe(true);
    expect(isDeepLink('xgeneratorai://x')).toBe(false);
  });
});

describe('resolveDeepLink (06 §8, P3-06)', () => {
  it('command links resolve to an allowlisted command, in every accepted form', () => {
    for (const url of [
      'generatorai://command/chat.new',
      'GENERATORAI://Command/chat.new',
      'generatorai:///command/chat.new',
      'generatorai://command/chat.new/',
      'generatorai://command/chat.new?x=1#h',
      'generatorai://command/chat%2Enew',
    ]) {
      expect(resolveDeepLink(url), url).toEqual({ kind: 'command', command: 'chat.new' });
    }
    expect(resolveDeepLink('generatorai://command/workflow.new')).toEqual({ kind: 'command', command: 'workflow.new' });
  });

  it('rejects ids that are not deep-link commands (main, scoped, unflagged, unknown, malformed)', () => {
    for (const [url, command] of [
      ['generatorai://command/window.reload', 'window.reload'],
      ['generatorai://command/composer.send', 'composer.send'],
      ['generatorai://command/app.settings', 'app.settings'],
      ['generatorai://command/__proto__', '__proto__'],
      ['generatorai://command/Chat.New', 'Chat.New'],
      ['generatorai://command/%E0%A4%A', '%E0%A4%A'],
      ['generatorai://command', ''],
      ['generatorai://command/chat.new/x', 'chat.new/x'],
    ] as const) {
      expect(resolveDeepLink(url), url).toEqual({ kind: 'rejected-command', command });
    }
  });

  it('everything else is a route, and non-links are null', () => {
    expect(resolveDeepLink('generatorai://')).toEqual({ kind: 'route', route: '/' });
    expect(resolveDeepLink('generatorai://commands/x')).toEqual({ kind: 'route', route: '/commands/x' });
    expect(resolveDeepLink('generatorai://chats/c1?dock=changes&x=1')).toEqual({ kind: 'route', route: '/chats/c1?dock=changes' });
    expect(resolveDeepLink('generatorai://pair?code=A')).toEqual({ kind: 'route', route: '/?pair=A' });
    expect(resolveDeepLink('generatorai://a/../b')).toBeNull();
    expect(resolveDeepLink('https://example.com/command/chat.new')).toBeNull();
  });
});
