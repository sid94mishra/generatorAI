// ────────────────────────────────────────────────────────────────
// UsageChip — the "gpt-5.4-mini · ↑12k ↓3k · 43s" footer.
// Shared by the workflow-run stage timeline and chat assistant turns.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { UsageInfo } from '@/components/chat/redesign/types.js';

export function UsageChip({ usage }: { usage: UsageInfo }) {
  return (
    <div className="inline-flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)]/60 bg-[var(--color-subtle)]/50 px-2.5 py-1 text-[10.5px] text-[var(--color-muted-foreground)]">
      <span className="font-semibold text-[var(--color-foreground)]/85">{usage.model}</span>
      <span className="h-2.5 w-px bg-[var(--color-border)]/70" />
      <span title="Input tokens">↑ {usage.inputTokens.toLocaleString()}</span>
      <span title="Output tokens">↓ {usage.outputTokens.toLocaleString()}</span>
      <span className="h-2.5 w-px bg-[var(--color-border)]/70" />
      <span title="Duration">{(usage.durationMs / 1000).toFixed(1)}s</span>
    </div>
  );
}
