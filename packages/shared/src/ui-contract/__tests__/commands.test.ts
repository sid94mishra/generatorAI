import { describe, expect, it } from 'vitest';
import {
  BROWSER_RESERVED_CHORDS,
  COMMANDS,
  COMMAND_IDS,
  DEEP_LINK_COMMAND_IDS,
  HOSTS,
  LAUNCHER_ACTIONS,
  NAV_DESTINATIONS,
  RENDERER_COMMAND_IDS,
  SYSTEM_SHORTCUTS,
  firesInEditable,
  isDeepLinkCommandId,
  isRendererCommandId,
  launcherActionLabel,
  launcherActionLink,
  navDestinationFor,
  type CommandId,
} from '../commands.js';
import { isPlainKeyBinding, isSequence, parseChord, splitSequence, toElectronAccelerator } from '../keys.js';

const sameChord = (a: string, b: string) => JSON.stringify(parseChord(a)) === JSON.stringify(parseChord(b));

describe('COMMANDS registry (D-24, 06 §5)', () => {
  it('decides a binding (string or null) for every command on every host', () => {
    for (const id of COMMAND_IDS) {
      for (const host of HOSTS) {
        const b = COMMANDS[id][host];
        expect(b === null || typeof b === 'string', `${id} ${host}`).toBe(true);
        if (b !== null) expect(() => splitSequence(b).forEach(parseChord), `${id} ${host}: ${b}`).not.toThrow();
      }
    }
  });

  it('desktop bindings are single-chord Electron accelerators without Mod', () => {
    for (const id of COMMAND_IDS) {
      for (const host of ['desktopMac', 'desktopWinLinux'] as const) {
        const b = COMMANDS[id][host];
        if (b !== null) expect(() => toElectronAccelerator(b), `${id} ${host}`).not.toThrow();
      }
    }
  });

  it('desktop mac bindings never use Ctrl as the primary modifier, win/linux never use Cmd', () => {
    for (const id of COMMAND_IDS) {
      const mac = COMMANDS[id].desktopMac;
      const pc = COMMANDS[id].desktopWinLinux;
      if (mac) expect(parseChord(mac).ctrl, id).toBe(false);
      if (pc) expect(parseChord(pc).cmd, id).toBe(false);
    }
  });

  it('web never binds a browser-reserved chord (any chord of a sequence)', () => {
    for (const id of COMMAND_IDS) {
      const b = COMMANDS[id].web;
      if (b === null) continue;
      for (const chord of splitSequence(b)) {
        for (const reserved of BROWSER_RESERVED_CHORDS) {
          expect(sameChord(chord, reserved), `${id}: web "${b}" uses reserved ${reserved}`).toBe(false);
        }
        // Cmd/Ctrl are desktop names; the web says Mod.
        expect(parseChord(chord).cmd || parseChord(chord).ctrl, `${id}: ${b}`).toBe(false);
      }
    }
  });

  it('no two global commands share a binding on the same host', () => {
    for (const host of HOSTS) {
      const seen = new Map<string, CommandId>();
      for (const id of COMMAND_IDS) {
        const b = COMMANDS[id][host];
        if (b === null || COMMANDS[id].scope !== 'global') continue;
        const key = splitSequence(b).map((c) => JSON.stringify(parseChord(c))).join(' ');
        expect(seen.get(key), `${host}: ${id} and ${seen.get(key)} both use ${b}`).toBeUndefined();
        seen.set(key, id);
      }
    }
  });

  it('no web binding is a prefix of another (a sequence would be unreachable)', () => {
    const web = COMMAND_IDS.flatMap((id) => (COMMANDS[id].web && COMMANDS[id].scope === 'global' ? [[id, COMMANDS[id].web!] as const] : []));
    for (const [a, ba] of web) {
      for (const [b, bb] of web) {
        if (a === b) continue;
        const ca = splitSequence(ba);
        const cb = splitSequence(bb);
        const prefix = ca.length < cb.length && ca.every((c, i) => sameChord(c, cb[i]!));
        expect(prefix, `${a} "${ba}" is a prefix of ${b} "${bb}"`).toBe(false);
      }
    }
  });

  it('the dead or missing commands of the old menu exist', () => {
    expect(COMMANDS['shortcuts.show'].web).toBe('Shift+/');
    expect(COMMANDS['scripts.reload'].runsIn).toBe('renderer');
    expect(COMMANDS['nav.agents'].desktopMac).toBe('Cmd+Shift+E');
    expect(isSequence(COMMANDS['nav.chats'].web)).toBe(true);
  });

  it('RendererCommandId = global commands that run in the renderer', () => {
    expect(RENDERER_COMMAND_IDS).toContain('shortcuts.show');
    expect(RENDERER_COMMAND_IDS).toContain('find.open');
    expect(RENDERER_COMMAND_IDS).not.toContain('nav.back');
    expect(RENDERER_COMMAND_IDS).not.toContain('composer.send');
    expect(isRendererCommandId('chat.new')).toBe(true);
    expect(isRendererCommandId('window.reload')).toBe(false);
    expect(isRendererCommandId('new-chat')).toBe(false);
    expect(isRendererCommandId('toString')).toBe(false);
  });

  it('only renderer commands may be deep-linked', () => {
    for (const id of COMMAND_IDS) {
      const def = COMMANDS[id] as { deepLink?: boolean; runsIn: string };
      if (def.deepLink) expect(def.runsIn, id).toBe('renderer');
    }
  });

  it('only the palette chord fires inside text fields, and only renderer Mod chords may', () => {
    // P1-R1: on Windows/Linux Mod is Ctrl, so every other chord (Ctrl+B,
    // Ctrl+Alt+B …) is an editing key in a field and must be left to it.
    expect(COMMAND_IDS.filter((id) => firesInEditable(id))).toEqual(['palette.toggle']);
    for (const id of COMMAND_IDS.filter((c) => firesInEditable(c))) {
      const web = COMMANDS[id].web;
      expect(web, id).not.toBeNull();
      expect(isPlainKeyBinding(web!), `${id} must be a Mod chord`).toBe(false);
      expect(isSequence(web!), id).toBe(false);
      expect(isRendererCommandId(id), id).toBe(true);
    }
  });

  it('system shortcuts are display-only chords', () => {
    for (const s of SYSTEM_SHORTCUTS) {
      for (const host of HOSTS) if (s[host]) expect(isSequence(s[host]!), s.label).toBe(false);
    }
  });
});

describe('NAV_DESTINATIONS (D-22)', () => {
  it('follows the sidebar order', () => {
    expect(NAV_DESTINATIONS.map((d) => d.label)).toEqual(['Home', 'Chats', 'Projects', 'Agents', 'Workflows', 'Automations', 'Scripts']);
  });

  it('each destination has its nav command with the same label', () => {
    for (const d of NAV_DESTINATIONS) {
      expect(COMMANDS[d.command].label).toBe(d.label);
      expect(COMMANDS[d.command].icon).toBe(d.icon);
    }
  });

  it('win/linux sections are Ctrl+1…7 in sidebar order; mac letters match the web sequences', () => {
    NAV_DESTINATIONS.forEach((d, i) => {
      const cmd = COMMANDS[d.command];
      expect(cmd.desktopWinLinux).toBe(`Ctrl+${i + 1}`);
      const letter = splitSequence(cmd.web)[1];
      expect(cmd.desktopMac).toBe(`Cmd+Shift+${letter}`);
    });
  });

  it('the tray lists every destination except Scripts', () => {
    expect(NAV_DESTINATIONS.filter((d) => d.tray).map((d) => d.id)).toEqual(['home', 'chats', 'projects', 'agents', 'workflows', 'automations']);
  });

  it('navDestinationFor resolves sections by path prefix', () => {
    expect(navDestinationFor('/')?.id).toBe('home');
    expect(navDestinationFor('/chats/abc')?.id).toBe('chats');
    expect(navDestinationFor('/chatsomething')).toBeNull();
    expect(navDestinationFor('/settings/general')).toBeNull();
  });
});

describe('deep-link commands and launcher actions (06 §8, P3-06)', () => {
  it('the generatorai://command/<id> allowlist is exactly the deepLink renderer commands', () => {
    expect(DEEP_LINK_COMMAND_IDS).toEqual(['chat.new', 'workflow.new']);
    expect(isDeepLinkCommandId('chat.new')).toBe(true);
    // A real renderer command that is not flagged, a main command, a scoped one, junk.
    expect(isDeepLinkCommandId('app.settings')).toBe(false);
    expect(isDeepLinkCommandId('server.restart')).toBe(false);
    expect(isDeepLinkCommandId('composer.send')).toBe(false);
    expect(isDeepLinkCommandId('__proto__')).toBe(false);
    expect(isDeepLinkCommandId(42)).toBe(false);
  });

  it('launcher actions: New chat, New workflow, Home — each with a link the deep-link handler accepts', () => {
    expect(LAUNCHER_ACTIONS.map(launcherActionLabel)).toEqual(['New chat', 'New workflow', 'Home']);
    expect(LAUNCHER_ACTIONS.map(launcherActionLink)).toEqual([
      'generatorai://command/chat.new',
      'generatorai://command/workflow.new',
      'generatorai://',
    ]);
    for (const a of LAUNCHER_ACTIONS) if (a.kind === 'command') expect(isDeepLinkCommandId(a.command)).toBe(true);
  });
});
