// ────────────────────────────────────────────────────────────────
// NumberStepper — Number input with -/+ stepper buttons
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils.js';

interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  unit?: string;
}

export function NumberStepper({ value, onChange, min = 0, max = Infinity, step = 1, label, unit }: NumberStepperProps) {
  return (
    <div>
      {label && (
        <label className="mb-1.5 block text-xs font-medium text-foreground">{label}</label>
      )}
      <div className="flex items-center rounded-lg border border-border bg-background overflow-hidden">
        <button
          type="button"
          onClick={() => {
            const decimals = (step.toString().split('.')[1] || '').length;
            onChange(parseFloat(Math.max(min, value - step).toFixed(decimals)));
          }}
          disabled={value <= min}
          aria-label={label ? `Decrease ${label}` : 'Decrease'}
          className={cn(
            'flex h-8 w-8 items-center justify-center',
            'text-muted-foreground',
            'hover:bg-subtle hover:text-foreground',
            'transition-colors duration-100',
            'disabled:opacity-30 disabled:cursor-not-allowed',
            'border-r border-border',
          )}
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
          className={cn(
            'flex-1 h-8 text-center text-sm font-medium min-w-0',
            'bg-transparent text-foreground',
            'outline-none border-none',
            '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          )}
        />
        {unit && <span className="pr-2 text-[10px] text-muted-foreground">{unit}</span>}
        <button
          type="button"
          onClick={() => {
            const decimals = (step.toString().split('.')[1] || '').length;
            onChange(parseFloat(Math.min(max, value + step).toFixed(decimals)));
          }}
          disabled={value >= max}
          aria-label={label ? `Increase ${label}` : 'Increase'}
          className={cn(
            'flex h-8 w-8 items-center justify-center',
            'text-muted-foreground',
            'hover:bg-subtle hover:text-foreground',
            'transition-colors duration-100',
            'disabled:opacity-30 disabled:cursor-not-allowed',
            'border-l border-border',
          )}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
