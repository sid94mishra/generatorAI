// ────────────────────────────────────────────────────────────────
// ReviewComposerPopover — write a comment on the selected lines (B-07)
// ────────────────────────────────────────────────────────────────
//
// Opened from the diff gutter or a keyboard-accessible file-header action.
// Header actions expose editable line bounds (`onRangeChange`); gutter
// actions use the selection.
//
// Floats next to the selection rather than docking at the top of the panel:
// a docked composer makes the reader look away from the code they just
// selected, and on a tall diff the selection can scroll out of view by the
// time the box appears — exactly when a comment is most likely to end up
// describing the wrong lines.

import { useState } from 'react';
import { reviewLineLabel, type ReviewIntent } from '@generatorai/shared';
import { Input } from '@/ui/primitives/Input/Input.js';
import { FloatingCard } from './FloatingCard.js';
import { ReviewCommentForm } from './ReviewCommentForm.js';

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

/** A 1-based, ordered range inside the file. */
function isValidRange(start: string, end: string, lineCount: number): boolean {
  const s = Number(start);
  const e = Number(end);
  return Number.isSafeInteger(s) && Number.isSafeInteger(e) && s >= 1 && e >= s && e <= lineCount;
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
  const [startLine, setStartLine] = useState(String(range.start));
  const [endLine, setEndLine] = useState(String(range.end));
  const validRange = !onRangeChange || isValidRange(startLine, endLine, lineCount ?? 0);

  const updateRange = (start: string, end: string) => {
    setStartLine(start);
    setEndLine(end);
    if (isValidRange(start, end, lineCount ?? 0)) onRangeChange?.(Number(start), Number(end));
  };

  return (
    <FloatingCard anchor={anchor} onDismiss={onCancel} label="Add review comment">
      <ReviewCommentForm
        label="Review comment"
        escapeCancels={false}
        busy={busy}
        ready={validRange}
        onCancel={onCancel}
        onSubmit={onSubmit}
        {...(onSubmitAndSend ? { onSubmitAndSend } : {})}
        context={
          <>
            {file.alias !== '.' && `${file.alias}/`}
            {file.path}
            <span className="ml-1.5 text-fg">{reviewLineLabel(range.start, range.end)}</span>
          </>
        }
        extra={
          onRangeChange ? (
            <div className="flex flex-col gap-1">
              <div className="flex gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-small text-fg-2">
                  Start line
                  <Input
                    type="number"
                    size="sm"
                    mono
                    min={1}
                    max={lineCount}
                    value={startLine}
                    invalid={!validRange}
                    onChange={(e) => updateRange(e.target.value, endLine)}
                  />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-small text-fg-2">
                  End line
                  <Input
                    type="number"
                    size="sm"
                    mono
                    min={1}
                    max={lineCount}
                    value={endLine}
                    invalid={!validRange}
                    onChange={(e) => updateRange(startLine, e.target.value)}
                  />
                </label>
              </div>
              {!validRange ? (
                <p role="alert" className="m-0 text-small text-err">
                  Choose an ordered range from 1 to {lineCount}.
                </p>
              ) : null}
            </div>
          ) : undefined
        }
        preview={
          anchorPreview ? (
            // Scrolls when the selection is long, so it must be reachable by keyboard.
            <pre
              tabIndex={0}
              role="region"
              aria-label="Selected lines"
              className="m-0 max-h-20 overflow-auto rounded-control border border-line-soft bg-sunken px-2 py-1.5 font-mono text-micro text-fg-2">
              {anchorPreview}
            </pre>
          ) : undefined
        }
      />
    </FloatingCard>
  );
}
