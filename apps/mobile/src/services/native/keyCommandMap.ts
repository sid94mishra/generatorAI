// Pure mapping from the shared command registry to native key commands (06 §3.10). Vitest-covered.
import { COMMANDS, bindingFor, parseChord, type CommandId } from '@generatorai/shared/ui-contract';

export type KeyModifier = 'cmd' | 'ctrl' | 'alt' | 'shift';

export interface NativeKeyCommand {
  /** The CommandId the event carries back. */
  id: string;
  /** A letter, digit or punctuation key, or one of: escape, up, down, left, right, enter, tab. */
  input: string;
  modifiers: KeyModifier[];
  /** Discoverability title (iPadOS ⌘-hold overlay / menu bar, Android shortcut helper). */
  title: string;
}

const KEY_NAMES: Record<string, string> = { escape: 'escape', up: 'up', down: 'down', left: 'left', right: 'right', enter: 'enter', tab: 'tab' };

/**
 * One command's binding on this host as a native key command, or null when unbound there or not a single chord.
 * Pure (Vitest): `platform` picks the host — iOS `desktopMac`, Android `desktopWinLinux`.
 */
export function nativeKeyCommand(id: CommandId, platform: 'ios' | 'android'): NativeKeyCommand | null {
  const binding = bindingFor(id, platform === 'ios' ? 'desktopMac' : 'desktopWinLinux');
  if (!binding || /\s/.test(binding)) return null;
  const chord = parseChord(binding);
  const input = KEY_NAMES[chord.key] ?? (chord.key.length === 1 ? chord.key : null);
  if (!input) return null;
  const modifiers: KeyModifier[] = [];
  if (chord.cmd || (chord.mod && platform === 'ios')) modifiers.push('cmd');
  if (chord.ctrl || (chord.mod && platform === 'android')) modifiers.push('ctrl');
  if (chord.alt) modifiers.push('alt');
  if (chord.shift) modifiers.push('shift');
  return { id, input, modifiers, title: COMMANDS[id].label };
}

export function nativeKeyCommands(ids: readonly CommandId[], platform: 'ios' | 'android'): NativeKeyCommand[] {
  const out: NativeKeyCommand[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const cmd = nativeKeyCommand(id, platform);
    if (!cmd) continue;
    const chord = `${cmd.modifiers.slice().sort().join('+')}+${cmd.input}`;
    // Two commands on one chord (Escape: dock.dismiss / palette.close): the first one listed wins.
    if (seen.has(chord)) continue;
    seen.add(chord);
    out.push(cmd);
  }
  return out;
}
