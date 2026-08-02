// ────────────────────────────────────────────────────────────────
// ToggleSwitch — labeled boolean toggle for settings rows.
// Built on the vendored Radix Switch part (keyboard + ARIA), keeps
// the original checked/onChange/label/description API.
// ────────────────────────────────────────────────────────────────

import React, { useId } from 'react';
import { Switch } from './primitives/switch.js';
import { cn } from '@/lib/utils.js';

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, onChange, label, description, disabled }: ToggleSwitchProps) {
  const id = useId();
  return (
    <div className={cn('group flex items-center justify-between gap-3', disabled && 'opacity-50')}>
      <label htmlFor={id} className={cn('min-w-0', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
