// ────────────────────────────────────────────────────────────────
// Hooks Ink 6 does not ship.
//
// Ink 7 adds `useWindowSize`, `usePaste` and `suspendTerminal`; we are on 6.8
// because that is what resolves against React 19 today. Rather than do
// without, each is implemented here against the same primitives Ink itself
// uses, and each is documented with what it will be replaced by.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { appendFileSync } from 'node:fs';
import { useApp, useInput, useStdin, useStdout, type Key } from 'ink';
import { normalise, type Keymap, type KeyContext } from '@generatorai/cli-core';

/**
 * Path to append a line per keystroke to, or undefined.
 *
 * A TUI cannot print diagnostics to the screen it owns, and a mis-resolved
 * chord is otherwise indistinguishable from an unbound one. Set
 * `GENERATORAI_KEYTRACE=<file>` to see what each key resolved to.
 */
const KEY_TRACE = process.env['GENERATORAI_KEYTRACE'];

// ── Terminal size ─────────────────────────────────────────────────

export interface TerminalSize {
  columns: number;
  rows: number;
}

/**
 * Terminal dimensions, updated on SIGWINCH.
 *
 * Replaces Ink 7's `useWindowSize`. The listener is added with an explicit
 * max-listener bump because every pane subscribes and Node warns at ten.
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>(() => ({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  }));

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setSize({ columns: stdout.columns, rows: stdout.rows });
    stdout.setMaxListeners(Math.max(stdout.getMaxListeners(), 64));
    stdout.on('resize', onResize);
    onResize();
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return size;
}

/** Layout tier, so components branch on intent rather than on raw numbers. */
export type Breakpoint = 'tiny' | 'compact' | 'narrow' | 'standard' | 'wide';

export function useBreakpoint(): Breakpoint {
  const { columns } = useTerminalSize();
  if (columns < 60) return 'tiny';
  if (columns < 80) return 'compact';
  if (columns < 100) return 'narrow';
  if (columns < 160) return 'standard';
  return 'wide';
}

// ── Alternate screen ──────────────────────────────────────────────

/**
 * Enters the alternate screen buffer.
 *
 * Must be called *before* the first `render()`. Doing it from an effect paints
 * the first frame into the main buffer and then switches away from it, leaving
 * the user staring at an empty alternate buffer — and under ConPTY the frame is
 * never re-emitted, because Ink believes those lines are already on screen.
 */
export function enterAlternateScreen(stream: NodeJS.WriteStream = process.stdout): () => void {
  if (!stream.isTTY) return () => {};

  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    stream.write('\u001B[?1049l\u001B[?25h');
  };

  stream.write('\u001B[?1049h\u001B[H');

  // A crash that leaves the terminal in the alternate buffer hides both the
  // user's shell and the error that caused it.
  process.once('exit', leave);
  // Registering an `uncaughtException` listener suppresses Node's default
  // action, so this one has to do all of it: restore the screen, print the
  // error, and exit non-zero. Without the last two the TUI would simply
  // vanish into a live-but-dead shell with nothing explaining why.
  process.once('uncaughtException', (error: unknown) => {
    leave();
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  });
  return leave;
}

/**
 * Full-screen mode, restoring the user's scrollback on exit.
 *
 * Replaces Ink 7's `alternateScreen` render option. This only handles
 * *leaving* and re-entering around a suspend; the initial entry belongs to
 * {@link enterAlternateScreen} so it precedes the first paint.
 */
export function useAlternateScreen(enabled: boolean): void {
  const { stdout } = useStdout();
  const wasEnabled = useRef(enabled);

  useEffect(() => {
    if (!stdout?.isTTY) return;
    if (wasEnabled.current === enabled) return;
    wasEnabled.current = enabled;

    // Re-entering after a suspend must repaint from scratch: the child process
    // owned the screen and Ink's idea of what is on it is stale.
    stdout.write(enabled ? '\u001B[?1049h\u001B[H' : '\u001B[?1049l');
  }, [enabled, stdout]);
}


/** Hides the cursor while the TUI owns the screen. */
export function useHiddenCursor(enabled: boolean): void {
  const { stdout } = useStdout();
  useEffect(() => {
    if (!enabled || !stdout?.isTTY) return;
    stdout.write('\u001B[?25l');
    const restore = () => stdout.write('\u001B[?25h');
    process.once('exit', restore);
    return () => {
      restore();
      process.off('exit', restore);
    };
  }, [enabled, stdout]);
}

// ── Bracketed paste ───────────────────────────────────────────────

/**
 * Multi-line paste as one string.
 *
 * Replaces Ink 7's `usePaste`. Without bracketed paste a pasted paragraph
 * arrives as hundreds of individual keypresses and the first newline submits
 * the composer, sending a third of what the user pasted.
 *
 * The raw `data` listener sits alongside Ink's own; Ink will also see the
 * bytes, so the handler strips the markers and the composer ignores input
 * arriving between them.
 */
export function usePaste(handler: (text: string) => void, isActive = true): void {
  const { stdin, setRawMode, isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!isActive || !stdin || !isRawModeSupported || !stdout?.isTTY) return;

    setRawMode(true);
    acquireBracketedPaste(stdout);

    let buffer = '';
    let inPaste = false;

    const onData = (chunk: Buffer | string) => {
      let text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

      for (;;) {
        if (!inPaste) {
          const start = text.indexOf('\u001B[200~');
          if (start === -1) return;
          inPaste = true;
          text = text.slice(start + 6);
        }
        const end = text.indexOf('\u001B[201~');
        if (end === -1) {
          buffer += text;
          return;
        }
        buffer += text.slice(0, end);
        handlerRef.current(buffer);
        buffer = '';
        inPaste = false;
        text = text.slice(end + 6);
      }
    };

    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
      releaseBracketedPaste(stdout);
      setRawMode(false);
    };
  }, [isActive, stdin, stdout, setRawMode, isRawModeSupported]);
}

/**
 * Bracketed paste is a terminal-wide mode, not a per-component one.
 *
 * Two consumers mount routinely — the composer and `useIsPasting` — and
 * whichever unmounted first used to switch the mode off underneath the other,
 * so a multi-line paste reverted to per-character delivery and submitted at
 * the first newline. Refcounted so it is enabled on 0→1 and disabled on 1→0.
 */
let bracketedPasteRefs = 0;

function acquireBracketedPaste(stdout: NodeJS.WriteStream): void {
  if (bracketedPasteRefs === 0) stdout.write('\u001B[?2004h');
  bracketedPasteRefs++;
}

function releaseBracketedPaste(stdout: NodeJS.WriteStream): void {
  bracketedPasteRefs = Math.max(0, bracketedPasteRefs - 1);
  if (bracketedPasteRefs === 0) stdout.write('\u001B[?2004l');
}

/** True while a paste is mid-flight, so key handlers can stand down. */
export function useIsPasting(): boolean {
  const [pasting, setPasting] = useState(false);
  usePaste(() => {
    setPasting(true);
    // One tick is enough: the paste has already been delivered whole.
    queueMicrotask(() => setPasting(false));
  });
  return pasting;
}

// ── Terminal suspension ───────────────────────────────────────────

export interface Suspension {
  resume(): Promise<void>;
}

/**
 * Hands the terminal to a child process, then takes it back.
 *
 * Replaces Ink 7's `suspendTerminal`. This is what makes `$EDITOR` composing
 * and raw PTY attach possible: while suspended Ink must stop drawing and stop
 * reading, and the terminal must be put back into the modes a normal program
 * expects (cooked input, visible cursor, primary screen buffer).
 */
export function useTerminalSuspension(): (task: () => Promise<void>) => Promise<void> {
  const { stdout } = useStdout();
  const { stdin, setRawMode, isRawModeSupported } = useStdin();
  const suspended = useRef(false);

  return useCallback(
    async (task: () => Promise<void>) => {
      if (suspended.current) {
        throw new Error('The terminal is already suspended.');
      }
      if (!stdout?.isTTY) {
        // Nothing to hand over; run the task and let it use the pipe.
        await task();
        return;
      }

      suspended.current = true;
      const wasRaw = Boolean((stdin as NodeJS.ReadStream | undefined)?.isRaw);

      try {
        stdout.write('\u001B[?2004l'); // bracketed paste off
        stdout.write('\u001B[?25h'); // cursor visible
        stdout.write('\u001B[?1049l'); // primary screen
        if (isRawModeSupported) setRawMode(false);

        await task();
      } finally {
        if (isRawModeSupported && wasRaw) setRawMode(true);
        stdout.write('\u001B[?1049h\u001B[H'); // back to the alternate screen
        stdout.write('\u001B[?25l');
        stdout.write('\u001B[2J\u001B[H'); // force a full repaint
        suspended.current = false;
      }
    },
    [stdout, stdin, setRawMode, isRawModeSupported],
  );
}

// ── Keymap ────────────────────────────────────────────────────────

/** Ink's `Key` plus the typed character, normalised into a chord string. */
export function toChord(input: string, key: Key): string {
  const parts: string[] = [];
  if (key.ctrl) parts.push('ctrl');
  // A bare Escape arrives as the single byte `\x1b`, and Ink flags that as
  // `meta` because Alt+key is also encoded as ESC-prefixed. Treating it as
  // Alt yields `alt+escape`, which matches no binding — so Esc would do
  // nothing anywhere in the app.
  if (key.meta && !key.escape) parts.push('alt');
  // Shift is only meaningful for non-printing keys: for letters the terminal
  // already delivers the uppercase character, and adding `shift+` would mean
  // `A` never matched a binding written as `A`.
  if (key.shift && (key.tab || key.return || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow)) {
    parts.push('shift');
  }

  let name = input;
  if (key.upArrow) name = 'up';
  else if (key.downArrow) name = 'down';
  else if (key.leftArrow) name = 'left';
  else if (key.rightArrow) name = 'right';
  else if (key.return) name = 'return';
  else if (key.escape) name = 'escape';
  else if (key.tab) name = 'tab';
  else if (key.backspace) name = 'backspace';
  else if (key.delete) name = 'delete';
  else if (key.pageUp) name = 'pageup';
  else if (key.pageDown) name = 'pagedown';
  else if (input === ' ') name = 'space';

  return normalise([...parts, name].join('+'));
}

export interface KeymapHandlers {
  [actionId: string]: (() => void) | undefined;
}

/**
 * True when a chord is something a user could be trying to type.
 *
 * Anything carrying ctrl/alt, and every named key (escape, tab, arrows,
 * function keys), is unambiguous while a text field is focused. A bare
 * character is not.
 */
function isPrintableChord(chord: string): boolean {
  if (chord.includes('+')) return false;
  return ![
    'up', 'down', 'left', 'right', 'return', 'escape', 'tab',
    'backspace', 'delete', 'pageup', 'pagedown', 'home', 'end',
  ].includes(chord);
}

/**
 * Splits one Ink input event into the keypresses it actually represents.
 *
 * Ink hands over whatever arrived in a single read of stdin. Typing quickly —
 * or any terminal that batches, which is most of them over SSH or a pty —
 * delivers `g`, `c` and Enter as the single string "gc\r". Matched against the
 * keymap that is one three-character chord, which binds to nothing, so the
 * keystrokes are silently dropped and the app looks frozen.
 */
function splitBurst(input: string, key: Key): Array<{ input: string; key: Key }> {
  if (input.length <= 1) return [{ input, key }];
  // Ink sets these only when it has already resolved the bytes to one named
  // key, and an ESC byte means a sequence whose boundaries we must not guess.
  const resolved =
    key.ctrl || key.meta || key.escape || key.tab || key.backspace || key.delete ||
    key.upArrow || key.downArrow || key.leftArrow || key.rightArrow ||
    key.pageUp || key.pageDown;
  if (resolved || input.includes('\u001B')) return [{ input, key }];

  return [...input].map((char) => {
    const code = char.codePointAt(0) ?? 0;
    if (char === '\r' || char === '\n') return { input: char, key: { ...key, return: true } };
    if (char === '\t') return { input: char, key: { ...key, tab: true } };
    if (char === '\u007f') return { input: '', key: { ...key, backspace: true } };
    // A C0 byte inside a burst is a Ctrl chord the terminal folded into the
    // same read; left as a raw character it would match no binding.
    if (code > 0 && code < 27) {
      return { input: String.fromCharCode(code + 96), key: { ...key, ctrl: true } };
    }
    return { input: char, key };
  });
}

/**
 * `useInput`, but one call per keypress.
 *
 * Every handler that tests `key.return` or compares `input` to a single
 * character is wrong when the terminal batches, so all of them use this
 * instead of Ink's hook directly.
 */
export function useKeys(
  handler: (input: string, key: Key) => void,
  options: { isActive?: boolean } = {},
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useInput(
    (input, key) => {
      for (const event of splitBurst(input, key)) handlerRef.current(event.input, event.key);
    },
    { isActive: options.isActive ?? true },
  );
}

/**
 * Binds actions by id rather than by key.
 *
 * Components never name a key. That is what lets the help overlay, the
 * palette hints and the user's remapping all read one table, and it is why a
 * binding invented inside a component would be invisible to all three.
 */
export function useKeymap(
  keymap: Keymap,
  contexts: KeyContext[],
  handlers: KeymapHandlers,
  options: { isActive?: boolean; textInputActive?: boolean } = {},
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Two-key sequences (`g d`) need the first key remembered, and forgotten
  // again if the second does not arrive promptly — otherwise a stray `g`
  // silently swallows the next keystroke minutes later.
  const pending = useRef<{ key: string; at: number } | null>(null);

  useInput(
    (rawInput, rawKey) => {
      for (const event of splitBurst(rawInput, rawKey)) {
        const input = event.input;
        const key = event.key;
        const chord = toChord(input, key);
        const now = Date.now();

        if (KEY_TRACE) {
          const traced = keymap.lookup(chord, contexts);
          appendFileSync(
            KEY_TRACE,
            `${new Date().toISOString()} chord=${chord} contexts=${contexts.join(',')} ` +
              `textInput=${String(options.textInputActive)} action=${traced ?? '-'}\n`,
          );
        }

        // While a text field owns the keyboard, only modified chords and
        // non-printing keys may act. Ink does not stop propagation, so without
        // this a bare `g` reaches both the field and the keymap: typing "good"
        // navigates away on `g o` and the message is lost.
        //
        // Leader mode is the exception: the prefix has already claimed the next
        // keystroke, so `leader x` must close the pane rather than type an `x`.
        const leaderActive = contexts.includes('leader');
        if (options.textInputActive && !leaderActive && isPrintableChord(chord)) {
          pending.current = null;
          continue;
        }

        if (pending.current && now - pending.current.at < 1200) {
          const sequence = `${pending.current.key} ${chord}`;
          pending.current = null;
          const action = keymap.lookup(sequence, contexts);
          if (action && handlersRef.current[action]) {
            handlersRef.current[action]!();
            continue;
          }
        }
        pending.current = null;

        const action = keymap.lookup(chord, contexts);
        if (action && handlersRef.current[action]) {
          handlersRef.current[action]!();
          continue;
        }

        // Not a binding on its own — it may be the first half of a sequence.
        if (/^[a-z]$/.test(chord) && keymap.all().some((b) => b.keys.startsWith(`${chord} `))) {
          pending.current = { key: chord, at: now };
        }
      }
    },
    { isActive: options.isActive ?? true },
  );
}

// ── Virtualisation ────────────────────────────────────────────────

export interface VirtualWindow {
  start: number;
  end: number;
  offset: number;
  /** True when content extends past the top / bottom of the viewport. */
  hasAbove: boolean;
  hasBelow: boolean;
}

/**
 * The slice of a long list that should actually be rendered.
 *
 * Rendering 119 workflow rows costs a full Yoga layout pass per keystroke.
 * Windowing keeps that proportional to the viewport instead of to the data.
 */
export function useVirtualWindow(
  total: number,
  viewportRows: number,
  selectedIndex: number,
): VirtualWindow {
  const offsetRef = useRef(0);

  return useMemo(() => {
    const height = Math.max(1, viewportRows);
    let offset = offsetRef.current;

    // Scroll only as far as needed to bring the selection into view, so the
    // list does not jump when the user moves one row.
    if (selectedIndex < offset) offset = selectedIndex;
    else if (selectedIndex >= offset + height) offset = selectedIndex - height + 1;

    offset = Math.max(0, Math.min(offset, Math.max(0, total - height)));
    offsetRef.current = offset;

    return {
      start: offset,
      end: Math.min(total, offset + height),
      offset,
      hasAbove: offset > 0,
      hasBelow: offset + height < total,
    };
  }, [total, viewportRows, selectedIndex]);
}

/** Selection index with wrap-around and page movement. */
export function useSelection(total: number, initial = 0) {
  const [index, setIndex] = useState(initial);

  useLayoutEffect(() => {
    // A list that shrank under the cursor must not leave it out of bounds.
    if (index >= total) setIndex(Math.max(0, total - 1));
  }, [total, index]);

  const move = useCallback(
    (delta: number, wrap = true) => {
      setIndex((current) => {
        if (total === 0) return 0;
        const next = current + delta;
        if (next < 0) return wrap ? total - 1 : 0;
        if (next >= total) return wrap ? 0 : total - 1;
        return next;
      });
    },
    [total],
  );

  return {
    index: Math.min(index, Math.max(0, total - 1)),
    setIndex,
    move,
    first: () => setIndex(0),
    last: () => setIndex(Math.max(0, total - 1)),
  };
}

// ── Misc ──────────────────────────────────────────────────────────

/** Debounces a rapidly changing value, e.g. a search box. */
export function useDebounced<T>(value: T, delayMs = 150): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Frame counter for spinners, shared so N spinners cost one timer. */
export function useSpinnerFrame(intervalMs = 80, isActive = true): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setFrame((f) => f + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, isActive]);
  return frame;
}

/** Exits the app, used by the quit binding. */
export function useQuit(): (error?: Error) => void {
  const { exit } = useApp();
  return useCallback((error) => exit(error), [exit]);
}
