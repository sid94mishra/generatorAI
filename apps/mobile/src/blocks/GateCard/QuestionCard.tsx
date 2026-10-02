// MB-15 question gate: one question at a time (pager "1 / 3" in the header), its options as radio rows (single)
// or checkboxes (multi), a free-text answer when the question allows it; GATE_ACTIONS.question — Skip (quiet,
// "let the agent decide"), Next question (secondary, multi-question), Submit answers (primary).
import React, { useState } from 'react';
import { View } from 'react-native';
import type { StreamBlock } from '@generatorai/client-core';
import { QUESTION_GATE_COPY } from '@generatorai/shared/ui-contract';

import { ActionRow, type RowAction } from '../../ui/layout/ActionRow';
import { Checkbox } from '../../ui/primitives/Checkbox';
import { Input } from '../../ui/primitives/Input';
import { RadioGroup, RadioOption } from '../../ui/primitives/RadioGroup';
import { Text } from '../../ui/primitives/Text';
import { GateCardFrame } from './GateCardFrame';

type QuestionBlock = Extract<StreamBlock, { type: 'question' }>;

export interface QuestionCardProps {
  block: QuestionBlock;
  /** Resolves when the server confirmed. */
  onSubmit: (answers: Record<string, string[]>, freeform?: string) => Promise<void>;
}

export function QuestionCard({ block, onSubmit }: QuestionCardProps): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [freeform, setFreeform] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'submit' | 'skip' | null>(null);
  const questions = block.questions;
  const question = questions[Math.min(index, questions.length - 1)];
  const expired = block.status === 'expired';
  const last = index >= questions.length - 1;

  const answered = (q: QuestionBlock['questions'][number]): boolean => (answers[q.id]?.length ?? 0) > 0 || Boolean(freeform[q.id]?.trim());
  const complete = questions.every(answered);

  const send = (kind: 'submit' | 'skip'): void => {
    if (busy) return;
    setBusy(kind);
    const text = questions.map((q) => freeform[q.id]?.trim()).filter(Boolean).join('\n');
    const work = kind === 'skip' ? onSubmit({}, QUESTION_GATE_COPY.skipResponse) : onSubmit(answers, text || undefined);
    void work.catch(() => undefined).finally(() => setBusy(null));
  };

  const toggle = (id: string, label: string, multi: boolean): void =>
    setAnswers((prev) => {
      const current = prev[id] ?? [];
      if (!multi) return { ...prev, [id]: [label] };
      return { ...prev, [id]: current.includes(label) ? current.filter((v) => v !== label) : [...current, label] };
    });

  const actions: RowAction[] = [
    { id: 'skip_questions', label: QUESTION_GATE_COPY.actions.skip_questions, role: 'quiet', loading: busy === 'skip', disabled: busy !== null, onPress: () => send('skip'), testID: 'gate-question-skip_questions' },
    ...(!last
      ? [{ id: 'next_question', label: QUESTION_GATE_COPY.actions.next_question, role: 'secondary' as const, disabled: !question || !answered(question), onPress: () => setIndex((i) => i + 1), testID: 'gate-question-next_question' }]
      : [
          {
            id: 'submit_answers',
            label: QUESTION_GATE_COPY.actions.submit_answers,
            role: 'primary' as const,
            loading: busy === 'submit',
            disabled: busy !== null || !complete,
            ...(!complete ? { disabledReason: 'Answer every question first' } : {}),
            onPress: () => send('submit'),
            testID: 'gate-question-submit_answers',
          },
        ]),
  ];

  return (
    <GateCardFrame
      title={expired ? QUESTION_GATE_COPY.titleExpired : QUESTION_GATE_COPY.title}
      meta={questions.length > 1 ? QUESTION_GATE_COPY.pager(Math.min(index, questions.length - 1) + 1, questions.length) : null}
      expired={expired}
    >
      {question ? (
        <View className="gap-2">
          <Text role="subhead" weight={500}>
            {question.question}
          </Text>
          {question.multiSelect ? (
            <View className="gap-1">
              {question.options.map((o) => (
                <Checkbox key={o.label} label={o.label} checked={(answers[question.id] ?? []).includes(o.label)} onValueChange={() => toggle(question.id, o.label, true)} disabled={expired} />
              ))}
            </View>
          ) : (
            <RadioGroup accessibilityLabel={question.question} value={answers[question.id]?.[0] ?? null} onValueChange={(v) => toggle(question.id, v, false)}>
              {question.options.map((o) => (
                <RadioOption key={o.label} value={o.label} label={o.label} {...(o.description ? { description: o.description } : {})} disabled={expired} />
              ))}
            </RadioGroup>
          )}
          {question.allowFreeform && !expired ? (
            <Input
              label={QUESTION_GATE_COPY.other}
              value={freeform[question.id] ?? ''}
              onChangeText={(v) => setFreeform((prev) => ({ ...prev, [question.id]: v }))}
              placeholder={QUESTION_GATE_COPY.otherPlaceholder}
              presentation="standalone"
              testID="gate-question-other"
            />
          ) : null}
        </View>
      ) : null}
      {expired ? (
        <Text role="footnote" tone="fg-2">
          {QUESTION_GATE_COPY.expired}
        </Text>
      ) : (
        <ActionRow actions={actions} />
      )}
    </GateCardFrame>
  );
}
