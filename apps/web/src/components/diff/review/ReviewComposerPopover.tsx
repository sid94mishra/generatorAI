// ────────────────────────────────────────────────────────────────
// ReviewComposerPopover — write a comment on the selected lines
// ────────────────────────────────────────────────────────────────
//
// Opened by the diff's gutter "+" button, which fires on pointer-up with the
// final selected range (a click = one line, a drag = the whole span).
//
// Floats next to the selection rather than docking at the top of the panel.
// A docked composer forces the reader to look away from the code they just
// selected, and on a tall diff the selection can be scrolled out of view
// entirely by the time the box appears — which is exactly when a comment is
// most likely to end up describing the wrong lines.

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import type { ReviewIntent } from '@/types/review.js';
import { FloatingCard } from './FloatingCard.js';

const INTENTS: Array<{ value: ReviewIntent; label: string; hint: string }> = [
  { value: 'fix', label: 'Fix', hint: 'Change the code as described' },
  { value: 'question', label: 'Question', hint: 'Answer; change only if needed' },
  { value: 'refactor', label: 'Refactor', hint: 'Restructure without behaviour change' },
  { value: 'test', label: 'Test', hint: 'Add or update tests' },
  { value: 'note', label: 'Note', hint: 'Context only; may need no change' },
];

export interface ReviewComposerPopoverProps {
  file: { path: string; alias: string };
  range: { start: number; end: number; side: 'additions' | 'deletions' };
  anchorPreview: string;
  /** Viewport point the selection was made at — the card pins beside it. */
  anchor: { x: number; y: number } | null;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (body: string, intent: ReviewIntent) => void;
  /** Submit and immediately send this single comment to the agent. */
  onSubmitAndSend?: (body: string, intent: ReviewIntent) => void;
}

export function ReviewComposerPopover({
  file,
  range,
  anchorPreview,
  anchor,
  busy,
  onCancel,
  onSubmit,
  onSubmitAndSend,
}: ReviewComposerPopoverProps) {
  const [body, setBody] = useState('');
  const [intent, setIntent] = useState<ReviewIntent>('fix');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const canSubmit = body.trim().length > 0 && !busy;

  return (
    <FloatingCard anchor={anchor} onDismiss={onCancel} label="Add review comment">
      <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5 text-[11px]">
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
          {file.alias !== '.' && `${file.alias}/`}
          {file.path}
          <span className="ml-1 text-foreground">
            {range.start === range.end
              ? `L${range.start}`
              : `L${range.start}–${range.end}`}
          </span>
        </span>
        <button
          type="button"
          aria-label="Cancel"
          onClick={onCancel}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="p-2.5">
        {anchorPreview && (
          <pre className="mb-1.5 max-h-20 overflow-auto rounded bg-muted/50 p-1.5 font-mono text-[10px] leading-tight">
            {anchorPreview}
          </pre>
        )}

        <div className="mb-1.5 flex flex-wrap gap-1">
          {INTENTS.map((i) => (
            <button
              key={i.value}
              type="button"
              title={i.hint}
              aria-pressed={intent === i.value}
              onClick={() => setIntent(i.value)}
              className={cn(
                'rounded border px-1.5 py-0.5 text-[10px] hover:bg-accent',
                intent === i.value &&
                  'border-primary bg-primary/15 font-medium text-primary',
              )}
            >
              {i.label}
            </button>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) {
              e.preventDefault();
              onSubmit(body.trim(), intent);
            }
          }}
          rows={3}
          placeholder="What should the agent change here? (⌘↵ to add)"
          className="w-full resize-none rounded border bg-transparent px-2 py-1.5 text-xs"
        />

        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(body.trim(), intent)}
            className="inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px] hover:bg-accent disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            Add comment
          </button>
          {onSubmitAndSend && (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => onSubmitAndSend(body.trim(), intent)}
              className="inline-flex h-6 items-center gap-1 rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              title="Add this comment and send it to the agent now"
            >
              <Send className="h-3 w-3" />
              Add &amp; send
            </button>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">Esc to cancel</span>
        </div>
      </div>
    </FloatingCard>
  );
}
