// RadioGroup → row channel: rows (RadioOption, ListRow kind="radio", ChoiceCard callers) read the group value.
import { createContext, useContext } from 'react';

export interface RadioGroupContextValue {
  value: string | null;
  select: (v: string) => void;
}

export const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export function useRadioGroup(): RadioGroupContextValue | null {
  return useContext(RadioGroupContext);
}
