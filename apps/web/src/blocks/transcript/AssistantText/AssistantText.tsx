// ────────────────────────────────────────────────────────────────
// B-19 AssistantText — the agent's prose: Streamdown 2 (incomplete markdown
// is repaired while it streams) with fenced code on the kit's lazy Shiki 4
// CodeBlock (themes from `--syntax-*`), 14/1.6 prose, a 2px caret while
// streaming (D-33), revealed at a steady pace while it streams (D-91). The
// markdown itself is the kit `Markdown` pattern.
// ────────────────────────────────────────────────────────────────

import { memo, useRef } from 'react';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';
import { useTranscriptActions } from '../transcriptContext.js';
import { usePacedText } from './usePacedText.js';
import { useRevealFade } from './useRevealFade.js';

export interface AssistantTextProps {
  /** Markdown source (may be incomplete while streaming). */
  text: string;
  streaming?: boolean;
}

/** One answer segment of an agent response. */
export const AssistantText = memo(function AssistantText({ text, streaming = false }: AssistantTextProps) {
  // Streaming text is revealed at a steady pace (D-91); the full text is shown
  // the moment the turn ends, the reader scrolls away or the view mode changes.
  const ctx = useTranscriptActions();
  const shown = usePacedText(text, streaming, { paced: ctx.pacing, flushKey: ctx.viewMode });
  // …and the newest words fade in (colour only, no layout shift).
  const ref = useRef<HTMLDivElement>(null);
  useRevealFade(ref, streaming && ctx.pacing !== false);
  return (
    <div
      ref={ref}
      className="min-w-0"
      data-gai-block="text"
      aria-live={streaming ? 'polite' : undefined}
      aria-busy={streaming || undefined}
    >
      <Markdown streaming={streaming}>{shown}</Markdown>
    </div>
  );
});
