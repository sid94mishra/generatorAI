// ────────────────────────────────────────────────────────────────
// B-19 AssistantText — the agent's prose: Streamdown 2 (incomplete markdown
// is repaired while it streams) with fenced code on the kit's lazy Shiki 4
// CodeBlock (themes from `--syntax-*`), 14/1.6 prose, a 2px caret while
// streaming (D-33). The markdown itself is the kit `Markdown` pattern.
// ────────────────────────────────────────────────────────────────

import { memo } from 'react';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';

export interface AssistantTextProps {
  /** Markdown source (may be incomplete while streaming). */
  text: string;
  streaming?: boolean;
}

/** One answer segment of an agent response. */
export const AssistantText = memo(function AssistantText({ text, streaming = false }: AssistantTextProps) {
  return (
    <div
      className="min-w-0"
      data-gai-block="text"
      aria-live={streaming ? 'polite' : undefined}
      aria-busy={streaming || undefined}
    >
      <Markdown streaming={streaming}>{text}</Markdown>
    </div>
  );
});
