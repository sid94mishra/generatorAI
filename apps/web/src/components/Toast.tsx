// ────────────────────────────────────────────────────────────────
// Toast — adapter over the design-system toaster (sonner).
// Keeps the original `toast({ variant, title, description, logs,
// duration })` API so existing call sites work unchanged, while the
// rendering is the canonical token-styled sonner Toaster.
// Mount <Toaster /> once at the app root (App.tsx).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { toast as sonnerToast } from 'sonner';

export { Toaster } from '@/components/ui/primitives/sonner.js';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  /** Expandable log block (e.g. clone failure output) */
  logs?: string;
  /** ms; 0 = sticky until dismissed */
  duration?: number;
}

function renderDescription(msg: Omit<ToastMessage, 'id'>): React.ReactNode {
  if (!msg.logs) return msg.description;
  return (
    <div className="space-y-1.5">
      {msg.description && <div>{msg.description}</div>}
      <pre className="max-h-40 overflow-auto rounded-md bg-subtle p-2 font-mono text-[11px] leading-snug text-muted-foreground">
        {msg.logs}
      </pre>
    </div>
  );
}

export function toast(msg: Omit<ToastMessage, 'id'>) {
  // Match the legacy defaults: errors stick around longer; 0 = sticky.
  const duration =
    msg.duration === 0
      ? Infinity
      : (msg.duration ?? (msg.variant === 'error' ? 8000 : 4000));
  const opts = { description: renderDescription(msg), duration };
  switch (msg.variant) {
    case 'success':
      return sonnerToast.success(msg.title, opts);
    case 'error':
      return sonnerToast.error(msg.title, opts);
    case 'warning':
      return sonnerToast.warning(msg.title, opts);
    case 'info':
      return sonnerToast.info(msg.title, opts);
  }
}

export function dismissToast(id: string | number) {
  sonnerToast.dismiss(id);
}
