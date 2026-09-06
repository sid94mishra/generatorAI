// ────────────────────────────────────────────────────────────────
// useConfirm — promise-flavoured ConfirmDialog.
//
// `window.confirm()` is a blocking, unthemed browser dialog that ignores
// the app's focus management and cannot be styled or tested. This hook
// gives the same one-line ergonomics (`if (!(await confirm({...}))) return`)
// on top of the canonical <ConfirmDialog>:
//
//   const { confirm, dialog } = useConfirm();
//   …
//   if (!(await confirm({ title: 'Revoke device?', description: '…',
//                         confirmLabel: 'Revoke', variant: 'destructive' }))) return;
//   …
//   return <>{…}{dialog}</>;
//
// Only one confirmation is open at a time; asking again while one is
// pending resolves the earlier one with `false`.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useRef, useState } from 'react';
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog.js';

export type ConfirmOptions = Pick<
  ConfirmDialogProps,
  'title' | 'description' | 'confirmLabel' | 'cancelLabel' | 'variant'
>;

export interface UseConfirmResult {
  /** Resolves `true` when the user confirms, `false` on cancel/dismiss. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Render this once, anywhere in the component's tree. */
  dialog: React.ReactNode;
}

export function useConfirm(): UseConfirmResult {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setPending(null);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current?.(false);
        resolverRef.current = resolve;
        setPending(options);
      }),
    [],
  );

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      title={pending?.title ?? ''}
      description={pending?.description ?? ''}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      variant={pending?.variant}
      onConfirm={() => settle(true)}
    />
  );

  return { confirm, dialog };
}
