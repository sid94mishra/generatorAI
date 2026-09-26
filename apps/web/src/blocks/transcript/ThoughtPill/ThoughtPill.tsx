// ────────────────────────────────────────────────────────────────
// B-16 ThoughtPill — the agent's reasoning, folded: a ghost row "Thought"
// ("Thinking…" while it streams) that expands to the reasoning text.
//
// The board's "Thought for 12s" needs a reasoning duration the stream does not
// carry (thinking blocks have no timing); it is not rendered until it does
// (D-36) — the pill says "Thought".
// ────────────────────────────────────────────────────────────────

import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';
import { Collapsible } from '@/ui/primitives/Collapsible/Collapsible.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';

export interface ThoughtPillProps {
  /** Reasoning text (plain; rendered pre-wrapped). */
  text: string;
  /** Still streaming. */
  live?: boolean;
  /** Start expanded (Verbose mode). */
  defaultOpen?: boolean;
  /** Formatted reasoning duration, when the provider reports one. */
  duration?: string;
}

/** Folded reasoning: "Thought" / "Thinking…" → the reasoning text. */
export function ThoughtPill({ text, live = false, defaultOpen = false, duration }: ThoughtPillProps) {
  const label = live ? TRANSCRIPT_COPY.thinking : duration ? TRANSCRIPT_COPY.thoughtFor(duration) : TRANSCRIPT_COPY.thought;
  return (
    <div data-gai-block="thinking" data-testid="thought-pill">
      <Collapsible
        variant="disclosure"
        defaultOpen={defaultOpen}
        trigger={
          <span className="inline-flex items-center gap-1.5 text-ui text-fg-2">
            {label}
            {live ? <Spinner size={12} className="text-fg-3" /> : null}
          </span>
        }
      >
        <p className="max-h-65 overflow-auto border-l border-line pl-3 text-ui break-words whitespace-pre-wrap text-fg-2">
          {text}
        </p>
      </Collapsible>
    </div>
  );
}

/** The pending state of a turn that has produced nothing yet: "Claude is thinking". */
export function ThinkingPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-step items-center gap-2 pl-0.5 text-ui text-fg-2" data-testid="thinking-placeholder" role="status">
      <Spinner size={14} className="text-run" />
      <span>{label}</span>
    </div>
  );
}
