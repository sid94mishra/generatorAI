// ────────────────────────────────────────────────────────────────
// ReviewCommentForm — the one comment form (B-07, D-145)
// ────────────────────────────────────────────────────────────────
//
// Context header (what the comment is about) · optional extra fields and
// preview · intent chips (Fix · Question · Refactor · Test · Note) · the
// comment · Add comment / Add & send. Shared by the diff's floating composer
// (ReviewComposerPopover) and the browser's Comments panel, so a comment on a
// line of code and a comment on an element of a page are written the same
// way. Editing an existing comment is the same form with its words and
// intent filled in and "Update comment" as the action.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { REVIEW_INTENTS, REVIEW_INTENT_HINTS, REVIEW_INTENT_LABELS, type ReviewIntent } from '@generatorai/shared';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { MOD_ENTER_TEXT, isModEnter } from './modEnter.js';

export interface ReviewCommentFormProps {
  /** The header line: what the comment is about (a file and lines, an element). */
  context: ReactNode;
  /** Fields between the header and the intent chips (a line range). */
  extra?: ReactNode;
  /** A read-only preview of what is commented on (the selected lines). */
  preview?: ReactNode;
  initialBody?: string;
  initialIntent?: ReviewIntent;
  /** "Add comment" by default; "Update comment" when editing. */
  submitLabel?: string;
  busy?: boolean;
  /** Extra condition for submitting (a valid range). */
  ready?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onCancel: () => void;
  onSubmit: (body: string, intent: ReviewIntent) => void;
  /** Submit and immediately send this one comment to the agent. */
  onSubmitAndSend?: (body: string, intent: ReviewIntent) => void;
  /** Accessible name of the form. */
  label?: string;
  /** Esc in the comment cancels (off where the host already handles Esc, like FloatingCard). */
  escapeCancels?: boolean;
}

export function ReviewCommentForm({
  context,
  extra,
  preview,
  initialBody = '',
  initialIntent = 'fix',
  submitLabel = 'Add comment',
  busy,
  ready = true,
  placeholder,
  autoFocus = true,
  onCancel,
  onSubmit,
  onSubmitAndSend,
  label = 'Review comment',
  escapeCancels = true,
}: ReviewCommentFormProps) {
  const [body, setBody] = useState(initialBody);
  const [intent, setIntent] = useState<ReviewIntent>(initialIntent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const el = textareaRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  const canSubmit = body.trim().length > 0 && !busy && ready;

  return (
    <div role="group" aria-label={label} className="flex flex-col">
      <div className="flex h-control-lg items-center gap-1.5 border-b border-line-soft pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-small text-fg-3">{context}</span>
        <IconButton icon="x" size="sm" label="Cancel" tooltip={false} onClick={onCancel} />
      </div>

      <div className="flex flex-col gap-2 p-3">
        {extra}
        {preview}

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
            } else if (escapeCancels && e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          autosize={{ minRows: 3, maxRows: 10 }}
          placeholder={placeholder ?? `What should the agent change here? (${MOD_ENTER_TEXT} to add)`}
          aria-label={label}
        />

        <div className="flex items-center gap-1.5">
          <Button size="sm" disabled={!canSubmit} loading={busy} onClick={() => onSubmit(body.trim(), intent)}>
            {submitLabel}
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
              {submitLabel === 'Add comment' ? 'Add & send' : 'Update & send'}
            </Button>
          ) : null}
          <span className="ml-auto text-micro text-fg-3">Esc to cancel</span>
        </div>
      </div>
    </div>
  );
}
