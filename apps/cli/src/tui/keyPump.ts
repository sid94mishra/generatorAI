// Paces terminal input so one read never becomes one keypress.
//
// Terminals coalesce: type `^K` and a search term quickly, or run over SSH or
// a pty, and every byte lands in a single `data` event. Ink turns that event
// into one `useInput` call, so the keymap sees a chord like "\x0bworkflow"
// and matches nothing — the app looks frozen.
//
// Splitting inside a key handler is not enough. The keys after `^K` still
// resolve against the contexts captured before the palette opened, because
// React cannot re-render in the middle of a synchronous loop, so `f` fires
// "filter" in a list that is no longer on screen. Pacing the bytes into Ink
// one keypress per macrotask lets the tree settle between them, and newly
// mounted components receive the keys meant for them.

import { PassThrough } from 'node:stream';

const PASTE_START = '\u001B[200~';
const PASTE_END = '\u001B[201~';

/**
 * Splits a chunk into the units Ink should see as individual keypresses.
 *
 * Escape sequences and bracketed-paste blocks stay whole: their boundaries
 * are the terminal's to define, and a paste is one event by design.
 */
export function splitKeys(chunk: string): string[] {
  const keys: string[] = [];
  let index = 0;

  while (index < chunk.length) {
    if (chunk.startsWith(PASTE_START, index)) {
      const end = chunk.indexOf(PASTE_END, index);
      const stop = end === -1 ? chunk.length : end + PASTE_END.length;
      keys.push(chunk.slice(index, stop));
      index = stop;
      continue;
    }

    if (chunk[index] === '\u001B') {
      // Consume one escape sequence: ESC, an optional intermediate, then
      // parameters up to a final byte. A lone ESC (Escape pressed) is fine —
      // the loop below simply finds no final byte and takes the rest.
      let end = index + 1;
      if (chunk[end] === '[' || chunk[end] === 'O') {
        end++;
        while (end < chunk.length && /[0-9;?]/.test(chunk[end]!)) end++;
        if (end < chunk.length) end++;
      } else if (end < chunk.length) {
        end++; // Alt+key
      }
      keys.push(chunk.slice(index, end));
      index = end;
      continue;
    }

    // Surrogate pairs and combining marks must not be torn in half.
    const point = String.fromCodePoint(chunk.codePointAt(index)!);
    keys.push(point);
    index += point.length;
  }

  return keys;
}

export interface KeyPump {
  /** The stream to hand to Ink in place of the real stdin. */
  readonly stream: NodeJS.ReadStream;
  stop(): void;
}

/**
 * Wraps a stdin stream so consumers receive one keypress per event.
 *
 * The returned stream proxies `setRawMode`, `ref` and `unref` to the source:
 * Ink drives raw mode through the stream it was given, and keeps a reference
 * on it to hold the event loop open.
 */
export function createKeyPump(source: NodeJS.ReadStream): KeyPump {
  const stream = new PassThrough() as unknown as NodeJS.ReadStream & PassThrough;
  stream.isTTY = source.isTTY;
  stream.setRawMode = (mode: boolean) => {
    source.setRawMode?.(mode);
    return stream;
  };
  stream.ref = () => {
    source.ref?.();
    return stream;
  };
  stream.unref = () => {
    source.unref?.();
    return stream;
  };

  const queue: string[] = [];
  let draining = false;
  let stopped = false;

  const drain = (): void => {
    if (stopped) return;
    const next = queue.shift();
    if (next === undefined) {
      draining = false;
      return;
    }
    stream.write(next);
    // A macrotask, not a microtask: React's render and Ink's write to the
    // terminal both need to complete before the next key is interpreted.
    setTimeout(drain, 0);
  };

  const onData = (chunk: Buffer | string): void => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const keys = splitKeys(text);
    // The overwhelmingly common case is a single keypress; forwarding it
    // straight through keeps typing latency at zero.
    if (keys.length === 1 && queue.length === 0 && !draining) {
      stream.write(text);
      return;
    }
    queue.push(...keys);
    if (!draining) {
      draining = true;
      setTimeout(drain, 0);
    }
  };

  source.on('data', onData);

  return {
    stream,
    stop: () => {
      stopped = true;
      queue.length = 0;
      source.off('data', onData);
    },
  };
}
