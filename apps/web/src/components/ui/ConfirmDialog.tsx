// ────────────────────────────────────────────────────────────────
// ConfirmDialog — the canonical confirmation surface. Replaces
// browser confirm() and hand-rolled confirm modals everywhere.
// Built on the vendored Radix AlertDialog part (blocking, focus
// trap, ARIA) — keeps the original prop API.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from './primitives/alert-dialog.js';
import { Button } from './Button.js';
import { cn } from '@/lib/utils.js';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'warning' | 'default';
  loading?: boolean;
  onConfirm: () => void;
}

const VARIANT_STYLES = {
  destructive: {
    icon: 'bg-danger-muted text-danger',
    button: 'bg-destructive text-destructive-foreground border-transparent hover:opacity-90 hover:bg-destructive',
  },
  warning: {
    icon: 'bg-warning-muted text-warning',
    button: 'bg-warning text-white border-transparent hover:opacity-90 hover:bg-warning',
  },
  default: {
    icon: 'bg-info-muted text-primary',
    button: '',
  },
} as const;

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const styles = VARIANT_STYLES[variant];

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Don't allow closing while a mutation is in-flight
        if (loading && !next) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent className="p-6">
        <div className="flex gap-4">
          <div
            className={cn(
              'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full',
              styles.icon,
            )}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription className="mt-1.5">{description}</AlertDialogDescription>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            // Cancel gets initial focus for destructive confirms so Enter
            // can't accidentally destroy something.
            autoFocus={variant === 'destructive'}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'default' ? 'primary' : 'secondary'}
            className={styles.button}
            onClick={onConfirm}
            loading={loading}
            autoFocus={variant !== 'destructive'}
          >
            {confirmLabel}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
