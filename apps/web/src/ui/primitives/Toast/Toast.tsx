// ────────────────────────────────────────────────────────────────
// P-34 Toast — the sonner wrapper, restyled (03 §2 P-34, D-30).
//
// ONLY for errors and background-job completions; inline status (callouts,
// badges) everywhere else, never a success toast for an inline action.
// Card: `bg-overlay`, 1px line, card radius, `shadow-pop`, pad 10 12, ui text;
// tone glyph (err `status-failed`, done `status-succeeded`, info run);
// description small fg-2; optional sm action and expandable `logs`;
// bottom-right, 16px from the edges, on the toast layer (D-41).
// The toaster region carries `data-gai-overlay="toast"` and each toast keeps
// sonner's own `data-sonner-toast`, which the native browser view also
// matches (D-19, `GAI_OVERLAY_SELECTOR`). The toaster has its own id, so
// only `toast.*` from here reaches it.
// ────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode } from 'react';
import { Toaster as Sonner, toast as sonnerToast } from 'sonner';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';
import { overlayProps } from '../../lib/overlay.js';
import { floatSurface } from '../../lib/popup.js';
import { Icon } from '../../icons/Icon.js';
import { Button } from '../Button/Button.js';
import { IconButton } from '../IconButton/IconButton.js';

const TOASTER_ID = 'gai';
// The toast layer from the z-scale (D-41); a variable, so no literal style.
const TOASTER_STYLE: CSSProperties = { zIndex: 'var(--gai-z-toast)' };

type ToastTone = 'err' | 'done' | 'info';

const TONE: Record<ToastTone, { icon: IconConcept; className: string }> = {
  err: { icon: 'status-failed', className: 'text-err' },
  done: { icon: 'status-succeeded', className: 'text-ok' },
  info: { icon: 'info', className: 'text-run' },
};

export interface ToastOptions {
  description?: ReactNode;
  /** Raw output shown behind a "Show logs" disclosure (mono, scrolls). */
  logs?: string;
  action?: { label: string; onClick: () => void };
  /** ms; errors stay 8 s by default, completions 5 s. `Infinity` keeps it. */
  duration?: number;
  id?: string;
}

export interface ToastCardProps extends ToastOptions {
  tone: ToastTone;
  title: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/** The toast body. Exported for stories and tests; fire toasts with `toast.*`. */
export function ToastCard({ tone, title, description, logs, action, onDismiss, className }: ToastCardProps) {
  const t = TONE[tone];
  return (
    <div className={cn(floatSurface, 'flex w-90 max-w-full items-start gap-2.5 rounded-card px-3 py-2.5 text-ui', className)}>
      <Icon concept={t.icon} size={16} className={cn('mt-0.5', t.className)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="font-medium text-fg">{title}</div>
        {description != null ? <div className="text-small text-fg-2">{description}</div> : null}
        {logs ? (
          <details className="group text-small text-fg-2">
            <summary className={cn('cursor-pointer rounded-badge text-fg-3 select-none hover:text-fg', focusRing)}>Show logs</summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded-control border border-line-soft bg-sunken px-2.5 py-2 font-mono text-small whitespace-pre-wrap text-fg-2">
              {logs}
            </pre>
          </details>
        ) : null}
        {action ? (
          <div className="mt-1 flex">
            <Button size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          </div>
        ) : null}
      </div>
      {onDismiss ? <IconButton size="sm" icon="x" label="Dismiss" tooltip={false} onClick={onDismiss} className="-mt-0.5 -mr-1" /> : null}
    </div>
  );
}

function show(tone: ToastTone, title: ReactNode, options: ToastOptions = {}): string | number {
  const { duration, id, ...card } = options;
  return sonnerToast.custom(
    (toastId) => <ToastCard tone={tone} title={title} {...card} onDismiss={() => sonnerToast.dismiss(toastId)} />,
    {
      toasterId: TOASTER_ID,
      duration: duration ?? (tone === 'err' ? 8000 : 5000),
      ...(id ? { id } : {}),
    },
  );
}

/**
 * Fire a toast (D-30: errors and background completions only).
 * `toast.error('Push failed', { description, logs, action })`,
 * `toast.done('Nightly audit finished', { action: { label: 'Open', onClick } })`.
 */
export const toast = {
  error: (title: ReactNode, options?: ToastOptions) => show('err', title, options),
  done: (title: ReactNode, options?: ToastOptions) => show('done', title, options),
  info: (title: ReactNode, options?: ToastOptions) => show('info', title, options),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
};

export interface ToasterProps {
  /** Accessible name of the notifications region. */
  label?: string;
}

/** The toast region; S-13 mounts it once inside the app frame. */
export function Toaster({ label = 'Notifications' }: ToasterProps) {
  return (
    <div className="contents" {...overlayProps('toast')}>
      <Sonner
        id={TOASTER_ID}
        position="bottom-right"
        offset={16}
        gap={8}
        style={TOASTER_STYLE}
        containerAriaLabel={label}
        toastOptions={{ unstyled: true }}
      />
    </div>
  );
}
