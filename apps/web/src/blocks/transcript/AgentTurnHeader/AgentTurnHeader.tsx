// ────────────────────────────────────────────────────────────────
// B-15 AgentTurnHeader — who answered: Avatar 20 (initials on chat, the bot
// glyph on workflow surfaces), agent name 500, model fg-3, time mono right.
// A collapsed turn shows its one-line digest ("6 steps · +14 −6") instead of
// its body; a finished turn shows its usage chip on hover.
//
// States: streaming (a spinner after the name) · complete · collapsed.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '@/ui/lib/cn.js';
import { Avatar } from '@/ui/primitives/Avatar/Avatar.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Icon } from '@/ui/icons/Icon.js';
import { formatTurnTime } from '../formatTime.js';
import { ProviderLogo } from '@/ui/primitives/ProviderLogo/ProviderLogo.js';

export interface AgentTurnHeaderProps {
  /** Agent (or harness) name: "Bug Fixer", "Claude". */
  agentName: string;
  /** Model the turn ran on, when known (its display name). */
  model?: string | undefined;
  /** The provider that ran it: its logo leads the model name (D-132). */
  provider?: string | undefined;
  /** When the response was written; omitted while streaming. */
  timestamp?: Date | string | number | undefined;
  /** `bot` on workflow surfaces (agents there draw the glyph, not initials). */
  avatar?: 'initials' | 'bot';
  streaming?: boolean;
  /** The turn is collapsed: show this digest line after the name. */
  digest?: string | undefined;
  /** Hover detail (the usage chip of a finished turn). */
  usage?: ReactNode;
  /** Right-side controls (collapse toggle). */
  trailing?: ReactNode;
  className?: string;
}

/** The header line of an agent response. */
export function AgentTurnHeader({
  agentName,
  model,
  provider,
  timestamp,
  avatar = 'initials',
  streaming = false,
  digest,
  usage,
  trailing,
  className,
}: AgentTurnHeaderProps) {
  const time = timestamp != null ? formatTurnTime(timestamp) : null;
  return (
    <div className={cn('group/header flex h-step min-w-0 items-center gap-2 text-ui', className)} data-testid="agent-turn-header">
      {avatar === 'bot' ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-control-sm bg-selected text-fg-2">
          <Icon concept="agents" size={14} />
        </span>
      ) : (
        <Avatar name={agentName} size={20} decorative />
      )}
      <span className="shrink-0 font-medium text-fg">{agentName}</span>
      {model ? (
        <span className="flex min-w-0 items-center gap-1 text-fg-3">
          {provider ? <ProviderLogo provider={provider} size={12} /> : null}
          <span className="min-w-0 truncate">{model}</span>
        </span>
      ) : null}
      {streaming ? <Spinner size={12} className="shrink-0 text-run" label="Responding" /> : null}
      {digest ? <span className="min-w-0 truncate text-small text-fg-3">· {digest}</span> : null}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {usage != null ? (
          <span className="hidden group-hover/header:inline-flex group-focus-within/header:inline-flex">{usage}</span>
        ) : null}
        {time ? <span className="font-mono text-micro text-fg-3">{time}</span> : null}
        {trailing}
      </span>
    </div>
  );
}
