// ────────────────────────────────────────────────────────────────
// B-21 InlineError — what a failed tool call or a stream error said, in place:
// `sunken`, radius 6 (control), mono 12, `err` text ("BrowserService: max
// concurrent sessions (5) reached"). `tone="warn"` for non-fatal notices
// (an MCP server that failed to start).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { cn } from '@/ui/lib/cn.js';

export interface InlineErrorProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The error text; rendered verbatim (pre-wrapped). */
  message: string;
  tone?: 'err' | 'warn';
}

/** A compact error line/box under a step or at the end of a turn. */
export function InlineError({ message, tone = 'err', className, ...rest }: InlineErrorProps) {
  return (
    <div
      role={tone === 'err' ? 'alert' : 'status'}
      className={cn(
        'max-h-40 overflow-auto rounded-control border border-line-soft bg-sunken px-2.5 py-1.5 font-mono text-small break-words whitespace-pre-wrap',
        tone === 'err' ? 'text-err' : 'text-warn',
        className,
      )}
      data-gai-block="error"
      {...rest}
    >
      {message}
    </div>
  );
}
