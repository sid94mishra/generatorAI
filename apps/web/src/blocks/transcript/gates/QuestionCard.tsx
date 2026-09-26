// ────────────────────────────────────────────────────────────────
// B-20 QuestionCard — the agent's clarifying questions (PLN-01).
//
// Both SDKs let the agent ask before committing to an approach (Claude
// `AskUserQuestion`, Copilot `ask_user`); the tool call blocks until answered.
// Several questions page one at a time. "Other…" is the host's to provide —
// the Claude contract tells the model never to emit an "Other" option.
// Replayed history (no `onSubmit`) is read-only; a card persisted while still
// pending is expired.
//
// The board's relayed header ("Code Reviewer asks · background task") and
// "Open task chat" need the asking worker's identity on the question block,
// which the stream does not carry yet; not rendered (D-36).
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import type { QuestionBlock } from '@generatorai/client-core';
import { QUESTION_GATE_COPY as COPY } from '@generatorai/shared/ui-contract';
import { cn } from '@/ui/lib/cn.js';
import { GateCardFrame, type GateAction, type GateTone } from '@/ui/patterns/GateCardFrame/GateCardFrame.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Icon } from '@/ui/icons/Icon.js';
import { gateKeyChips, gateKeyDown } from './gateKeys.js';

export interface QuestionCardProps {
  question: QuestionBlock;
  /** Submits the answers. Omitted for replayed history → read-only. */
  onSubmit?: ((interactionId: string, answers: Record<string, string[]>, freeformResponse?: string) => void) | undefined;
  busy?: boolean;
}

const OTHER = '__other__';

export function QuestionCard({ question, onSubmit, busy = false }: QuestionCardProps) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);

  const answerable = question.status === 'pending' && !!onSubmit;
  const answered = question.status === 'answered' ? (question.answers ?? {}) : null;
  const total = question.questions.length;
  const current = Math.min(index, Math.max(total - 1, 0));
  const visible = total > 1 ? question.questions.slice(current, current + 1) : question.questions;

  const toggle = (qid: string, label: string, multi: boolean) =>
    setSelections((prev) => {
      const picked = prev[qid] ?? [];
      if (!multi) return { ...prev, [qid]: [label] };
      return { ...prev, [qid]: picked.includes(label) ? picked.filter((l) => l !== label) : [...picked, label] };
    });

  const isAnswered = (qid: string): boolean => {
    const picked = selections[qid] ?? [];
    if (picked.length === 0) return false;
    return !(picked.includes(OTHER) && !(customText[qid] ?? '').trim());
  };

  const buildAnswers = (): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const q of question.questions) {
      const resolved = (selections[q.id] ?? []).flatMap((label) => {
        if (label !== OTHER) return [label];
        const text = (customText[q.id] ?? '').trim();
        return text ? [text] : [];
      });
      if (resolved.length > 0) out[q.id] = resolved;
    }
    return out;
  };

  const canSubmit = answerable && !busy && question.questions.every((q) => isAnswered(q.id));
  const nextUnanswered = useMemo(() => {
    if (!answerable || total <= 1) return -1;
    const idx = question.questions.findIndex((q) => !isAnswered(q.id));
    return idx >= 0 && idx !== current ? idx : -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerable, total, current, question.questions, selections, customText]);

  const submit = () => {
    if (canSubmit) onSubmit?.(question.interactionId, buildAnswers());
  };
  const skip = () => onSubmit?.(question.interactionId, {}, COPY.skipResponse);

  const actions: GateAction[] = answerable
    ? [
        { label: COPY.actions.skip_questions, variant: 'ghost', onClick: skip, disabled: busy },
        nextUnanswered >= 0
          ? { label: COPY.actions.next_question, onClick: () => setIndex(nextUnanswered) }
          : {
              label: COPY.actions.submit_answers,
              variant: 'primary',
              shortcut: gateKeyChips('mod_enter'),
              onClick: submit,
              disabled: !canSubmit,
              loading: busy,
            },
      ]
    : [];

  const title = answerable ? COPY.title : answered ? COPY.titleAnswered : COPY.titleExpired;
  const tone: GateTone = answerable ? 'warn' : answered ? 'ok' : 'idle';
  const pager =
    total > 1 ? (
      <span className="inline-flex items-center gap-1">
        <IconButton icon="chevron-left" label={COPY.previous} size="sm" disabled={current === 0} onClick={() => setIndex(current - 1)} />
        <span className="font-mono text-micro">{COPY.pager(current + 1, total)}</span>
        <IconButton
          icon="chevron-right"
          label={COPY.next}
          size="sm"
          disabled={current >= total - 1}
          onClick={() => setIndex(current + 1)}
        />
      </span>
    ) : undefined;

  return (
    <GateCardFrame
      tone={tone}
      icon="message"
      title={title}
      meta={pager}
      actions={actions}
      onKeyDown={answerable ? gateKeyDown({ mod_enter: submit }) : undefined}
      data-testid="question-card"
      data-gai-block="question"
    >
      {visible.map((q) => {
        const picked = selections[q.id] ?? [];
        const previous = answered?.[q.id];
        return (
          <fieldset key={q.id} className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 flex flex-wrap items-center gap-2">
              {q.header ? <Badge>{q.header}</Badge> : null}
              <span className="text-ui font-medium text-fg">{q.question}</span>
            </legend>
            {previous ? (
              <p className="rounded-control bg-sunken px-2.5 py-1.5 text-ui text-fg">{previous.join(', ')}</p>
            ) : answered ? (
              <p className="rounded-control bg-sunken px-2.5 py-1.5 text-ui text-fg-2">
                {question.freeformResponse ?? COPY.leftToAgent}
              </p>
            ) : (
              <div role={q.multiSelect ? 'group' : 'radiogroup'} aria-label={q.question} className="flex flex-col gap-1">
                {q.options.map((option) => {
                  const selected = picked.includes(option.label);
                  return (
                    <div key={option.label} className="flex min-w-0 flex-col gap-1">
                      <OptionButton
                        multi={q.multiSelect}
                        selected={selected}
                        disabled={!answerable}
                        onClick={() => toggle(q.id, option.label, q.multiSelect)}
                        label={option.label}
                        description={option.description}
                      />
                      {selected && option.preview ? (
                        <div className="rounded-control border border-line-soft bg-surface p-2">
                          <Markdown size="compact">{option.preview}</Markdown>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {q.allowFreeform ? (
                  <div className="flex min-w-0 flex-col gap-1">
                    <OptionButton
                      multi={q.multiSelect}
                      selected={picked.includes(OTHER)}
                      disabled={!answerable}
                      onClick={() => toggle(q.id, OTHER, q.multiSelect)}
                      label={COPY.other}
                    />
                    {picked.includes(OTHER) ? (
                      <Input
                        autoFocus
                        size="sm"
                        aria-label={COPY.otherPlaceholder}
                        value={customText[q.id] ?? ''}
                        onChange={(e) => setCustomText((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder={COPY.otherPlaceholder}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </fieldset>
        );
      })}
      {answered ? (
        <>
          {question.freeformResponse && Object.keys(answered).length > 0 ? (
            <p className="rounded-control bg-sunken px-2.5 py-1.5 text-ui text-fg-2">{question.freeformResponse}</p>
          ) : null}
          <p className="flex items-center gap-1.5 text-small text-ok">
            <Icon concept="status-succeeded" size={14} />
            {COPY.sent}
          </p>
        </>
      ) : null}
      {!answerable && !answered ? <p className="text-small text-fg-3">{COPY.expired}</p> : null}
    </GateCardFrame>
  );
}

function OptionButton({
  multi,
  selected,
  disabled,
  onClick,
  label,
  description,
}: {
  multi: boolean;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
  description?: string | undefined;
}) {
  return (
    <Button
      variant="secondary"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      icon={selected ? (multi ? 'check' : 'status-succeeded') : 'status-queued'}
      className={cn('h-auto w-full justify-start gap-2 py-1.5 text-left', selected && 'border-accent bg-selected')}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-ui font-medium text-fg">{label}</span>
        {description ? <span className="truncate text-small font-normal text-fg-2">{description}</span> : null}
      </span>
    </Button>
  );
}
