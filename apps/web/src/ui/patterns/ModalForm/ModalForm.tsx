// ────────────────────────────────────────────────────────────────
// C-35 ModalForm body (03 §3 C-35): NewChat's dialog body — a prose Textarea,
// horizontal Fields (label 64) and sections, inside P-31 Dialog.Body.
//
// `ModalForm`: a gap-20 flex column (drop it straight into `<Dialog.Body>`).
// `ModalForm.Section`: a `text-ui` 600 `h3` + hint, gap 10, for grouping the
// horizontal fields under it.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export type ModalFormProps = ComponentProps<'div'>;

/** The gap-20 body column of a form dialog. */
export function ModalForm({ className, ...rest }: ModalFormProps) {
  return <div className={cn('flex flex-col gap-5', className)} {...rest} />;
}

export interface ModalFormSectionProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  hint?: ReactNode;
}

/** A titled group of horizontal fields inside a ModalForm. */
export function ModalFormSection({ title, hint, className, children, ...rest }: ModalFormSectionProps) {
  return (
    <div className={cn('flex flex-col gap-2.5', className)} {...rest}>
      <div className="flex items-baseline gap-2">
        <h3 className="text-ui font-semibold text-fg">{title}</h3>
        {hint != null ? <span className="text-small text-fg-3">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

ModalForm.Section = ModalFormSection;
