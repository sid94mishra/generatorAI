// ────────────────────────────────────────────────────────────────
// VoiceRecorder — mic button + live recording pill.
//
// Idle: a mic icon button. While recording it morphs into the pill from
// the reference design — a live waveform (driven by real mic amplitude)
// with a cancel (✕) and accept (✓) control. Transcripts are pushed up
// via onInterim/onFinal so the parent can fill the chat input in real
// time.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, X, Check, Loader2 } from 'lucide-react';
import { useSpeechToText } from '@/hooks/useSpeechToText.js';
import { cn } from '@/lib/utils.js';

const BAR_COUNT = 18;

interface VoiceRecorderProps {
  disabled?: boolean;
  /** Live transcript while speaking. */
  onInterim: (text: string) => void;
  /** Final transcript after the user accepts / stops. */
  onFinal: (text: string) => void;
  /** Called when recording starts (e.g. to snapshot current input). */
  onStart?: () => void;
  /** Called on error with a user-facing message. */
  onError?: (message: string) => void;
}

export function VoiceRecorder({ disabled, onInterim, onFinal, onStart, onError }: VoiceRecorderProps) {
  const { isSupported, status, error, amplitude, start, stop, cancel } = useSpeechToText({
    onInterim,
    onFinal,
    onError,
  });

  // Rolling waveform levels — newest on the right, scrolls like the image.
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0.05));
  const levelsRef = useRef(levels);
  levelsRef.current = levels;

  useEffect(() => {
    if (status !== 'listening') return;
    const next = levelsRef.current.slice(1);
    // Add a little idle floor so bars are visible even when quiet.
    next.push(Math.max(0.06, amplitude));
    setLevels(next);
  }, [amplitude, status]);

  useEffect(() => {
    if (status === 'idle' || status === 'error') {
      setLevels(new Array(BAR_COUNT).fill(0.05));
    }
  }, [status]);

  const handleStart = useCallback(async () => {
    onStart?.();
    await start();
  }, [onStart, start]);

  const active = status === 'connecting' || status === 'listening' || status === 'transcribing';

  // ── Active recording pill ──────────────────────────────────────
  if (active) {
    return (
      <div
        className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] pl-2.5 pr-1 py-1"
        role="group"
        aria-label="Recording voice input"
      >
        {status === 'connecting' || status === 'transcribing' ? (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {status === 'connecting' ? 'Listening…' : 'Transcribing…'}
          </span>
        ) : (
          <div className="flex h-5 items-center gap-[2px]" aria-hidden="true">
            {levels.map((lvl, i) => (
              <span
                key={i}
                className="w-[2.5px] rounded-full bg-[var(--color-primary)] transition-[height] duration-75"
                style={{ height: `${Math.max(10, Math.min(100, lvl * 100))}%` }}
              />
            ))}
          </div>
        )}

        {/* Cancel */}
        <button
          type="button"
          onClick={cancel}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition-colors"
          title="Cancel voice input"
          aria-label="Cancel voice input"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Accept / stop */}
        <button
          type="button"
          onClick={stop}
          disabled={status !== 'listening'}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground,#fff)] hover:opacity-90 active:scale-[0.93] disabled:opacity-50 transition-all"
          title="Stop and insert text"
          aria-label="Stop and insert text"
        >
          <Check className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ── Idle mic button ────────────────────────────────────────────
  if (!isSupported) return null;

  return (
    <button
      type="button"
      onClick={handleStart}
      disabled={disabled}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-50',
        status === 'error'
          ? 'text-[var(--color-destructive,#ef4444)] hover:bg-[var(--color-accent)]'
          : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]',
      )}
      title={error ?? 'Voice input'}
      aria-label="Start voice input"
    >
      <Mic className="h-4 w-4" />
    </button>
  );
}
