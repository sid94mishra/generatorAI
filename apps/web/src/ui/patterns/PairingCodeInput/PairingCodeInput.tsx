// ────────────────────────────────────────────────────────────────
// C-28 PairingCodeInput (03 §3 C-28, D-42): Pairing (L-03 Gate).
//
// The Pairing board draws 6 boxes, but the server's real format is 12
// characters in 3 groups of 4 (`PAIRING_CODE_LENGTH`/`PAIRING_CODE_GROUP_SIZE`,
// `@generatorai/shared`) — D-42 "the server wins". Built on Base UI's
// `OTPField`, whose `normalizeValue` hook is exactly `normalizePairingCode`
// (fold case, resolve confusable letters), so typed and pasted input reaches
// the same canonical code the server hashes. Cells 48×56 (`w-12 h-footer` —
// the nearest named height step; the board's 52 has no token and a
// one-component-only step is not worth adding, D-15), `rounded-control`,
// 1px `border-line-strong` (`border-err` when `invalid`),
// `bg-sunken`, `font-mono text-heading font-medium` centred; a 12×1
// `border-line-strong` dash between groups (a top border, never `h-px` — the
// ratchet bans literal pixel heights, D-56).
//
// Naming: `OTPField.Input` deliberately ignores a bare `aria-label` on cell 1
// (Base UI's own dev warning: "use a `<label>` or `<Field.Label>`") — an
// explicit `aria-labelledby` on the root has the same gap (Base UI only
// mirrors the root's name onto cell 1 when it comes from `Field.Label`, not
// from a prop the consumer set directly). So this wraps itself in a
// (visually hidden) `Field.Root`/`Field.Label` internally, which every cell
// — including the first — inherits as its name; cells 2-12 also get their
// own "Character N of 12" `aria-label` layered on top. Wrap this in your own
// outer `Field` too, for the error line; `invalid` here only styles the cells.
// `readOnly` shows a code this device generated (Settings › Security › Pair a
// new device) in the same 3×4 cells: selectable and focusable, not editable,
// drawn without the sunken input fill, in compact 32×32 cells (`title` step)
// so a whole code fits a settings column.
// ────────────────────────────────────────────────────────────────

import { Fragment } from 'react';
import { Field as BaseField } from '@base-ui/react/field';
import { OTPField } from '@base-ui/react/otp-field';
import { PAIRING_CODE_GROUP_SIZE, PAIRING_CODE_LENGTH, normalizePairingCode } from '@generatorai/shared';
import { cn } from '../../lib/cn.js';
import { fieldFocus } from '../../lib/focus.js';

export interface PairingCodeInputProps {
  value: string;
  onValueChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  /** Display a generated code: focusable and selectable, not editable. */
  readOnly?: boolean;
  className?: string;
}

/** The 12-character pairing code group, 3 groups of 4. */
export function PairingCodeInput({ value, onValueChange, invalid = false, disabled, readOnly = false, className }: PairingCodeInputProps) {
  return (
    <BaseField.Root className="contents">
      <BaseField.Label className="sr-only">Pairing code</BaseField.Label>
      <OTPField.Root
        length={PAIRING_CODE_LENGTH}
        value={value}
        onValueChange={(next) => onValueChange(next)}
        validationType="alphanumeric"
        normalizeValue={normalizePairingCode}
        disabled={disabled}
        readOnly={readOnly}
        className={cn('flex items-center gap-2', className)}
      >
        {Array.from({ length: PAIRING_CODE_LENGTH }, (_, index) => (
          <Fragment key={index}>
            <OTPField.Input
              aria-label={index === 0 ? undefined : `Character ${index + 1} of ${PAIRING_CODE_LENGTH}`}
              className={cn(
                'rounded-control border text-center font-mono font-medium text-fg transition-control outline-none',
                readOnly ? 'h-control-lg w-8 border-line bg-transparent text-title' : 'h-footer w-12 bg-sunken text-heading',
                invalid ? 'border-err' : !readOnly && 'border-line-strong',
                fieldFocus,
              )}
            />
            {(index + 1) % PAIRING_CODE_GROUP_SIZE === 0 && index !== PAIRING_CODE_LENGTH - 1 ? (
              <span aria-hidden className="w-3 shrink-0 self-center border-t border-line-strong" />
            ) : null}
          </Fragment>
        ))}
      </OTPField.Root>
    </BaseField.Root>
  );
}
