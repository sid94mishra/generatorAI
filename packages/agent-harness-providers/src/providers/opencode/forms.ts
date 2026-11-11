// ────────────────────────────────────────────────────────────────
// OpenCode 2 forms — the `question` tool's form as the app's question card.
//
// OpenCode's `question` tool (core `tool/plugin/question.ts`) asks through a
// form: `metadata.kind === "question"`, one field per question keyed `q<i>`,
// `type: "multiselect"` when several answers are allowed, options
// `{value: label, label, description}` and `custom: true` ("type your own").
// The answer is `{ q0: "label" | ["a", "b"] }`; a cancel WITH a message is
// handed to the model as feedback, so a user who dismissed the card and wrote
// a reply is answered that way.
// ────────────────────────────────────────────────────────────────

import type { AgentQuestion, AgentQuestionResponse } from '@generatorai/shared';

export interface FormOption {
  value: string;
  label: string;
  description?: string;
}

export interface FormField {
  key: string;
  type: string;
  title?: string;
  description?: string;
  options?: FormOption[];
  custom?: boolean;
  hidden?: boolean;
  required?: boolean;
}

export interface FormInfo {
  id: string;
  sessionID: string;
  title: string;
  metadata?: Record<string, unknown>;
  fields: FormField[];
}

/** Whether the form is the `question` tool asking the user (as opposed to MCP elicitation or a plugin's form). */
export function isQuestionForm(form: FormInfo): boolean {
  return form.metadata?.['kind'] === 'question';
}

/** Field types the question card can render: a choice or free text. */
const ANSWERABLE = new Set(['string', 'multiselect']);

/** The form's fields as questions, or null when one of them is not something the card can ask. */
export function questionsFromForm(form: FormInfo): AgentQuestion[] | null {
  const visible = form.fields.filter((f) => !f.hidden);
  if (visible.length === 0 || visible.some((f) => !ANSWERABLE.has(f.type))) return null;
  return visible.map((field) => ({
    id: field.key,
    header: (field.title ?? form.title ?? '').slice(0, 40) || 'Question',
    question: field.description ?? field.title ?? form.title,
    options: (field.options ?? []).map((o) => ({
      label: o.label,
      ...(o.description ? { description: o.description } : {}),
    })),
    multiSelect: field.type === 'multiselect',
    // A string field with no options IS free text; otherwise `custom` says whether one is allowed.
    allowFreeform: field.custom === true || (field.options ?? []).length === 0,
  }));
}

/** Map a picked label back to the option value the form expects (they are equal for the question tool). */
function valueOf(field: FormField, picked: string): string {
  return field.options?.find((o) => o.label === picked)?.value ?? picked;
}

/**
 * The card's response as the form's answer. Returns null when nothing structured was answered, so the caller
 * cancels the form instead — with the user's free reply as the message when there is one.
 */
export function answerFromResponse(
  form: FormInfo,
  response: AgentQuestionResponse,
): Record<string, string | string[]> | null {
  const answer: Record<string, string | string[]> = {};
  for (const field of form.fields) {
    if (field.hidden) continue;
    const picked = response.answers?.[field.key]?.filter((s) => s.trim() !== '') ?? [];
    if (picked.length === 0) continue;
    answer[field.key] = field.type === 'multiselect' ? picked.map((p) => valueOf(field, p)) : valueOf(field, picked[0]!);
  }
  return Object.keys(answer).length > 0 ? answer : null;
}
