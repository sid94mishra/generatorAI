// ────────────────────────────────────────────────────────────────
// P-32 AlertDialog + useConfirm (03 §2 P-32; Base UI AlertDialog).
//
// Only for destructive or irreversible actions. Not drawn on the desktop
// boards; geometry derives from Dialog `sm`: 420 wide, `bg-overlay`, 1px line,
// dialog radius, `shadow-pop` over a `bg-scrim` backdrop. Body pad 20: title
// (title step) + description (ui fg-2). Footer 56h, border-t line-soft:
// Cancel (secondary + Esc hint) and the confirm button (danger by default).
// Backdrop and popup carry `data-gai-overlay` (D-19); both sit on the dialog
// layer (D-41). Focus is trapped and returns to the trigger on close.
// ────────────────────────────────────────────────────────────────

import { useCallback, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import { cn } from '../../lib/cn.js';
import { overlayProps } from '../../lib/overlay.js';
import { dialogClamp } from '../../lib/popup.js';
import { Button } from '../Button/Button.js';

export interface AlertDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional trigger element (a Button); omit when `open` is controlled. */
  trigger?: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` (default) for destructive actions, `primary` otherwise. */
  tone?: 'danger' | 'primary';
  /** Runs on confirm. A returned promise keeps the dialog open (loading) until it settles. */
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  className?: string;
  'data-testid'?: string;
}

/** A confirmation dialog for a destructive or irreversible action. */
export function AlertDialog({
  open: openProp,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
  className,
  'data-testid': testId,
}: AlertDialogProps) {
  const [openState, setOpenState] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const runConfirm = async () => {
    const result = onConfirm();
    if (result instanceof Promise) {
      setBusy(true);
      try {
        await result;
      } finally {
        setBusy(false);
      }
    }
    setOpen(false);
  };
  return (
    <BaseAlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        if (!next) onCancel?.();
        setOpen(next);
      }}
    >
      {trigger ? <BaseAlertDialog.Trigger render={trigger} /> : null}
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop className="fixed inset-0 z-dialog bg-scrim motion-fade" {...overlayProps('backdrop')} />
        <BaseAlertDialog.Popup
          className={cn(
            'fixed top-1/2 left-1/2 z-dialog flex w-dialog-sm -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
            'rounded-dialog border border-line bg-overlay text-fg shadow-pop outline-none motion-dialog',
            dialogClamp,
            className,
          )}
          data-testid={testId}
          {...overlayProps('dialog')}
        >
          <div className="flex flex-col gap-2 p-5">
            <BaseAlertDialog.Title className="text-title text-fg">{title}</BaseAlertDialog.Title>
            {description != null ? (
              <BaseAlertDialog.Description className="text-ui text-fg-2">{description}</BaseAlertDialog.Description>
            ) : null}
          </div>
          <div className="flex h-footer shrink-0 items-center justify-end gap-2 border-t border-line-soft pr-4 pl-5">
            <BaseAlertDialog.Close render={<Button shortcut={['Esc']} disabled={busy} />}>{cancelLabel}</BaseAlertDialog.Close>
            <Button variant={tone} loading={busy} onClick={() => void runConfirm()}>
              {confirmLabel}
            </Button>
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}

/**
 * Imperative confirmation: `const confirmer = useConfirm();` render
 * `{confirmer.dialog}` once, then `if (await confirmer.confirm({ title, confirmLabel })) …`.
 * Resolves `true` on confirm, `false` on cancel / Escape. (Call it as a method:
 * the ratchet's `nativeConfirm` rule flags a bare call of that name.)
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    resolver.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
  };

  const dialog = options ? (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next) setOptions(null);
      }}
      title={options.title}
      description={options.description}
      confirmLabel={options.confirmLabel}
      cancelLabel={options.cancelLabel}
      tone={options.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, dialog };
}
