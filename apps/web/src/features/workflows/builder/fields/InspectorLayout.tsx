// ────────────────────────────────────────────────────────────────
// Inspector body layout (L-04 inspector boards: WorkflowStage*,
// WorkflowSettingsPanel, WorkflowLoopBuilder): sections separated by a
// `line-soft` rule, each with a 13/600 title, an optional count, a trailing
// hint or action, and horizontal P-16 rows with a 100px label column.
// Every inspector tab of the builder composes these, so the tabs line up.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '@/ui/lib/cn.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';

/** The inspectors' label column (03-kit C-18: "horizontal P-16 fields, label 100"). */
export const INSPECTOR_LABEL_WIDTH = 100;

export interface InspectorSectionProps {
  title: ReactNode;
  count?: ReactNode;
  /** Muted text right after the title. */
  hint?: ReactNode;
  /** Trailing control (Add …, Select all) or a right-aligned hint. */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
  'data-testid'?: string;
}

/** A titled group of inspector fields; the first section of a tab draws no rule. */
export function InspectorSection({ title, count, hint, action, className, children, 'data-testid': testId }: InspectorSectionProps) {
  return (
    <section
      className={cn('flex flex-col gap-2.5 border-t border-line-soft pt-3 first:border-t-0 first:pt-0', className)}
      data-testid={testId}
    >
      <SectionHeader level={3} title={title} count={count} hint={hint} action={action} />
      {children}
    </section>
  );
}

export interface InspectorRowProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  /** Stack the label over the control (wide editors: prompts, schemas, tables). */
  stacked?: boolean;
  className?: string;
  children?: ReactNode;
}

/** One labelled inspector control: a horizontal Field with the 100px label column. */
export function InspectorRow({ label, hint, error, optional, stacked = false, className, children }: InspectorRowProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      orientation={stacked ? 'vertical' : 'horizontal'}
      labelWidth={stacked ? undefined : INSPECTOR_LABEL_WIDTH}
      className={className}
    >
      {children}
    </Field>
  );
}

/** Muted explanatory text under a section or control. */
export function InspectorNote({ children, tone = 'muted', className }: { children: ReactNode; tone?: 'muted' | 'warn' | 'info'; className?: string }) {
  return (
    <p className={cn('text-small', tone === 'warn' ? 'text-warn' : tone === 'info' ? 'text-run' : 'text-fg-3', className)}>{children}</p>
  );
}
