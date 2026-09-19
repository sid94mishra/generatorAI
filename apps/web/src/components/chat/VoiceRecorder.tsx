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
import { Mic, X, Check, Pause } from 'lucide-react';
import type { SttStatus } from '@/hooks/useSpeechToText.js';
import { Button, Spinner } from '@/components/ui/index.js';
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
  /**
   * Name of the microphone this will record from, when it is not simply the
   * system default. Shown in the button's tooltip so the choice made in
   * Settings is verifiable from where dictation actually starts, rather than
   * being a setting the user has to go back and re-read to confirm.
   */
  deviceLabel?: string;
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
  deviceLabel,
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
            <Spinner size="sm" label={status === 'connecting' ? 'Listening' : 'Transcribing'} />
            {status === 'connecting' ? 'Listening…' : 'Transcribing…'}
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            {status === 'paused' && (
              <Button
                type="button"
                variant="ghost"
                onClick={onResume}
                className="h-auto w-auto gap-1 p-0 text-[10px] font-medium text-[var(--color-muted-foreground)] hover:bg-transparent hover:text-[var(--color-foreground)] transition-colors"
                title="Paused — speak again, or click to resume"
                aria-label="Resume dictation"
              >
                <Pause className="h-3 w-3" />
                Paused
              </Button>
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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onCancel}
          className="rounded-full hover:bg-[var(--color-accent)]"
          title="Cancel voice input"
          aria-label="Cancel voice input"
        >
          <X className="h-4 w-4" />
        </Button>

        {/* Accept / stop */}
        <Button
          type="button"
          variant="primary"
          size="icon-sm"
          onClick={onStop}
          disabled={status !== 'listening' && status !== 'paused'}
          className="rounded-full bg-[var(--color-primary)] active:scale-[0.93]"
          title="Stop and insert text"
          aria-label="Stop and insert text"
        >
          <Check className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // ── Idle mic button ────────────────────────────────────────────
  if (!isSupported) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onStart}
      disabled={disabled}
      className={cn(
        'h-8 w-8 rounded-full hover:bg-[var(--color-accent)]',
        status === 'error' && 'text-[var(--color-destructive,#ef4444)] hover:text-[var(--color-destructive,#ef4444)]',
      )}
      title={error ?? (deviceLabel ? `Voice input — ${deviceLabel}` : 'Voice input')}
      aria-label="Start voice input"
    >
      <Mic className="h-4 w-4" />
    </Button>
  );
}
