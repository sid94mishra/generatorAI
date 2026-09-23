// ────────────────────────────────────────────────────────────────
// QuestionCard — agent-authored clarifying questions (PLN-01)
//
// Both SDKs let the agent ask the user before committing to an approach
// (Claude `AskUserQuestion`, Copilot `ask_user`). The tool call BLOCKS until
// we answer, so this card resolves inside the same agent turn.
//
// The "Other…" free-text row is required by the Claude contract: the model is
// explicitly told not to emit an "Other" option because the host provides it.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { HelpCircle, Check, AlertTriangle, Send, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button, Input } from '@/components/ui/index.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import type { QuestionBlock } from '@/stores/streamStore.js';

export interface QuestionCardProps {
  question: QuestionBlock;
  /**
   * Submits the answers. Omitted when the card is replayed from persisted
   * history — the SDK callback it was blocking is long gone, so the card is
   * read-only and the submit row is hidden.
   */
  onSubmit?: (
    interactionId: string,
    answers: Record<string, string[]>,
    freeformResponse?: string,
  ) => void;
  busy?: boolean;
}

const OTHER = '__other__';

export function QuestionCard({ question, onSubmit, busy }: QuestionCardProps) {
  // questionId → selected labels (or [OTHER] when the user is typing their own)
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});
  // The agent may ask several questions at once; page through them one at a
  // time so a 4-question card doesn't become a wall of radio buttons.
  const [index, setIndex] = useState(0);

  const isPending = question.status === 'pending';
  const isExpired = question.status === 'expired';
  // A pending card with no submit handler (history replay) can never be
  // answered — render it as the dead card it is.
  const isAnswerable = isPending && !!onSubmit;

  const answered = useMemo(() => {
    if (question.status !== 'answered') return null;
    return question.answers ?? {};
  }, [question.status, question.answers]);

  const total = question.questions.length;
  const current = Math.min(index, Math.max(total - 1, 0));
  const visible = total > 1 ? question.questions.slice(current, current + 1) : question.questions;

  const toggle = (qid: string, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[qid] ?? [];
      if (multiSelect) {
        return {
          ...prev,
          [qid]: current.includes(label)
            ? current.filter((l) => l !== label)
            : [...current, label],
        };
      }
      return { ...prev, [qid]: [label] };
    });
  };

  /** Resolve each question to its final answer, folding in "Other…" text. */
  const buildAnswers = (): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const q of question.questions) {
      const picked = selections[q.id] ?? [];
      const resolved = picked.flatMap((label) => {
        if (label !== OTHER) return [label];
        const text = (customText[q.id] ?? '').trim();
        // The user's own words become the answer value — never the word "Other".
        return text ? [text] : [];
      });
      if (resolved.length > 0) out[q.id] = resolved;
    }
    return out;
  };

  const isQuestionAnswered = (qid: string): boolean => {
    const picked = selections[qid] ?? [];
    if (picked.length === 0) return false;
    if (picked.includes(OTHER) && (customText[qid] ?? '').trim().length === 0) return false;
    return true;
  };

  const canSubmit =
    isAnswerable && !busy && question.questions.every((q) => isQuestionAnswered(q.id));

  /** First question still missing an answer, when it isn't the one on screen. */
  const nextUnanswered = useMemo(() => {
    if (!isAnswerable || total <= 1) return -1;
    const idx = question.questions.findIndex((q) => !isQuestionAnswered(q.id));
    return idx >= 0 && idx !== current ? idx : -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnswerable, total, current, question.questions, selections, customText]);

  return (
    <div
      className={cn(
        'rounded-xl border bg-[var(--color-card)]',
        isAnswerable
          ? 'border-[var(--color-primary)]/40 shadow-sm'
          : 'border-[var(--color-border)]/60',
      )}
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-border)]/60 px-3 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
          <HelpCircle className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-medium text-[var(--color-foreground)]">
          {isAnswerable
            ? 'The agent needs your input'
            : isExpired || isPending
              ? 'Question expired'
              : 'You answered'}
        </span>
        {isExpired && (
          <AlertTriangle className="h-3 w-3 text-[var(--color-muted-foreground)]" aria-hidden />
        )}

        {/* Pager — only when the agent asked more than one question. */}
        {total > 1 && (
          <span className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              aria-label="Previous question"
              disabled={current === 0}
              onClick={() => setIndex(current - 1)}
              className="h-6 w-6 shrink-0 rounded p-0 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="tabular-nums text-[11px] text-[var(--color-muted-foreground)]">
              {current + 1} / {total}
            </span>
            <Button
              type="button"
              variant="ghost"
              aria-label="Next question"
              disabled={current >= total - 1}
              onClick={() => setIndex(current + 1)}
              className="h-6 w-6 shrink-0 rounded p-0 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-30"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </span>
        )}
      </div>

      <div className="space-y-3 p-3">
        {visible.map((q) => {
          const picked = selections[q.id] ?? [];
          const previouslyAnswered = answered?.[q.id];
          return (
            <fieldset key={q.id} className="min-w-0">
              <legend className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--color-muted)]/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {q.header}
                </span>
                <span className="text-xs font-medium text-[var(--color-foreground)]">
                  {q.question}
                </span>
              </legend>

              {previouslyAnswered ? (
                <p className="rounded-lg bg-[var(--color-muted)]/30 px-2.5 py-1.5 text-xs text-[var(--color-foreground)]">
                  {previouslyAnswered.join(', ')}
                </p>
              ) : answered ? (
                // Answered card, but this question carries no selection —
                // the user took the "let the agent decide" route.
                <p className="rounded-lg bg-[var(--color-muted)]/30 px-2.5 py-1.5 text-xs italic text-[var(--color-muted-foreground)]">
                  {question.freeformResponse ?? 'Left to the agent to decide.'}
                </p>
              ) : (
                <div className="space-y-1">
                  {q.options.map((option) => {
                    const selected = picked.includes(option.label);
                    return (
                      <label
                        key={option.label}
                        className={cn(
                          'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 transition-colors',
                          selected
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                            : 'border-[var(--color-border)]/60 hover:bg-[var(--color-accent)]/50',
                          !isAnswerable && 'cursor-default opacity-60',
                        )}
                      >
                        <input
                          type={q.multiSelect ? 'checkbox' : 'radio'}
                          name={`q-${question.interactionId}-${q.id}`}
                          checked={selected}
                          disabled={!isAnswerable}
                          onChange={() => toggle(q.id, option.label, q.multiSelect)}
                          className="mt-0.5 h-3 w-3 accent-[var(--color-primary)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-[var(--color-foreground)]">
                            {option.label}
                          </span>
                          {option.description && (
                            <span className="block text-[11px] leading-snug text-[var(--color-muted-foreground)]">
                              {option.description}
                            </span>
                          )}
                          {/* Previews are requested as markdown only — never
                              raw HTML into the transcript. */}
                          {selected && option.preview && (
                            <span className="mt-1.5 block rounded-md border border-[var(--color-border)]/60 bg-[var(--color-background)] p-2">
                              <MarkdownRenderer content={option.preview} />
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}

                  {/* "Other…" — the model never emits this; the host must. */}
                  {q.allowFreeform && (
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 transition-colors',
                        picked.includes(OTHER)
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                          : 'border-[var(--color-border)]/60 hover:bg-[var(--color-accent)]/50',
                        !isAnswerable && 'cursor-default opacity-60',
                      )}
                    >
                      <input
                        type={q.multiSelect ? 'checkbox' : 'radio'}
                        name={`q-${question.interactionId}-${q.id}`}
                        checked={picked.includes(OTHER)}
                        disabled={!isAnswerable}
                        onChange={() => toggle(q.id, OTHER, q.multiSelect)}
                        className="mt-0.5 h-3 w-3 accent-[var(--color-primary)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-[var(--color-foreground)]">
                          Other…
                        </span>
                        {picked.includes(OTHER) && (
                          <Input
                            type="text"
                            autoFocus
                            value={customText[q.id] ?? ''}
                            onChange={(e) =>
                              setCustomText((prev) => ({ ...prev, [q.id]: e.target.value }))
                            }
                            placeholder="Type your own answer"
                            className="mt-1 h-auto w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs text-[var(--color-foreground)] outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]/40"
                          />
                        )}
                      </span>
                    </label>
                  )}
                </div>
              )}
            </fieldset>
          );
        })}

        {isAnswerable && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                onSubmit?.(
                  question.interactionId,
                  {},
                  'Skip the questions and use your best judgement.',
                )
              }
              className="h-auto rounded-md px-2 py-1.5 text-[11px] font-normal text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
            >
              Skip &amp; let the agent decide
            </Button>
            {/* With several questions the Submit stays disabled until they are
                all answered, so send the user to the next gap rather than
                leaving a dead button and no explanation. */}
            {nextUnanswered >= 0 ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIndex(nextUnanswered)}
                className="h-auto flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-accent)]"
              >
                Next question
                <ChevronRight className="h-3 w-3" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!canSubmit}
                loading={busy}
                onClick={() => onSubmit?.(question.interactionId, buildAnswers())}
                className="h-auto flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90"
              >
                {!busy && <Send className="h-3 w-3" />}
                Submit answers
              </Button>
            )}
          </div>
        )}

        {question.status === 'answered' && (
          <>
            {question.freeformResponse && Object.keys(answered ?? {}).length > 0 && (
              <p className="rounded-lg bg-[var(--color-muted)]/30 px-2.5 py-1.5 text-xs italic text-[var(--color-muted-foreground)]">
                {question.freeformResponse}
              </p>
            )}
            <p className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" />
              Answers sent to the agent
            </p>
          </>
        )}
        {isExpired && (
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            This question is no longer answerable — the agent&apos;s turn ended.
          </p>
        )}
      </div>
    </div>
  );
}
