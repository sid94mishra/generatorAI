import { describe, expect, it } from 'vitest';

import { nativeKeyCommand, nativeKeyCommands } from './keyCommandMap';
import { activeKeyCommandIds, MOBILE_KEY_COMMANDS } from '../../blocks/shell/commandSets';

describe('hardware shortcuts from COMMANDS (06 §3.10)', () => {
  it('uses the desktopMac bindings on iPad and desktopWinLinux on Android', () => {
    expect(nativeKeyCommand('palette.toggle', 'ios')).toEqual({ id: 'palette.toggle', input: 'k', modifiers: ['cmd'], title: 'Search or jump to' });
    expect(nativeKeyCommand('palette.toggle', 'android')).toMatchObject({ input: 'k', modifiers: ['ctrl'] });
    expect(nativeKeyCommand('chat.new', 'ios')).toMatchObject({ input: 'n', modifiers: ['cmd'] });
    expect(nativeKeyCommand('workflow.new', 'android')).toMatchObject({ input: 'n', modifiers: ['ctrl', 'shift'] });
    expect(nativeKeyCommand('nav.chats', 'ios')).toMatchObject({ input: 'c', modifiers: ['cmd', 'shift'] });
    expect(nativeKeyCommand('nav.chats', 'android')).toMatchObject({ input: '2', modifiers: ['ctrl'] });
    expect(nativeKeyCommand('nav.back', 'ios')).toMatchObject({ input: '[', modifiers: ['cmd'] });
    expect(nativeKeyCommand('nav.back', 'android')).toMatchObject({ input: 'left', modifiers: ['alt'] });
    expect(nativeKeyCommand('dock.toggle', 'ios')).toMatchObject({ input: 'b', modifiers: ['cmd', 'alt'] });
    expect(nativeKeyCommand('app.settings', 'android')).toMatchObject({ input: ',', modifiers: ['ctrl'] });
    expect(nativeKeyCommand('palette.close', 'ios')).toMatchObject({ input: 'escape', modifiers: [] });
    expect(nativeKeyCommand('palette.next', 'android')).toMatchObject({ input: 'down', modifiers: [] });
    // Unbound on the host → nothing registered.
    expect(nativeKeyCommand('project.new', 'ios')).toBeNull();
  });

  it('registers each chord once and maps every global mobile command', () => {
    const ios = nativeKeyCommands(MOBILE_KEY_COMMANDS, 'ios');
    expect(ios).toHaveLength(MOBILE_KEY_COMMANDS.length);
    const both = nativeKeyCommands(['palette.close', 'dock.dismiss'], 'android');
    expect(both.map((c) => c.id)).toEqual(['palette.close']);
  });

  it('adds arrows and Escape only while an overlay is open', () => {
    expect(activeKeyCommandIds({ palette: false, overlayOpen: false })).not.toContain('palette.next');
    expect(activeKeyCommandIds({ palette: false, overlayOpen: false })).not.toContain('dock.dismiss');
    expect(activeKeyCommandIds({ palette: true, overlayOpen: true })).toEqual(expect.arrayContaining(['palette.next', 'palette.prev', 'palette.close']));
    expect(activeKeyCommandIds({ palette: false, overlayOpen: true })).toContain('dock.dismiss');
  });
});
