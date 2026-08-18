import { describe, it, expect } from 'vitest';
import {
  evaluateBlocklist,
  buildBlocklist,
  normaliseAppText,
  executableBasename,
  DEFAULT_COMPUTER_USE_BLOCKLIST,
} from '../computerUseBlocklist.js';

describe('normaliseAppText', () => {
  it('strips zero-width and bidi control characters', () => {
    expect(normaliseAppText('Bit\u200Bwar\uFEFFden')).toBe('bitwarden');
    expect(normaliseAppText('Terminal\u200E')).toBe('terminal');
  });

  it('folds fullwidth and compatibility forms via NFKC', () => {
    expect(normaliseAppText('ＴＥＲＭＩＮＡＬ')).toBe('terminal');
  });

  it('folds Cyrillic and Greek homoglyphs to Latin', () => {
    // Greek omicron in "1Passwοrd", Cyrillic Т/е in "Тerminal".
    expect(normaliseAppText('1Passw\u03BFrd')).toBe('1password');
    expect(normaliseAppText('\u0422\u0435rminal')).toBe('terminal');
  });

  it('collapses whitespace and trims', () => {
    expect(normaliseAppText('  Proton   Pass  ')).toBe('proton pass');
  });
});

describe('executableBasename', () => {
  it('handles both separators and returns the last segment', () => {
    expect(executableBasename('C:\\Windows\\System32\\cmd.exe')).toBe('cmd');
    expect(executableBasename('/usr/bin/gnome-terminal')).toBe('gnome-terminal');
  });

  it('ignores trailing separators, dots and spaces', () => {
    expect(executableBasename('C:\\foo\\bar\\')).toBe('bar');
    expect(executableBasename('cmd.exe.')).toBe('cmd');
    expect(executableBasename('cmd.exe ')).toBe('cmd');
  });

  it('handles a bare name with no separator', () => {
    expect(executableBasename('pwsh')).toBe('pwsh');
  });
});

describe('evaluateBlocklist', () => {
  it('allows an ordinary app', () => {
    expect(
      evaluateBlocklist({
        id: 'com.tinyspeck.slackmacgap',
        name: 'Slack',
        windowTitles: ['#general — Acme'],
      }).blocked,
    ).toBe(false);
  });

  it('blocks by bundle id even when the app is renamed', () => {
    expect(
      evaluateBlocklist({ id: 'com.1password.1password', name: 'Totally Normal Notes' }),
    ).toMatchObject({ blocked: true, matchedOn: 'bundleId' });
  });

  it('blocks by name when the bundle id is spoofed', () => {
    expect(evaluateBlocklist({ id: 'com.example.harmless', name: 'Bitwarden' })).toMatchObject({
      blocked: true,
      matchedOn: 'name',
    });
  });

  it('blocks by window title when both id and name look innocuous', () => {
    expect(
      evaluateBlocklist({
        id: 'com.example.host',
        name: 'Helper',
        windowTitles: ['Documents', 'LastPass — Unlock Vault'],
      }),
    ).toMatchObject({ blocked: true, matchedOn: 'windowTitle' });
  });

  it('blocks homoglyph and zero-width evasions', () => {
    expect(evaluateBlocklist({ name: 'Bit\u200Bwarden' }).blocked).toBe(true);
    expect(evaluateBlocklist({ name: '1Passw\u03BFrd' }).blocked).toBe(true);
    expect(evaluateBlocklist({ windowTitles: ['\u0422\u0435rminal'] }).blocked).toBe(true);
  });

  it('blocks extensionless POSIX binaries', () => {
    expect(evaluateBlocklist({ executablePath: '/usr/bin/gnome-terminal' }).blocked).toBe(true);
    expect(evaluateBlocklist({ executablePath: '/opt/1Password/1password' }).blocked).toBe(true);
    expect(evaluateBlocklist({ executablePath: 'pwsh' }).blocked).toBe(true);
  });

  it('blocks a candidate that supplies only an id', () => {
    expect(evaluateBlocklist({ id: 'org.gnome.Terminal.desktop' }).blocked).toBe(true);
  });

  it('blocks Windows trailing-dot evasion', () => {
    expect(evaluateBlocklist({ executablePath: 'C:\\Windows\\System32\\cmd.exe.' }).blocked).toBe(true);
  });

  it('blocks our own app unconditionally, even when allowlisted', () => {
    expect(evaluateBlocklist({ id: 'ai.generatorai.desktop' })).toMatchObject({
      blocked: true,
      matchedOn: 'self',
    });
    expect(
      evaluateBlocklist({ id: 'ai.generatorai.desktop' }, { allowlist: ['ai.generatorai.desktop'] }),
    ).toMatchObject({ blocked: true, matchedOn: 'self' });
    expect(evaluateBlocklist({ name: 'GeneratorAI' }).blocked).toBe(true);
  });

  it('does not block someone else\u2019s window for merely naming us in its title', () => {
    // Our own name is matched on identity — bundle id, executable, app name —
    // never on a title bar. A user working ON this product has our name in
    // their editor, their browser tab and their file manager; blocking those
    // hid them from `listApps` entirely and made the agent unable to open them.
    for (const candidate of [
      {
        id: 'C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
        name: 'Visual Studio Code',
        windowTitles: ['package.json - GeneratorAI - Visual Studio Code'],
      },
      { name: 'Google Chrome', windowTitles: ['GeneratorAI \u2014 localhost:5173'] },
      { name: 'explorer.exe', windowTitles: ['GeneratorAI'] },
    ]) {
      expect(evaluateBlocklist(candidate).blocked).toBe(false);
    }
  });

  it('still blocks our own app however the provider identifies it', () => {
    // The Windows driver reports appId as the executable path, macOS as a
    // bundle id. Dropping the title dimension must not cost us any of these.
    expect(
      evaluateBlocklist({
        id: 'C:\\Program Files\\GeneratorAI\\GeneratorAI.exe',
        name: 'GeneratorAI',
        windowTitles: ['GeneratorAI'],
      }),
    ).toMatchObject({ blocked: true, matchedOn: 'self' });
    expect(evaluateBlocklist({ name: 'GeneratorAI Desktop' })).toMatchObject({
      blocked: true,
      matchedOn: 'self',
    });
  });

  it('keeps scanning titles for every fragment that is not our own name', () => {
    // The exemption is scoped to self fragments only — a vault or a shell
    // surfacing under an innocuous host is exactly what titles are for.
    expect(evaluateBlocklist({ name: 'Google Chrome', windowTitles: ['1Password \u2014 Unlock'] })).toMatchObject({
      blocked: true,
      matchedOn: 'windowTitle',
    });
    expect(
      evaluateBlocklist({ name: 'ApplicationFrameHost', windowTitles: ['Windows PowerShell'] }),
    ).toMatchObject({ blocked: true, matchedOn: 'windowTitle' });
  });

  it('honours the allowlist for an exact bundle id', () => {
    expect(
      evaluateBlocklist({ id: 'com.apple.terminal', name: 'Terminal' }, { allowlist: ['com.apple.terminal'] })
        .blocked,
    ).toBe(false);
  });

  it('allowlist comparison is normalised on both sides', () => {
    expect(
      evaluateBlocklist({ id: 'com.apple.Terminal' }, { allowlist: ['  COM.APPLE.TERMINAL  '] }).blocked,
    ).toBe(false);
  });

  it('refuses to let the allowlist un-block via a spoofable field', () => {
    expect(evaluateBlocklist({ id: 'com.evil.app', name: 'Terminal' }, { allowlist: ['Terminal'] }).blocked).toBe(
      true,
    );
  });

  it('always scans window titles, even for an allowlisted app', () => {
    // The whole reason titles are scanned is that a trusted host process can
    // surface an untrusted vault popup — the allowlist must not suppress it.
    expect(
      evaluateBlocklist(
        { id: 'com.example.browser', name: 'Browser', windowTitles: ['1Password — Vault'] },
        { allowlist: ['com.example.browser'] },
      ),
    ).toMatchObject({ blocked: true, matchedOn: 'windowTitle' });
  });

  it('ignores whitespace-only allowlist entries', () => {
    expect(evaluateBlocklist({ id: '   ' }, { allowlist: ['   '] }).blocked).toBe(false);
    expect(evaluateBlocklist({ id: 'com.apple.terminal' }, { allowlist: ['  '] }).blocked).toBe(true);
  });

  it('tolerates null and non-string fields without throwing', () => {
    expect(evaluateBlocklist({}).blocked).toBe(false);
    expect(
      evaluateBlocklist({
        id: null,
        name: null,
        executablePath: null,
        windowTitles: [null, undefined, 'Notes'],
      }).blocked,
    ).toBe(false);
  });

  it('word fragments do not match inside a longer word', () => {
    // 'warp' and 'kitty' are word-boundary matched, so ordinary documents
    // mentioning them must not block the editor showing them.
    expect(evaluateBlocklist({ name: 'Photoshop', windowTitles: ['warpdrive.psd'] }).blocked).toBe(false);
    expect(evaluateBlocklist({ name: 'Preview', windowTitles: ['kitty.jpg'] }).blocked).toBe(true);
    expect(evaluateBlocklist({ name: 'Preview', windowTitles: ['Warp'] }).blocked).toBe(true);
  });

  it('only ever reports a blocklist-owned string as matchedValue', () => {
    const verdict = evaluateBlocklist({ id: 'com.example.host', windowTitles: ['LastPass — Vault'] });
    expect(verdict.matchedValue).toBe('lastpass');
  });

  it('exposes an immutable default blocklist', () => {
    expect(Object.isFrozen(DEFAULT_COMPUTER_USE_BLOCKLIST)).toBe(true);
    expect(Object.isFrozen(DEFAULT_COMPUTER_USE_BLOCKLIST.bundleIds)).toBe(true);
    expect(Object.isFrozen(DEFAULT_COMPUTER_USE_BLOCKLIST.nameFragments)).toBe(true);
    expect(Object.isFrozen(DEFAULT_COMPUTER_USE_BLOCKLIST.executables)).toBe(true);
  });
});

describe('buildBlocklist', () => {
  it('unions extras onto the built-ins', () => {
    const list = buildBlocklist({ bundleIds: ['com.acme.internal'] });
    expect(list.bundleIds).toContain('com.acme.internal');
    expect(list.bundleIds).toContain('com.1password.1password');
    expect(evaluateBlocklist({ id: 'com.acme.internal' }, { blocklist: list }).blocked).toBe(true);
  });

  it('cannot be emptied — config may only add', () => {
    const list = buildBlocklist({ bundleIds: [], nameFragments: [], executables: [] });
    expect(evaluateBlocklist({ id: 'com.1password.1password' }, { blocklist: list }).blocked).toBe(true);
    expect(evaluateBlocklist({ name: 'Bitwarden' }, { blocklist: list }).blocked).toBe(true);
  });

  it('returns a frozen list', () => {
    expect(Object.isFrozen(buildBlocklist())).toBe(true);
  });
});
