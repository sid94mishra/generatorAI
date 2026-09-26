// ────────────────────────────────────────────────────────────────
// F-composer-12 — DictateButton + DictationStrip.
//
// Idle: `ib` "Start voice input" (hidden when speech is unsupported). While
// listening the control becomes the strip from ComposerStates "Dictation": a
// live 16-bar amplitude waveform (2px bars), × "Cancel voice input" and ✓
// "Stop and insert text". Paused (typing pauses listening) dims the waveform
// and offers an explicit "Resume dictation" — resume is never ambient. The
// engine lives in `useDictation`; this is the face.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import type { SttStatus } from '@/hooks/useSpeechToText.js';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';

const BAR_COUNT = 16;
/**
 * How often the waveform shifts one bar left (20 fps ≈ the last 0.8 s of
 * speech). A fixed clock reading the LATEST amplitude from a ref, so the
 * meter moves for the whole utterance even when React batches or skips the
 * amplitude re-renders.
 */
const WAVEFORM_TICK_MS = 50;

export interface DictationControlProps {
  disabled?: boolean;
  isSupported: boolean;
  status: SttStatus;
  error: string | null;
  /** 0..1 mic loudness. */
  amplitude: number;
  onStart: () => void;
  onResume: () => void;
  onStop: () => void;
  onCancel: () => void;
  /** The microphone in use when it is not the system default (shown in the tooltip). */
  deviceLabel?: string | undefined;
}

export function DictationControl({
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
}: DictationControlProps) {
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0.05));
  const amplitudeRef = useRef(amplitude);
  amplitudeRef.current = amplitude;

  const live = status === 'listening' || status === 'paused';
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      setLevels((prev) => [...prev.slice(1), Math.max(0.06, amplitudeRef.current)]);
    }, WAVEFORM_TICK_MS);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    if (status === 'idle' || status === 'error') setLevels(new Array(BAR_COUNT).fill(0.05));
  }, [status]);

  const active = status === 'connecting' || status === 'listening' || status === 'paused' || status === 'transcribing';

  if (active) {
    return (
      <div
        role="group"
        aria-label={status === 'paused' ? 'Voice input paused' : 'Recording voice input'}
        className="flex h-control items-center gap-1 rounded-control border border-line bg-surface pr-0.5 pl-2"
      >
        {status === 'connecting' || status === 'transcribing' ? (
          <span className="flex items-center gap-1.5 text-small text-fg-3">
            <Spinner size={12} />
            {status === 'connecting' ? 'Listening…' : 'Transcribing…'}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            {status === 'paused' ? (
              <Button variant="ghost" size="sm" icon="pause" onClick={onResume} aria-label="Resume dictation" className="px-1 text-micro">
                Paused
              </Button>
            ) : null}
            <span aria-hidden className={cn('flex h-control-sm items-center gap-0.5 py-1', status === 'paused' && 'opacity-40')}>
              {levels.map((lvl, i) => (
                <span
                  key={i}
                  className="w-0.5 rounded-badge bg-fg-2"
                  // Computed geometry: the bar height follows the live amplitude.
                  style={{ height: `${Math.max(12, Math.min(100, lvl * 100))}%` }}
                />
              ))}
            </span>
          </span>
        )}
        <IconButton icon="x" size="sm" label="Cancel voice input" tooltip={false} onClick={onCancel} />
        <IconButton
          icon="check"
          size="sm"
          label="Stop and insert text"
          tooltip={false}
          onClick={onStop}
          disabled={status !== 'listening' && status !== 'paused'}
          className="bg-selected text-fg"
        />
      </div>
    );
  }

  if (!isSupported) return null;

  return (
    <IconButton
      icon="mic"
      label="Start voice input"
      tooltip={false}
      title={error ?? (deviceLabel ? `Voice input — ${deviceLabel}` : 'Voice input')}
      onClick={onStart}
      disabled={disabled}
      className={cn(status === 'error' && 'text-err hover:not-disabled:text-err')}
    />
  );
}
