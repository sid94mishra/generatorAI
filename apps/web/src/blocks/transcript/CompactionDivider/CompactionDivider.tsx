// ────────────────────────────────────────────────────────────────
// CompactionDivider — where a conversation was compacted (docs/compaction).
//
// A transcript row between the turns the agent no longer remembers in full
// and the ones after: "Conversation compacted · 150K → 20K tokens", with the
// summary it continues from behind a toggle when the provider exposed one.
// Rendered from a `system` row carrying `metadata.compaction`, so it is the
// same after a reload as when it happened.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { describeCompaction, type CompactionRecord } from '@generatorai/shared';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Reveal } from '@/ui/primitives/Collapsible/Collapsible.js';
import { Separator } from '@/ui/primitives/Separator/Separator.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';

export interface CompactionDividerProps {
  record: CompactionRecord;
}

export function CompactionDivider({ record }: CompactionDividerProps) {
  const [open, setOpen] = useState(false);
  const summary = record.summary?.trim();
  return (
    <div className="flex flex-col gap-2" data-chat-row data-gai-block="compaction" data-testid="compaction-divider">
      <div className="flex min-w-0 items-center gap-2">
        <Separator className="min-w-4 flex-1" />
        <span className="flex shrink-0 items-center gap-1.5 text-small text-fg-3">
          <Icon concept="compact" size={14} />
          <span>{describeCompaction(record)}</span>
        </span>
        {summary ? (
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="compaction-summary-toggle">
            {open ? 'Hide summary' : 'Summary'}
          </Button>
        ) : null}
        <Separator className="min-w-4 flex-1" />
      </div>
      {summary ? (
        <Reveal open={open}>
          <div className="rounded-card border border-line-soft bg-raised px-3 py-2" data-testid="compaction-summary">
            <Markdown size="compact">{summary}</Markdown>
          </div>
        </Reveal>
      ) : null}
    </div>
  );
}
