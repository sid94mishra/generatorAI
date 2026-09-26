import { describe, expect, it } from 'vitest';
import { NAV_DESTINATIONS } from '@generatorai/shared/ui-contract';
import { buildPaletteModel, paletteFooterHints } from '@/features/palette/paletteModel.js';

const base = { resolvedTheme: 'dark' as const, recentChats: [] };

function group(model: ReturnType<typeof buildPaletteModel>, label: string) {
  const found = model.groups.find((g) => g.label === label);
  if (!found) throw new Error(`no group ${label}`);
  return found;
}

describe('buildPaletteModel', () => {
  it('lists every destination under Go to, in the D-22 order, each running its nav command', () => {
    const model = buildPaletteModel({ ...base, host: 'web', mac: false });
    const goTo = group(model, 'Go to');
    expect(goTo.items.map((i) => i.label)).toEqual(NAV_DESTINATIONS.map((d) => d.label));
    expect(model.entries.get('nav:chats')).toEqual({ kind: 'command', id: 'nav.chats', path: '/chats' });
  });

  it('shows the host binding: web sequences, macOS ⌘ chords, Windows/Linux Ctrl chords', () => {
    const chats = (host: 'web' | 'desktopMac' | 'desktopWinLinux', mac: boolean) =>
      group(buildPaletteModel({ ...base, host, mac }), 'Go to').items.find((i) => i.value === 'nav:chats')?.chords;
    expect(chats('web', true)).toEqual([['G'], ['C']]);
    expect(chats('desktopMac', true)).toEqual([['⇧', '⌘', 'C']]);
    expect(chats('desktopWinLinux', false)).toEqual([['Ctrl', '2']]);
    const newChat = (host: 'web' | 'desktopWinLinux') =>
      group(buildPaletteModel({ ...base, host, mac: false }), 'Actions').items.find((i) => i.value === 'cmd:chat.new')?.chords;
    expect(newChat('web')).toEqual([['N']]);
    expect(newChat('desktopWinLinux')).toEqual([['Ctrl', 'N']]);
  });

  it('lists palette commands under Actions, board order first, without destinations or the palette itself', () => {
    const actions = group(buildPaletteModel({ ...base, host: 'web', mac: false }), 'Actions').items.map((i) => i.value);
    expect(actions.slice(0, 4)).toEqual(['cmd:chat.new', 'cmd:workflow.new', 'cmd:theme.toggle', 'cmd:app.settings']);
    expect(actions).toContain('cmd:shortcuts.show');
    expect(actions.some((v) => v.startsWith('cmd:nav.'))).toBe(false);
    expect(actions).not.toContain('cmd:palette.toggle');
  });

  it('describes the theme toggle from the current appearance', () => {
    const theme = (resolvedTheme: 'dark' | 'light') =>
      group(buildPaletteModel({ host: 'web', mac: false, resolvedTheme, recentChats: [] }), 'Actions').items.find(
        (i) => i.value === 'cmd:theme.toggle',
      );
    expect(theme('dark')).toMatchObject({ meta: 'Dark → Light', icon: 'mode-dark' });
    expect(theme('light')).toMatchObject({ meta: 'Light → Dark', icon: 'mode-light' });
  });

  it('lists recent chats with their project and live state; a note row when there are none; nothing while loading', () => {
    const model = buildPaletteModel({
      ...base,
      host: 'web',
      mac: false,
      recentChats: [{ id: 'c1', name: 'Fix flaky test', projectName: 'payments', live: 'needs_you' }],
    });
    const recent = group(model, 'Recent chats');
    expect(recent.items[0]).toMatchObject({ value: 'chat:c1', label: 'Fix flaky test', meta: 'payments' });
    expect(model.entries.get('chat:c1')).toEqual({ kind: 'chat', chatId: 'c1', path: '/chats/c1', live: 'needs_you' });

    const empty = group(buildPaletteModel({ ...base, host: 'web', mac: false }), 'Recent chats');
    expect(empty.items).toEqual([expect.objectContaining({ label: 'No recent chats', note: true, disabled: true })]);

    const loading = buildPaletteModel({ ...base, host: 'web', mac: false, recentChats: undefined });
    expect(loading.groups.map((g) => g.label)).toEqual(['Go to', 'Actions']);
  });

  it('offers new-tab and copy-link row actions only in a browser tab', () => {
    const recentChats = [{ id: 'c1', name: 'A chat' }];
    const web = buildPaletteModel({ ...base, host: 'web', mac: false, recentChats });
    expect(group(web, 'Recent chats').items[0]?.actions?.map((a) => a.value)).toEqual(['open', 'open-new-tab', 'copy-link', 'archive']);
    expect(group(web, 'Go to').items[0]?.actions?.map((a) => a.value)).toEqual(['open', 'open-new-tab', 'copy-link']);

    const desktop = buildPaletteModel({ ...base, host: 'desktopMac', mac: true, recentChats });
    expect(group(desktop, 'Recent chats').items[0]?.actions?.map((a) => a.value)).toEqual(['open', 'archive']);
    // A lone "Open" is no action list: Tab does nothing on a desktop Go to row.
    expect(group(desktop, 'Go to').items[0]?.actions).toBeUndefined();
  });
});

describe('paletteFooterHints', () => {
  it('reads the keys from the palette entries of the registry', () => {
    expect(paletteFooterHints({ host: 'web', mac: false })).toEqual([
      { keys: [['↑'], ['↓']], label: 'Navigate' },
      { keys: [['↵']], label: 'Open' },
      { keys: [['Tab']], label: 'Actions' },
      { keys: [['Esc']], label: 'Close', end: true },
    ]);
  });
});
