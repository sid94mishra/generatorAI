// ────────────────────────────────────────────────────────────────
// C-35 ModalForm body (03 §3 C-35): a form dialog's body (NewChat …), inside
// P-31 Dialog.Body.
//
// `ModalForm`: a gap-20 flex column (drop it straight into `<Dialog.Body>`).
// `ModalForm.Section`: one titled group — a `text-ui` 600 `h3` with its hint on
// the line below, then the fields, gap 16. Every section after the `first` is
// set off by a rule and 20 of top padding, so the groups read as separate
// steps (D-133). The rule is `line`, not `line-soft`: a dialog sits on
// `overlay`, where `line-soft` is the same value as the surface and vanishes.
// Fields inside use vertical `Field`s — the label above the control, every
// control on the same left edge.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export type ModalFormProps = ComponentProps<'div'>;

/** The gap-20 body column of a form dialog. */
export function ModalForm({ className, ...rest }: ModalFormProps) {
  return <div className={cn('flex flex-col gap-5', className)} {...rest} />;
}

export interface ModalFormSectionProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** Omit for an untitled lead section (the form's main fields). */
  title?: ReactNode;
  hint?: ReactNode;
  /** No rule above (the section opens the form). */
  first?: boolean;
}

/** A titled, rule-separated group of fields inside a ModalForm. */
export function ModalFormSection({ title, hint, first = false, className, children, ...rest }: ModalFormSectionProps) {
  return (
    <section className={cn('flex flex-col gap-4', !first && 'border-t border-line pt-5', className)} {...rest}>
      {title != null ? (
        <div className="flex flex-col gap-0.5">
          <h3 className="text-ui font-semibold text-fg">{title}</h3>
          {hint != null ? <p className="text-small text-fg-3">{hint}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

ModalForm.Section = ModalFormSection;
