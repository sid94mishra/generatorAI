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

import { useEffect, useRef, useState } from 'react';
import {
  REVIEW_INTENTS,
  REVIEW_INTENT_HINTS,
  REVIEW_INTENT_LABELS,
  reviewLineLabel,
  type ReviewIntent,
} from '@generatorai/shared';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { FloatingCard } from './FloatingCard.js';
import { MOD_ENTER_TEXT, isModEnter } from './modEnter.js';

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
  const [body, setBody] = useState('');
  const [intent, setIntent] = useState<ReviewIntent>('fix');
  const [startLine, setStartLine] = useState(String(range.start));
  const [endLine, setEndLine] = useState(String(range.end));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const validRange = !onRangeChange || isValidRange(startLine, endLine, lineCount ?? 0);
  const canSubmit = body.trim().length > 0 && !busy && validRange;

  const updateRange = (start: string, end: string) => {
    setStartLine(start);
    setEndLine(end);
    if (isValidRange(start, end, lineCount ?? 0)) onRangeChange?.(Number(start), Number(end));
  };

  return (
    <FloatingCard anchor={anchor} onDismiss={onCancel} label="Add review comment">
      <div className="flex h-control-lg items-center gap-1.5 border-b border-line-soft pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-small text-fg-3">
          {file.alias !== '.' && `${file.alias}/`}
          {file.path}
          <span className="ml-1.5 text-fg">{reviewLineLabel(range.start, range.end)}</span>
        </span>
        <IconButton icon="x" size="sm" label="Cancel" tooltip={false} onClick={onCancel} />
      </div>

      <div className="flex flex-col gap-2 p-3">
        {onRangeChange ? (
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
        ) : null}

        {anchorPreview ? (
          // Scrolls when the selection is long, so it must be reachable by keyboard.
          <pre
            tabIndex={0}
            role="region"
            aria-label="Selected lines"
            className="m-0 max-h-20 overflow-auto rounded-control border border-line-soft bg-sunken px-2 py-1.5 font-mono text-micro text-fg-2">
            {anchorPreview}
          </pre>
        ) : null}

        <div className="flex flex-wrap gap-1" role="group" aria-label="Intent">
          {REVIEW_INTENTS.map((value) => (
            <Button
              key={value}
              variant="ghost"
              size="sm"
              title={REVIEW_INTENT_HINTS[value]}
              pressed={intent === value}
              onClick={() => setIntent(value)}
            >
              {REVIEW_INTENT_LABELS[value]}
            </Button>
          ))}
        </div>

        <Textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (isModEnter(e) && canSubmit) {
              e.preventDefault();
              onSubmit(body.trim(), intent);
            }
          }}
          autosize={{ minRows: 3, maxRows: 10 }}
          placeholder={`What should the agent change here? (${MOD_ENTER_TEXT} to add)`}
          aria-label="Review comment"
        />

        <div className="flex items-center gap-1.5">
          <Button size="sm" disabled={!canSubmit} loading={busy} onClick={() => onSubmit(body.trim(), intent)}>
            Add comment
          </Button>
          {onSubmitAndSend ? (
            <Button
              variant="primary"
              size="sm"
              icon="send"
              disabled={!canSubmit}
              title="Add this comment and send it to the agent now"
              onClick={() => onSubmitAndSend(body.trim(), intent)}
            >
              Add &amp; send
            </Button>
          ) : null}
          <span className="ml-auto text-micro text-fg-3">Esc to cancel</span>
        </div>
      </div>
    </FloatingCard>
  );
}
