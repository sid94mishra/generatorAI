// The Field → control channel (03 MP-19): a control inside a Field takes the help or error text as its
// accessibilityHint, so the screen reader hears it with the control rather than as a separate element.
import { createContext, useContext } from 'react';
import type { FieldContextValue } from './Field.types';

export const FieldContext = createContext<FieldContextValue | null>(null);

export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

/** The control's hint: its own error first, then the Field's error / help (exported for tests). */
export function controlHint(own: { error?: string; hint?: string }, field: FieldContextValue | null): string | undefined {
  if (own.error) return `Error: ${own.error}`;
  if (field?.invalid && field.hint) return `Error: ${field.hint}`;
  return own.hint ?? field?.hint;
}
