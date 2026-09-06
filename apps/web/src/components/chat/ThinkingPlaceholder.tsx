// ────────────────────────────────────────────────────────────────
// ThinkingPlaceholder — the gap between "sent" and the first block.
//
// One component for both places that used to draw it differently (ChatPage's
// pending state had no avatar; StreamingMessage's had a spinner in a blue
// disc), so the cue no longer changes shape a second after you hit Send.
//
// Deliberately quiet: a breathing orb, a label with a light sweeping across
// it, and two faint lines that stand in for the paragraph to come. No
// bouncing dots — those say "typing", and nothing is being typed yet.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { cn } from '@/lib/utils.js';

export function ThinkingPlaceholder({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('animate-block-in mt-3', className)} role="status" aria-live="polite" data-testid="thinking-placeholder">
      <div className="flex items-center gap-2.5">
        <span className="thinking-orb shrink-0" aria-hidden />
        <span className="text-shimmer text-[13px] font-medium">{label}…</span>
      </div>
      <div className="mt-3 max-w-md space-y-2" aria-hidden>
        <div className="skeleton-shimmer h-3 w-[72%] rounded-md opacity-70" />
        <div className="skeleton-shimmer h-3 w-[46%] rounded-md opacity-50" />
      </div>
    </div>
  );
}
