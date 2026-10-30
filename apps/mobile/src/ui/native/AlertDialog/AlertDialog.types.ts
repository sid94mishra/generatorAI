// MP-29 AlertDialog contract (03 MP-29): only for destructive or irreversible actions. Imperative.
import type { MobileIconConcept } from '@generatorai/design-tokens';

export interface AlertDialogOptions {
  /** The question: "Delete this chat?". */
  title: string;
  /** What is lost. */
  message?: string;
  /** Appended as lines to the message (MSetStorage "23 workspaces · 4.2 GB"). */
  impact?: ReadonlyArray<string>;
  /** "Delete", "Kill", "Discard". */
  confirmLabel: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** Default true: the system destructive style (iOS red; Android err-coloured text button). */
  destructive?: boolean;
  /** Android only (centred, e.g. 'trash'). */
  icon?: MobileIconConcept;
  /** Run the biometric step-up after confirm, before resolving (the app registers the handler). */
  requireStepUp?: boolean;
}

/** Resolves true when the step-up passed. Registered by the app (services/auth/stepUp); ui/ cannot import it. */
export type StepUpHandler = (reason: string) => Promise<boolean>;
