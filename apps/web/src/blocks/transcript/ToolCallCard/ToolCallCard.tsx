// ────────────────────────────────────────────────────────────────
// B-18 ToolCallCard — the card a tool-card registry entry draws under its step
// row (WF-12/13/14 are cards of this frame): header 28h "Called `tool` ·
// subject · duration", the entry's body, optional footer actions.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import type { TimelineStep } from '@generatorai/client-core';
import { formatStepDuration } from '@generatorai/client-core';
import { humanizeToolName } from '@generatorai/shared/ui-contract';
import { cn } from '@/ui/lib/cn.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { useTranscriptActions } from '../transcriptContext.js';
import type { ToolCardEntry } from './toolCardRegistry.js';

export interface ToolCallCardFrameProps {
  /** Tool name shown in the header. */
  tool: string;
  subject?: string;
  duration?: string | null;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** The card frame: header "Called `tool` · subject · duration", body, footer. */
export function ToolCallCardFrame({ tool, subject, duration, children, footer, className }: ToolCallCardFrameProps) {
  return (
    <div
      className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-raised', className)}
      data-testid="tool-call-card"
      data-gai-block="tool-card"
    >
      <div className="flex h-step min-w-0 items-center gap-1.5 border-b border-line-soft px-2.5 text-small text-fg-2">
        <span className="shrink-0">Called</span>
        <InlineCode>{tool}</InlineCode>
        {subject ? <span className="min-w-0 truncate">· {subject}</span> : null}
        {duration ? <span className="ml-auto shrink-0 font-mono text-micro text-fg-3">{duration}</span> : null}
      </div>
      {children != null ? <div className="min-w-0 p-2.5 text-ui text-fg">{children}</div> : null}
      {footer != null ? (
        <div className="flex items-center justify-end gap-2 border-t border-line-soft px-2.5 py-1.5">{footer}</div>
      ) : null}
    </div>
  );
}

/** A registry entry's card for one step, in the standard frame. */
export function ToolCallCard({ step, entry, live }: { step: TimelineStep; entry: ToolCardEntry; live: boolean }) {
  const actions = useTranscriptActions();
  const Card = entry.Card;
  if (!Card) return null;
  const subject = entry.subject?.(step);
  return (
    <ToolCallCardFrame
      tool={humanizeToolName(step.tool ?? '')}
      {...(subject ? { subject } : {})}
      duration={formatStepDuration(step.durationMs)}
    >
      <Card step={step} ctx={{ actions, live }} />
    </ToolCallCardFrame>
  );
}
