// ────────────────────────────────────────────────────────────────
// Voice output — read a message aloud, and speak a turn as it is written.
//
// WHAT CHANGED, AND WHY
// ---------------------
// This used to collect EVERY PCM chunk of an utterance, write one WAV, and
// only then start playing — because `expo-audio` has no raw-PCM streaming
// playback primitive (still true: `AudioStream` is microphone CAPTURE only).
// That is tolerable for a short message and useless for Phase 4, where the
// agent is still generating and "the whole utterance" does not exist yet.
//
// The fix is to cut the stream somewhere, and the server now says where:
// `tts-ws` emits `{ t: 'sentence' }` immediately before each sentence's
// audio (see TtsSessionRunner's `onSentence`). So one WAV file is written
// per SENTENCE and appended to a native `AudioPlaylist`, which plays the
// files back-to-back itself.
//
// Sentences are the right cut point, and the reason is audible: any
// file-boundary gap lands where a speaker would pause anyway, instead of
// mid-word. Fixed-size batching — the obvious alternative — puts that gap
// at an arbitrary point inside a word. Using the native playlist rather
// than chaining `player.replace()` calls in JS also keeps the gap off the
// JS thread entirely.
//
//   web     Web Audio schedules PCM chunks gaplessly, ignores the marker
//   mobile  one WAV per sentence, queued natively, first sentence starts
//           playing while the rest are still being synthesized
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { setAudioModeAsync, useAudioPlaylist } from 'expo-audio';
import { useAuth } from '../auth/AuthProvider';
import { assembleWavBytes, buildWavHeader, floatChunksToInt16 } from './wavEncoding';
import { PLAYBACK_AUDIO_MODE } from './audioSession';

/**
 * Put the shared audio session into playback mode. Dictation leaves it in
 * record mode (receiver routing, and silent under the ring switch on iOS),
 * so this runs before EVERY utterance rather than once. A failure is not
 * fatal — playback is attempted in whatever mode the session is in.
 */
async function enterPlaybackMode(): Promise<void> {
  try {
    await setAudioModeAsync(PLAYBACK_AUDIO_MODE);
  } catch {
    /* unsupported on this platform, or the session is busy */
  }
}

export type TtsStatus = 'idle' | 'synthesizing' | 'speaking' | 'error';

export interface TextToSpeech {
  status: TtsStatus;
  error: string | null;
  /**
   * Read a finished message aloud (Phase 3). Resolves once playback has
   * STARTED (not once it finishes) or the request failed/was cancelled.
   * Resolves to the error message on failure, `null` otherwise — returned
   * directly rather than left for the caller to read back off
   * `error`/`status`, since those only update on the NEXT render and would
   * read stale immediately after this resolves.
   */
  speak: (text: string) => Promise<string | null>;
  /**
   * Phase 4 — speak this chat SESSION's agent output live, sentence by
   * sentence, as it is generated. `sessionId` is the chat's `sessionId`
   * (the EventBus channel), not its chat id. Resolves when the turn ends.
   */
  speakStream: (sessionId: string) => Promise<string | null>;
  /** Barge-in — stop playback and any in-flight synthesis immediately. */
  stop: () => void;
}

/** The one frame that differs between the two entry points. */
type SpeakFrame = { t: 'speak'; text: string } | { t: 'speak_stream'; sessionId: string };

export function useTextToSpeech(): TextToSpeech {
  const { socketUrl } = useAuth();
  const playlist = useAudioPlaylist();
  const [status, setStatus] = useState<TtsStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  /**
   * A monotonic token, not a plain boolean. A `speak()` captures the value
   * it bumped this to; anything that later makes THIS session stale —
   * `stop()`, or a newer speak barging over it — bumps the counter again.
   * Checking `sessionRef.current !== mySession` is what lets a stale
   * rejection from an old, stopped session be told apart from a genuine
   * failure of whichever session is current now, which a single shared
   * `cancelled` boolean cannot do once a newer session has reset it.
   */
  const sessionRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  /** Every temp WAV this session has written, so all of them can be removed. */
  const filesRef = useRef<File[]>([]);

  const deleteFiles = useCallback(() => {
    const files = filesRef.current;
    filesRef.current = [];
    for (const file of files) {
      try {
        file.delete();
      } catch {
        /* already gone */
      }
    }
  }, []);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    const ws = socketRef.current;
    socketRef.current = null;
    if (ws) {
      // Barge in on the SERVER too: without this it keeps synthesizing the
      // whole stopped utterance for nothing.
      try {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'stop' }));
      } catch {
        /* ignore */
      }
      try {
        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
      } catch {
        /* ignore */
      }
    }
    try {
      playlist.pause();
      playlist.clear();
    } catch {
      /* nothing queued */
    }
    deleteFiles();
    setStatus('idle');
  }, [playlist, deleteFiles]);

  const run = useCallback(
    async (frame: SpeakFrame): Promise<string | null> => {
      // Bumping (rather than resetting) IS the barge-in: it invalidates
      // whatever call, if any, is already in flight — same as `stop()`.
      const mySession = (sessionRef.current += 1);
      const isCancelled = (): boolean => sessionRef.current !== mySession;

      // A previous utterance's queue and temp files must go before this one
      // starts appending to the same playlist.
      try {
        playlist.pause();
        playlist.clear();
      } catch {
        /* nothing queued */
      }
      deleteFiles();

      setError(null);
      setStatus('synthesizing');
      try {
        await enterPlaybackMode();
        if (isCancelled()) return null;
        const url = await socketUrl('/api/tts/stream', 'tts', null);
        if (isCancelled()) return null;
        await streamSentences(url, frame, isCancelled, socketRef, filesRef, () => {
          // First sentence is queued — start playing while the rest are
          // still being synthesized. That overlap is the entire point.
          if (isCancelled()) return;
          try {
            playlist.play();
          } catch {
            /* playlist went away */
          }
          setStatus('speaking');
        }, playlist);
        if (isCancelled()) return null;
        return null;
      } catch (err) {
        if (isCancelled()) return null; // superseded — leave status to whoever is current
        const message = (err as Error).message;
        setStatus('error');
        setError(message);
        return message;
      }
    },
    [socketUrl, playlist, deleteFiles],
  );

  const speak = useCallback(
    (text: string): Promise<string | null> => {
      if (!text.trim()) return Promise.resolve(null);
      return run({ t: 'speak', text });
    },
    [run],
  );

  const speakStream = useCallback(
    (sessionId: string): Promise<string | null> => {
      if (!sessionId) return Promise.resolve(null);
      return run({ t: 'speak_stream', sessionId });
    },
    [run],
  );

  // A screen that unmounts mid-utterance must not leak temp files or leave
  // the socket open.
  useEffect(
    () => () => {
      const ws = socketRef.current;
      socketRef.current = null;
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      deleteFiles();
    },
    [deleteFiles],
  );

  return { status, error, speak, speakStream, stop };
}

/** Minimal surface of `AudioPlaylist` this module drives. */
interface PlaylistLike {
  add(source: { uri: string }): void;
}

/**
 * Drive one TTS socket, writing a WAV per sentence and appending it to the
 * playlist as it completes. Resolves when the server says `done` (or the
 * socket closes); rejects on an error frame or transport failure.
 *
 * `socketRef` is written with this call's own socket so `stop()` — called
 * from OUTSIDE this promise — can reach it directly to barge in server-side
 * rather than leaving the server synthesizing for the full timeout.
 */
function streamSentences(
  url: string,
  frame: SpeakFrame,
  isCancelled: () => boolean,
  socketRef: { current: WebSocket | null },
  filesRef: { current: File[] },
  onFirstSentenceQueued: () => void,
  playlist: PlaylistLike,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    /** Chunks for the sentence currently being received. */
    let pending: ArrayBuffer[] = [];
    let sampleRate = 24_000; // replaced by the server's 'ready' frame before any audio
    let queued = 0;
    let settled = false;

    // A live `speak_stream` legitimately stays open for as long as the agent
    // keeps generating, so the timeout guards the CONNECTION, not the
    // utterance: it is cleared the moment the first audio arrives.
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(
      () => finish(new Error('Voice output timed out.')),
      30_000,
    );
    const clearTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    // Guarded so this can be called from more than one place — including
    // `onclose`, which fires for BOTH a server-initiated close and a
    // `stop()`-initiated one — without double-settling.
    function finish(result?: Error): void {
      if (settled) return;
      settled = true;
      clearTimer();
      if (socketRef.current === socket) socketRef.current = null;
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      if (result) reject(result);
      else resolve();
    }

    /** Write whatever has accumulated as one sentence, and queue it. */
    function flushSentence(): void {
      if (pending.length === 0) return;
      const chunks = pending;
      pending = [];
      const pcm16 = floatChunksToInt16(chunks);
      if (pcm16.length === 0) return;
      const bytes = assembleWavBytes(buildWavHeader(pcm16.byteLength, sampleRate), pcm16);
      const file = new File(Paths.cache, `tts-${Date.now()}-${queued}.wav`);
      file.create();
      file.write(bytes);
      filesRef.current.push(file);
      playlist.add({ uri: file.uri });
      queued += 1;
      if (queued === 1) onFirstSentenceQueued();
    }

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify(frame));
      } catch {
        /* ignore */
      }
    };

    socket.onmessage = (event) => {
      if (isCancelled()) return;
      if (typeof event.data !== 'string') {
        clearTimer(); // audio is flowing; the connection guard has done its job
        pending.push(event.data as ArrayBuffer);
        return;
      }
      let msg: { t?: string; sampleRate?: number; message?: string };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // ignore malformed frames
      }
      switch (msg.t) {
        case 'ready':
          if (msg.sampleRate) sampleRate = msg.sampleRate;
          break;
        case 'sentence':
          // The marker precedes its OWN sentence's audio, so what is pending
          // right now belongs to the sentence before it.
          try {
            flushSentence();
          } catch (err) {
            finish(err as Error);
          }
          break;
        case 'done':
          try {
            flushSentence();
            finish();
          } catch (err) {
            finish(err as Error);
          }
          break;
        case 'error':
          finish(new Error(msg.message ?? 'Voice output failed.'));
          break;
        default:
          break;
      }
    };

    socket.onerror = () => finish(new Error('Could not reach the voice output service.'));
    // `stop()` closes the socket directly rather than going through
    // `finish()` — this is the safety net that settles THIS promise when
    // that happens. Resolves rather than rejecting: `isCancelled()` being
    // true is what communicates "this was stopped", not the settled value.
    socket.onclose = () => finish();
  });
}
