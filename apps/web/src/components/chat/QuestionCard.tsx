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
import { HelpCircle, Check, Loader2, AlertTriangle, Send } from 'lucide-react';
import { cn } from '@/lib/utils.js';
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

  const isPending = question.status === 'pending';
  const isExpired = question.status === 'expired';
  // A pending card with no submit handler (history replay) can never be
  // answered — render it as the dead card it is.
  const isAnswerable = isPending && !!onSubmit;

  const answered = useMemo(() => {
    if (question.status !== 'answered') return null;
    return question.answers ?? {};
  }, [question.status, question.answers]);

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

  const canSubmit =
    isAnswerable &&
    !busy &&
    question.questions.every((q) => {
      const picked = selections[q.id] ?? [];
      if (picked.length === 0) return false;
      if (picked.includes(OTHER) && (customText[q.id] ?? '').trim().length === 0) return false;
      return true;
    });

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
      </div>

      <div className="space-y-3 p-3">
        {question.questions.map((q) => {
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
                          <input
                            type="text"
                            autoFocus
                            value={customText[q.id] ?? ''}
                            onChange={(e) =>
                              setCustomText((prev) => ({ ...prev, [q.id]: e.target.value }))
                            }
                            placeholder="Type your own answer"
                            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs text-[var(--color-foreground)] outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]/40"
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
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                onSubmit?.(
                  question.interactionId,
                  {},
                  'Skip the questions and use your best judgement.',
                )
              }
              className="rounded-md px-2 py-1.5 text-[11px] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50"
            >
              Skip &amp; let the agent decide
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => onSubmit?.(question.interactionId, buildAnswers())}
              className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Submit answers
            </button>
          </div>
        )}

        {question.status === 'answered' && (
          <p className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" />
            Answers sent to the agent
          </p>
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
