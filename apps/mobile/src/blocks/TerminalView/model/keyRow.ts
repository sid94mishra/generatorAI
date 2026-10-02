// MB-27 KeyRow and status words (MD-38), pure: the keys a phone keyboard cannot type but a shell needs — esc, tab,
// ctrl and alt (sticky), ^C, the arrows, paste, find — what a key sends with the modifiers latched, and the footer's
// "node running · zsh · pid 18244 · 44×31".
import type { TerminalDescriptor } from '@generatorai/client-core';

export interface KeyDef {
  id: string;
  label: string;
  /** Raw bytes; action keys have none. */
  bytes?: string;
  action?: 'ctrl' | 'alt' | 'find' | 'paste';
  /** Arrow keys take a CSI modifier parameter while Ctrl / Alt is latched. */
  arrow?: 'A' | 'B' | 'C' | 'D';
  /** Spoken name ("Control, latched" is added by the row). */
  a11y: string;
}

/** MD-38's set, in its order. */
export const KEY_ROW: readonly KeyDef[] = [
  { id: 'esc', label: 'esc', bytes: '\u001b', a11y: 'Escape' },
  { id: 'tab', label: 'tab', bytes: '\t', a11y: 'Tab' },
  { id: 'ctrl', label: 'ctrl', action: 'ctrl', a11y: 'Control' },
  { id: 'alt', label: 'alt', action: 'alt', a11y: 'Alt' },
  { id: 'ctrl-c', label: '^C', bytes: '\u0003', a11y: 'Control C, interrupt' },
  { id: 'left', label: '←', bytes: '\u001b[D', arrow: 'D', a11y: 'Left arrow' },
  { id: 'up', label: '↑', bytes: '\u001b[A', arrow: 'A', a11y: 'Up arrow' },
  { id: 'down', label: '↓', bytes: '\u001b[B', arrow: 'B', a11y: 'Down arrow' },
  { id: 'right', label: '→', bytes: '\u001b[C', arrow: 'C', a11y: 'Right arrow' },
  { id: 'paste', label: 'paste', action: 'paste', a11y: 'Paste from clipboard' },
  { id: 'find', label: 'find', action: 'find', a11y: 'Find in scrollback' },
];

/**
 * Ctrl + a printable character → the control code a keyboard would send. Letters map to 0x01–0x1a; `[ \ ] ^ _` and
 * `@` / space to 0x1b–0x1f and 0x00. Anything else passes through unchanged.
 */
export function controlChord(text: string): string {
  if (text.length !== 1) return text;
  const code = text.toUpperCase().charCodeAt(0);
  if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code & 0x1f);
  if (text === ' ') return '\u0000';
  return text;
}

/** What a keystroke sends with the latched modifiers (CSI 1;<mod> for arrows: 5 Ctrl, 3 Alt, 7 both). */
export function withModifiers(text: string, mods: { ctrl: boolean; alt: boolean }, arrow?: KeyDef['arrow']): string {
  if (arrow && (mods.ctrl || mods.alt)) return `\u001b[1;${1 + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0)}${arrow}`;
  let data = text;
  if (mods.ctrl) data = controlChord(data);
  if (mods.alt) data = `\u001b${data}`;
  return data;
}

export function hostLabel(host: string): string {
  switch (host) {
    case 'node-pty':
    case 'pty-host':
      return 'pty';
    case 'sandbox':
      return 'sandbox';
    case 'fallback-child-process':
      return 'fallback';
    default:
      return host;
  }
}

/** `…/last/three/segments` — a full path never fits a phone. */
export function shortenPath(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.length <= 3 ? cwd : `…/${parts.slice(-3).join('/')}`;
}

/** The status footer: "zsh · pid 18244 · 44×31" (only what the descriptor knows). */
export function statusLine(d: Pick<TerminalDescriptor, 'shell' | 'pid'> | null, dims: { cols: number; rows: number }): string {
  const shell = d?.shell ? d.shell.split(/[\\/]/).pop() : null;
  return [shell, d?.pid ? `pid ${d.pid}` : null, `${dims.cols}×${dims.rows}`].filter(Boolean).join(' · ');
}

/** "Terminal", "Terminal 2" … (the instance chips). */
export function terminalLabel(index: number): string {
  return index === 0 ? 'Terminal' : `Terminal ${index + 1}`;
}
