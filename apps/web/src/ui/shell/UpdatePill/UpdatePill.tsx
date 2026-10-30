// ────────────────────────────────────────────────────────────────
// UpdatePill — "Restart to update" (03 §4 S-06, D-23; 06 §8; board
// DesktopWindows; Rosetta `.btn.btn-sm` 26h `run-bg` / `run`).
//
// One control, three placements, one per layout's reserved slot:
//   strip   the Windows / Linux-custom title strip, before the server chip
//           (Button sm, run tint, download glyph)
//   footer  the sidebar footer, above the connection row (macOS, the Linux
//           native frame): the same pill at full width
//   rail    the collapsed rail: a run-toned download icon button
// The tooltip names the version ("Update 0.0.2 is ready"), or the reason the
// last attempt failed. `busy` (the install is starting) shows the spinner and
// ignores clicks. Presentational: app/shell renders it only while an update is
// ready (never on the web), and wires the click to the install.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.js';
import { Button } from '../../primitives/Button/Button.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { Tooltip } from '../../primitives/Tooltip/Tooltip.js';

export type UpdatePillPlacement = 'strip' | 'footer' | 'rail';

export interface UpdatePillProps extends Omit<ComponentProps<'button'>, 'children' | 'ref'> {
  /** The downloaded version that a restart installs. */
  version: string;
  placement: UpdatePillPlacement;
  /** The install is starting: spinner, clicks ignored. */
  busy?: boolean;
  /** Why the last install attempt failed (the app kept running). */
  error?: string;
}

const LABEL = 'Restart to update';

/** The tooltip text: the version that is ready, or why the last attempt failed. */
export function updatePillHint(version: string, error?: string): string {
  return error ? `Update ${version} could not be installed: ${error}` : `Update ${version} is ready`;
}

/** The "Restart to update" pill (strip, sidebar footer) or rail icon. */
export function UpdatePill({ version, placement, busy = false, error, className, onClick, ...rest }: UpdatePillProps) {
  const hint = updatePillHint(version, error);
  if (placement === 'rail') {
    return (
      <IconButton
        icon="download"
        label={LABEL}
        tooltip={hint}
        tooltipSide="right"
        size="lg"
        tone="run"
        {...(busy ? { 'aria-busy': true, 'aria-disabled': true } : {})}
        className={className}
        onClick={busy ? (event) => event.preventDefault() : onClick}
        {...rest}
      />
    );
  }
  return (
    <Tooltip content={hint} side={placement === 'strip' ? 'bottom' : 'top'}>
      <Button
        size="sm"
        icon="download"
        loading={busy}
        fullWidth={placement === 'footer'}
        className={cn(
          'border-transparent bg-run-bg text-run hover:not-disabled:bg-run-bg/80 hover:not-disabled:text-run',
          placement === 'footer' && 'justify-start',
          className,
        )}
        onClick={onClick}
        {...rest}
      >
        {LABEL}
      </Button>
    </Tooltip>
  );
}
