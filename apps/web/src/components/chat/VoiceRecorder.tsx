// ────────────────────────────────────────────────────────────────
// VoiceRecorder — mic button + live recording pill.
//
// Idle: a mic icon button. While recording it morphs into the pill from
// the reference design — a live waveform (driven by real mic amplitude)
// with a cancel (✕) and accept (✓) control. Paused (Phase 1): the waveform
// is replaced by an explicit "click to resume" affordance — Part C.3 of
// VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md deliberately specifies resume as
// an explicit user action, never ambient auto-resume-on-detected-speech.
//
// Phase 1 — this component is now purely presentational: `useSpeechToText`
// is owned by the parent (ChatInput) instead of here, because pausing on
// manual composer interaction (Part C.3) requires the composer itself to
// call `pause()` — a component that owns its own hook instance privately
// can't be reached from outside for that. See ChatInput.tsx's "Voice input"
// section for the hook wiring this component now just renders.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { Mic, X, Check, Loader2, Pause } from 'lucide-react';
import type { SttStatus } from '@/hooks/useSpeechToText.js';
import { cn } from '@/lib/utils.js';

const BAR_COUNT = 18;
/**
 * How often the waveform shifts one bar to the left. 20fps over 18 bars shows
 * roughly the last 0.9s of speech.
 *
 * The waveform used to advance from an effect keyed on `amplitude`, so it only
 * moved when that value happened to change AND React happened to re-render —
 * React 18 auto-batches the `setAmplitude` calls coming from the hook's
 * requestAnimationFrame loop, and bails out entirely when a frame produces a
 * bit-identical value. The result was a meter that animated during some
 * phrases and sat frozen through others. A fixed clock reading the LATEST
 * amplitude from a ref decouples "how often the bar scrolls" from "how often
 * React re-rendered", so it moves for the whole utterance.
 */
const WAVEFORM_TICK_MS = 50;

interface VoiceRecorderProps {
  disabled?: boolean;
  isSupported: boolean;
  status: SttStatus;
  error: string | null;
  /** 0..1 mic loudness for the waveform. */
  amplitude: number;
  onStart: () => void;
  /** Explicit resume action (Part C.3 — never ambient/automatic). */
  onResume: () => void;
  onStop: () => void;
  onCancel: () => void;
}

export function VoiceRecorder({
  disabled,
  isSupported,
  status,
  error,
  amplitude,
  onStart,
  onResume,
  onStop,
  onCancel,
}: VoiceRecorderProps) {
  // Rolling waveform levels — newest on the right, scrolls like the image.
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0.05));
  /** Latest amplitude, read by the tick without making it a hook dependency. */
  const amplitudeRef = useRef(amplitude);
  amplitudeRef.current = amplitude;

  // Runs while paused too: pause is now usually a brief gap in the middle of
  // an utterance (the user speaks again and it resumes itself), so freezing
  // the meter there just made it look broken.
  const live = status === 'listening' || status === 'paused';
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      setLevels((prev) => {
        const next = prev.slice(1);
        // A small floor so the bar reads as "listening", not "dead".
        next.push(Math.max(0.06, amplitudeRef.current));
        return next;
      });
    }, WAVEFORM_TICK_MS);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    if (status === 'idle' || status === 'error') {
      setLevels(new Array(BAR_COUNT).fill(0.05));
    }
  }, [status]);

  const active = status === 'connecting' || status === 'listening' || status === 'paused' || status === 'transcribing';

  // ── Active recording pill ──────────────────────────────────────
  if (active) {
    return (
      <div
        className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] pl-2.5 pr-1 py-1"
        role="group"
        aria-label={status === 'paused' ? 'Voice input paused' : 'Recording voice input'}
      >
        {status === 'connecting' || status === 'transcribing' ? (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {status === 'connecting' ? 'Listening…' : 'Transcribing…'}
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            {status === 'paused' && (
              <button
                type="button"
                onClick={onResume}
                className="flex items-center gap-1 text-[10px] font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
                title="Paused — speak again, or click to resume"
                aria-label="Resume dictation"
              >
                <Pause className="h-3 w-3" />
                Paused
              </button>
            )}
            {/* Dimmed rather than replaced while paused: the meter is how the
                user can tell the mic is still live and that speaking will pick
                dictation back up. */}
            <div
              className={cn('flex h-5 items-center gap-[2px]', status === 'paused' && 'opacity-40')}
              aria-hidden="true"
            >
              {levels.map((lvl, i) => (
                <span
                  key={i}
                  className="w-[2.5px] rounded-full bg-[var(--color-primary)] transition-[height] duration-75"
                  style={{ height: `${Math.max(10, Math.min(100, lvl * 100))}%` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Cancel */}
        <button
          type="button"
          onClick={onCancel}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition-colors"
          title="Cancel voice input"
          aria-label="Cancel voice input"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Accept / stop */}
        <button
          type="button"
          onClick={onStop}
          disabled={status !== 'listening' && status !== 'paused'}
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
      onClick={onStart}
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
