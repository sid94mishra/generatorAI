// ────────────────────────────────────────────────────────────────
// Binding strings → display chips, Electron accelerators and key matching
// (06-desktop-and-shell.md §5.1). Pure and DOM-free: the matcher takes a
// keyboard-event-shaped object, so the same code serves the web host, tests and
// (next pass) mobile hardware keyboards.
// ────────────────────────────────────────────────────────────────

import type { Host } from './commands.js';

const MODIFIERS = ['Mod', 'Cmd', 'Ctrl', 'Alt', 'Shift'] as const;
type Modifier = (typeof MODIFIERS)[number];

export interface Chord {
  mod: boolean;
  cmd: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** The non-modifier key, lower-cased for letters ('k', ',', 'enter', 'left'). */
  key: string;
}

/** Splits a binding into its chords ('G H' → ['G', 'H']). */
export function splitSequence(binding: string): string[] {
  return binding.trim().split(/\s+/);
}

export function isSequence(binding: string): boolean {
  return splitSequence(binding).length > 1;
}

/** Parses one chord ('Cmd+Shift+H', 'Shift+/', 'Mod++' is not supported — use 'Plus'). */
export function parseChord(chord: string): Chord {
  const parts = chord.split('+');
  const key = parts.pop();
  if (!key) throw new Error(`Empty key in chord "${chord}"`);
  const result: Chord = { mod: false, cmd: false, ctrl: false, alt: false, shift: false, key: key.toLowerCase() };
  for (const part of parts) {
    if (!(MODIFIERS as readonly string[]).includes(part)) throw new Error(`Unknown modifier "${part}" in "${chord}"`);
    const flag = part.toLowerCase() as Lowercase<Modifier>;
    result[flag] = true;
  }
  return result;
}

/** True when the first chord carries no Mod/Cmd/Ctrl/Alt: a bare key or sequence that must not fire while typing. */
export function isPlainKeyBinding(binding: string): boolean {
  const first = parseChord(splitSequence(binding)[0]!);
  return !first.mod && !first.cmd && !first.ctrl && !first.alt;
}

/** Validates a desktop binding and returns it as an Electron accelerator. */
export function toElectronAccelerator(binding: string): string {
  if (isSequence(binding)) throw new Error(`Desktop bindings must be single chords, got sequence "${binding}"`);
  const chord = parseChord(binding);
  if (chord.mod) throw new Error(`Desktop bindings name Cmd/Ctrl explicitly, got "Mod" in "${binding}"`);
  return binding;
}

// ── Display ──────────────────────────────────────────────────────

const MAC_GLYPHS: Record<Lowercase<Modifier>, string> = { mod: '⌘', cmd: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
const PC_WORDS: Record<Lowercase<Modifier>, string> = { mod: 'Ctrl', cmd: 'Win', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };

const KEY_LABELS: Record<string, string> = {
  enter: '↵',
  escape: 'Esc',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  tab: 'Tab',
  delete: 'Del',
  plus: '+',
};

function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));
}

/**
 * Display chips for a binding: one array of key labels per chord.
 * `formatBinding('Cmd+Shift+H', 'desktopMac')` → `[['⌘','⇧','H']]`,
 * `formatBinding('G H', 'web')` → `[['G'],['H']]`, `'Shift+/'` → `[['?']]`.
 * On the web, `Mod` follows the viewer's OS (`opts.mac`).
 */
export function formatBinding(binding: string, host: Host, opts: { mac?: boolean } = {}): string[][] {
  const mac = host === 'desktopMac' || (host === 'web' && opts.mac === true);
  return splitSequence(binding).map((raw) => {
    const chord = parseChord(raw);
    if (chord.shift && chord.key === '/' && !chord.mod && !chord.cmd && !chord.ctrl && !chord.alt) return ['?'];
    const names = mac ? MAC_GLYPHS : PC_WORDS;
    const out: string[] = [];
    // Conventional order: ⌃⌥⇧⌘ on macOS, Ctrl+Alt+Shift elsewhere.
    const order: Array<Lowercase<Modifier>> = mac ? ['ctrl', 'alt', 'shift', 'mod', 'cmd'] : ['mod', 'ctrl', 'cmd', 'alt', 'shift'];
    for (const m of order) if (chord[m]) out.push(names[m]);
    out.push(keyLabel(chord.key));
    return out;
  });
}

/** Plain-text form for titles and aria labels ('G then H', '⌘⇧H', 'Ctrl+1'). */
export function formatBindingText(binding: string, host: Host, opts: { mac?: boolean } = {}): string {
  const mac = host === 'desktopMac' || (host === 'web' && opts.mac === true);
  return formatBinding(binding, host, opts)
    .map((chips) => chips.join(mac ? '' : '+'))
    .join(' then ');
}

// ── Matching ─────────────────────────────────────────────────────

/** The fields of a KeyboardEvent the matcher reads. */
export interface KeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** US-layout shifted characters → their unshifted key, so 'Shift+/' matches '?'. */
const UNSHIFT: Record<string, string> = {
  '?': '/', '<': ',', '>': '.', ':': ';', '"': "'", '{': '[', '}': ']', '|': '\\', '~': '`', '_': '-', '+': '=',
  '!': '1', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
};

const EVENT_KEY_NAMES: Record<string, string> = {
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
  esc: 'escape',
};

/** Candidate key names for an event: from `key` (layout-aware) and `code` (physical, for Alt on macOS). */
function eventKeys(e: KeyLike): string[] {
  const out = new Set<string>();
  const key = e.key.toLowerCase();
  out.add(EVENT_KEY_NAMES[key] ?? key);
  if (e.shiftKey && UNSHIFT[e.key]) out.add(UNSHIFT[e.key]!);
  const code = e.code ?? '';
  if (/^Key[A-Z]$/.test(code)) out.add(code.slice(3).toLowerCase());
  else if (/^Digit\d$/.test(code)) out.add(code.slice(5));
  else {
    const physical: Record<string, string> = {
      Slash: '/', Comma: ',', Period: '.', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Minus: '-', Equal: '=', Backquote: '`', Backslash: '\\',
    };
    if (physical[code]) out.add(physical[code]!);
  }
  return [...out];
}

/** Does one keydown match one chord? `mac` decides what `Mod` means. */
export function matchesChord(e: KeyLike, chordText: string, mac: boolean): boolean {
  const chord = parseChord(chordText);
  const wantMeta = chord.cmd || (chord.mod && mac);
  const wantCtrl = chord.ctrl || (chord.mod && !mac);
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl || e.altKey !== chord.alt) return false;
  if (chord.shift !== e.shiftKey) {
    // A chord naming a symbol that is itself typed with Shift ('@') matches the
    // shifted keystroke; otherwise Shift must agree ('N' is not 'Shift+N').
    const symbolTypedWithShift = !chord.shift && e.shiftKey && e.key === chord.key && !/^[a-z0-9]$/.test(chord.key);
    if (!symbolTypedWithShift) return false;
  }
  return eventKeys(e).includes(chord.key);
}

/** Keys that only modify: pressing them alone never advances or resets a sequence. */
const MODIFIER_KEYS = new Set(['shift', 'control', 'alt', 'meta', 'os', 'capslock', 'altgraph']);

export interface SequenceMatcherOptions {
  /** `Mod` = Cmd when true, Ctrl otherwise. */
  mac: boolean;
  /** Max gap between the chords of a sequence (ms). */
  timeoutMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export type MatchResult<Id extends string> = { kind: 'match'; id: Id } | { kind: 'pending' } | { kind: 'none' };

/**
 * Matches keydowns against a set of bindings, single chords and sequences.
 * Feed every keydown to `handle`. A `pending` result means the key started (or
 * continued) a sequence and should be swallowed. A new chord that does not
 * continue the pending sequence restarts matching from it, so 'G G C' → 'G C'.
 */
export function createSequenceMatcher<Id extends string>(
  bindings: ReadonlyArray<{ id: Id; binding: string }>,
  options: SequenceMatcherOptions,
) {
  const timeoutMs = options.timeoutMs ?? 1500;
  const now = options.now ?? (() => Date.now());
  const parsed = bindings.map((b) => ({ id: b.id, chords: splitSequence(b.binding) }));
  let prefix: string[] = [];
  let lastAt = 0;

  function step(e: KeyLike, pressed: string[]): MatchResult<Id> {
    const depth = pressed.length;
    const candidates = parsed.filter(
      (b) => b.chords.length > depth && pressed.every((c, i) => b.chords[i] === c) && matchesChord(e, b.chords[depth]!, options.mac),
    );
    if (candidates.length === 0) return { kind: 'none' };
    const complete = candidates.find((b) => b.chords.length === depth + 1);
    if (complete) {
      prefix = [];
      return { kind: 'match', id: complete.id };
    }
    prefix = [...pressed, candidates[0]!.chords[depth]!];
    lastAt = now();
    return { kind: 'pending' };
  }

  return {
    handle(e: KeyLike): MatchResult<Id> {
      if (MODIFIER_KEYS.has(e.key.toLowerCase())) return prefix.length ? { kind: 'pending' } : { kind: 'none' };
      if (prefix.length && now() - lastAt > timeoutMs) prefix = [];
      if (prefix.length) {
        const continued = step(e, prefix);
        if (continued.kind !== 'none') return continued;
        prefix = [];
      }
      return step(e, []);
    },
    /** Drops a half-typed sequence (focus moved into a field, a dialog opened …). */
    reset(): void {
      prefix = [];
    },
    get pending(): boolean {
      return prefix.length > 0;
    },
  };
}
