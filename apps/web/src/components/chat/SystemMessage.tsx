// ────────────────────────────────────────────────────────────────
// SystemMessage — Renders system chat messages
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { ChatMessage } from '@generatorai/shared';
import { Info } from 'lucide-react';

interface SystemMessageProps {
  message: ChatMessage;
}

export function SystemMessage({ message }: SystemMessageProps) {
  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-start gap-2.5 bg-[var(--color-subtle)] border border-[var(--color-border)] rounded-lg px-4 py-2.5">
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-info)]/15 mt-0.5">
          <Info className="h-3 w-3 text-[var(--color-info)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[var(--color-muted-foreground)] leading-relaxed">
            {message.content}
          </p>
          <span className="mt-1 block text-[10px] text-[var(--color-muted-foreground)] opacity-50">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  );
}
