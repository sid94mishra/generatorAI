// ────────────────────────────────────────────────────────────────
// CompactionDivider — where a conversation was compacted (docs/compaction).
//
// A transcript row between the turns the agent no longer remembers in full
// and the ones after: "Conversation compacted · 150K → 20K tokens". When the
// provider exposed the summary it continues from, "Summary" opens it in a
// dialog — a summary runs to pages, and unfolded in the transcript it pushed
// the turns after it out of view. Rendered from a `system` row carrying
// `metadata.compaction`, so it is the same after a reload as when it happened.
// ────────────────────────────────────────────────────────────────

import { describeCompaction, type CompactionRecord } from '@generatorai/shared';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Dialog, DialogBody, DialogClose, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { Separator } from '@/ui/primitives/Separator/Separator.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';

export interface CompactionDividerProps {
  record: CompactionRecord;
}

export function CompactionDivider({ record }: CompactionDividerProps) {
  const summary = record.summary?.trim();
  const description = describeCompaction(record);
  return (
    <div className="flex min-w-0 items-center gap-2" data-chat-row data-gai-block="compaction" data-testid="compaction-divider">
      <Separator className="min-w-4 flex-1" />
      <span className="flex shrink-0 items-center gap-1.5 text-small text-fg-3">
        <Icon concept="collapse-all" size={14} />
        <span>{description}</span>
      </span>
      {summary ? (
        <Dialog
          size="md"
          title="Compaction summary"
          trigger={
            <Button variant="ghost" size="sm" data-testid="compaction-summary-toggle">
              Summary
            </Button>
          }
          data-testid="compaction-summary-dialog"
        >
          <DialogBody>
            <div data-testid="compaction-summary">
              <Markdown>{summary}</Markdown>
            </div>
          </DialogBody>
          <DialogFooter hint={`${description} · the agent continues from this summary`}>
            <DialogClose render={<Button variant="secondary" size="sm" />}>Close</DialogClose>
          </DialogFooter>
        </Dialog>
      ) : null}
      <Separator className="min-w-4 flex-1" />
    </div>
  );
}
