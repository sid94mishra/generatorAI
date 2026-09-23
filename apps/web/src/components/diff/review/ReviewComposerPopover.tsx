// ────────────────────────────────────────────────────────────────
// ReviewComposerPopover — write a comment on the selected lines
// ────────────────────────────────────────────────────────────────
//
// Opened from the diff gutter or a keyboard-accessible file-header action.
// Header actions expose editable line bounds; gutter actions use the selection.
//
// Floats next to the selection rather than docking at the top of the panel.
// A docked composer forces the reader to look away from the code they just
// selected, and on a tall diff the selection can be scrolled out of view
// entirely by the time the box appears — which is exactly when a comment is
// most likely to end up describing the wrong lines.

import { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button, Input, Textarea } from '@/components/ui/index.js';
import type { ReviewIntent } from '@/types/review.js';
import { FloatingCard } from './FloatingCard.js';
import { modEnterLabel } from '@/components/ui/Kbd.js';

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
  lineCount?: number;
  onRangeChange?: (start: number, end: number) => void;
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
  lineCount,
  onRangeChange,
}: ReviewComposerPopoverProps) {
  const [body, setBody] = useState('');
  const [intent, setIntent] = useState<ReviewIntent>('fix');
  const [startLine, setStartLine] = useState(String(range.start));
  const [endLine, setEndLine] = useState(String(range.end));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const validRange = !onRangeChange || (Number.isSafeInteger(Number(startLine))
    && Number.isSafeInteger(Number(endLine)) && Number(startLine) >= 1
    && Number(endLine) >= Number(startLine) && Number(endLine) <= (lineCount ?? 0));
  const canSubmit = body.trim().length > 0 && !busy && validRange;

  const updateRange = (start: string, end: string) => {
    setStartLine(start); setEndLine(end);
    if (Number.isSafeInteger(Number(start)) && Number.isSafeInteger(Number(end))
      && Number(start) >= 1 && Number(end) >= Number(start) && Number(end) <= (lineCount ?? 0)) {
      onRangeChange?.(Number(start), Number(end));
    }
  };

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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Cancel"
          onClick={onCancel}
          className="h-5 w-5 shrink-0"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      <div className="p-2.5">
        {onRangeChange && (
          <div className="mb-2">
            <div className="flex gap-2">
              <label className="min-w-0 flex-1 text-xs">Start line
                <Input type="number" min={1} max={lineCount} value={startLine}
                  aria-invalid={!validRange} onChange={(e) => updateRange(e.target.value, endLine)} />
              </label>
              <label className="min-w-0 flex-1 text-xs">End line
                <Input type="number" min={1} max={lineCount} value={endLine}
                  aria-invalid={!validRange} onChange={(e) => updateRange(startLine, e.target.value)} />
              </label>
            </div>
            {!validRange && <p role="alert" className="mt-1 text-xs text-danger">Choose an ordered range from 1 to {lineCount}.</p>}
          </div>
        )}
        {anchorPreview && (
          <pre className="mb-1.5 max-h-20 overflow-auto rounded bg-muted/50 p-1.5 font-mono text-[10px] leading-tight">
            {anchorPreview}
          </pre>
        )}

        <div className="mb-1.5 flex flex-wrap gap-1">
          {INTENTS.map((i) => (
            <Button
              key={i.value}
              type="button"
              variant="ghost"
              title={i.hint}
              aria-pressed={intent === i.value}
              onClick={() => setIntent(i.value)}
              className={cn(
                'h-auto rounded border px-1.5 py-0.5 text-[10px] font-normal text-foreground hover:bg-accent hover:text-foreground',
                intent === i.value &&
                  'border-primary bg-primary/15 font-medium text-primary hover:bg-primary/15 hover:text-primary',
              )}
            >
              {i.label}
            </Button>
          ))}
        </div>

        <Textarea
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
          placeholder={`What should the agent change here? (${modEnterLabel()} to add)`}
          aria-label="Review comment"
          className="resize-none px-2 py-1.5 text-xs"
        />

        <div className="mt-1.5 flex items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canSubmit}
            loading={busy}
            onClick={() => onSubmit(body.trim(), intent)}
          >
            Add comment
          </Button>
          {onSubmitAndSend && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!canSubmit}
              onClick={() => onSubmitAndSend(body.trim(), intent)}
              title="Add this comment and send it to the agent now"
              leftIcon={<Send className="h-3 w-3" />}
            >
              Add &amp; send
            </Button>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">Esc to cancel</span>
        </div>
      </div>
    </FloatingCard>
  );
}
