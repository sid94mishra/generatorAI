// ────────────────────────────────────────────────────────────────
// C-28 PairingCodeInput (03 §3 C-28, D-42): Pairing (L-03 Gate).
//
// The Pairing board draws 6 boxes, but the server's real format is 12
// characters in 3 groups of 4 (`PAIRING_CODE_LENGTH`/`PAIRING_CODE_GROUP_SIZE`,
// `@generatorai/shared`) — D-42 "the server wins". Built on Base UI's
// `OTPField`, whose `normalizeValue` hook is exactly `normalizePairingCode`
// (fold case, resolve confusable letters), so typed and pasted input reaches
// the same canonical code the server hashes. `rounded-control`, 1px
// `border-line-strong` (`border-err` when `invalid`), `bg-sunken`,
// `font-mono font-medium` centred; a dash between groups (a top border, never
// `h-px` — the ratchet bans literal pixel heights, D-56).
//
// Fluid (D-110 fix): twelve cells never fit the board's 48-wide boxes in a
// 420 card (12×48 plus gaps is ~700 px), so the cells share the row
// (`flex-1 min-w-0`, capped at the board's 48 / the read-only 32) and step
// their type, height and gaps by the width of their own container
// (`@container/code`), not the viewport — a phone gate (~256-290 px), the
// desktop gate (364 px) and a wide settings column each get cells that fit:
//   < 320  `text-ui` · `h-control-lg` · gap 4 · dash 8
//   ≥ 320  `text-title` · `h-row` · gap 6 · dash 12
//   ≥ 512  `text-heading` · `h-footer` (the board's 56) · gap 8
// The read-only cells stay `h-control-lg` and step `text-ui` → `text-title`.
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
// drawn without the sunken input fill, in compact cells (at most 32 wide) so a
// whole code fits a settings column. `className` lands on the outer container,
// which fills its row (`w-full min-w-0`).
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
    <BaseField.Root className={cn('@container/code w-full min-w-0', className)}>
      <BaseField.Label className="sr-only">Pairing code</BaseField.Label>
      <OTPField.Root
        length={PAIRING_CODE_LENGTH}
        value={value}
        onValueChange={(next) => onValueChange(next)}
        validationType="alphanumeric"
        normalizeValue={normalizePairingCode}
        disabled={disabled}
        readOnly={readOnly}
        className="flex w-full min-w-0 items-center gap-1 @xs/code:gap-1.5 @lg/code:gap-2"
      >
        {Array.from({ length: PAIRING_CODE_LENGTH }, (_, index) => (
          <Fragment key={index}>
            <OTPField.Input
              aria-label={index === 0 ? undefined : `Character ${index + 1} of ${PAIRING_CODE_LENGTH}`}
              className={cn(
                'min-w-0 flex-1 rounded-control border px-0 text-center font-mono font-medium text-fg transition-control outline-none',
                readOnly
                  ? 'h-control-lg max-w-8 border-line bg-transparent text-ui @xs/code:text-title'
                  : 'h-control-lg max-w-12 bg-sunken text-ui @xs/code:h-row @xs/code:text-title @lg/code:h-footer @lg/code:text-heading',
                invalid ? 'border-err' : !readOnly && 'border-line-strong',
                fieldFocus,
              )}
            />
            {(index + 1) % PAIRING_CODE_GROUP_SIZE === 0 && index !== PAIRING_CODE_LENGTH - 1 ? (
              <span aria-hidden className="w-2 shrink-0 self-center border-t border-line-strong @xs/code:w-3" />
            ) : null}
          </Fragment>
        ))}
      </OTPField.Root>
    </BaseField.Root>
  );
}
