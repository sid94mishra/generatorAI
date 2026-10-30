// ────────────────────────────────────────────────────────────────
// S-10 CommandPaletteFrame (03 §4 S-10): P-31 Dialog `md` (640) placed at the
// top (120px at a 900px window) over a `bg-scrim` backdrop, no header, hosting
// a C-21 CommandList. The popup is `data-gai-overlay="palette"` (D-19), which
// also tells the command host that bare keys and sequences must wait (D-46).
// Focus goes to the query on open and returns to where it was on close.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { Dialog } from '../../primitives/Dialog/Dialog.js';

export interface CommandPaletteFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name of the dialog. */
  label?: string;
  /** The palette body: a CommandList. */
  children: ReactNode;
}

/** The command palette's modal frame. */
export function CommandPaletteFrame({ open, onOpenChange, label = 'Command palette', children }: CommandPaletteFrameProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      placement="top"
      header={false}
      title={label}
      overlay="palette"
      data-testid="command-palette"
    >
      {children}
    </Dialog>
  );
}
