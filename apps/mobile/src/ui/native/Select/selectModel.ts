// Pure Select logic (03 MP-24): the shown value, the spoken name, and the menu entries with the current one checked.
import type { MenuEntry } from '../Menu/Menu.types';
import type { SelectOption, SelectProps } from './Select.types';

export function selectedOption(options: ReadonlyArray<SelectOption>, value: string | null): SelectOption | undefined {
  return value === null ? undefined : options.find((o) => o.value === value);
}

export function selectValueText({ options, value, placeholder }: Pick<SelectProps, 'options' | 'value' | 'placeholder'>): string {
  return selectedOption(options, value)?.label ?? placeholder ?? 'None';
}

/** "<label>, <value>" (03 MP-24). */
export function selectAccessibilityLabel(props: Pick<SelectProps, 'label' | 'options' | 'value' | 'placeholder'>): string {
  return `${props.label}, ${selectValueText(props)}`;
}

export function selectMenuItems(options: ReadonlyArray<SelectOption>, value: string | null): MenuEntry[] {
  return options.map((o) => ({ id: o.value, label: o.label, subtitle: o.description, disabled: o.disabled, checked: o.value === value }));
}
