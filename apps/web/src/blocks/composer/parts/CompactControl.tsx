// ────────────────────────────────────────────────────────────────
// CompactControl — compact the conversation from the composer
// (docs/compaction): the icon beside the context gauge.
//
// A popover says what compacting does, takes optional focus instructions
// and starts it. The compaction then streams on the chat like a turn
// ("Compacting conversation…" → "Compacted · 150K → 20K tokens") and the
// gauge drops, so this only has to start it and report a refusal.
// Presentational: the composer passes `onCompact`.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';

export interface CompactControlProps {
  /** Starts the compaction; rejects with the server's reason when it was refused. */
  onCompact: (instructions?: string) => Promise<unknown>;
  /** A turn is running (or the composer is disabled): compacting waits for it. */
  disabled?: boolean;
  /** How full the context window is (0–1), when known — said in the popover. */
  fill?: number | null;
}

export function CompactControl({ onCompact, disabled = false, fill }: CompactControlProps) {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCompact(instructions.trim() || undefined);
      setInstructions('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PopoverRoot open={open} onOpenChange={(next) => { setOpen(next); if (next) setError(null); }}>
      <PopoverTrigger
        render={
          <IconButton
            icon="compact"
            label="Compact conversation"
            size="sm"
            disabled={disabled}
            pressed={open ? true : undefined}
            data-testid="compact-conversation-trigger"
          />
        }
      />
      <PopoverPopup side="top" align="end" className="w-80 p-3" data-testid="compact-conversation-popover">
        <div className="flex flex-col gap-2 text-small">
          <PopoverTitle className="text-ui font-medium text-fg">Compact conversation</PopoverTitle>
          <p className="text-fg-2">
            Summarises the conversation so far; the agent continues from the summary with room to spare.
            {fill != null ? ` The context window is ${Math.round(fill * 100)}% full.` : ''}
          </p>
          <Textarea
            variant="md"
            autosize
            aria-label="What the summary should focus on"
            placeholder="Focus on… (optional)"
            value={instructions}
            maxLength={2000}
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void start();
              }
            }}
          />
          {error ? (
            <p className="text-err" role="alert" data-testid="compact-conversation-error">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={busy || disabled} onClick={() => void start()} data-testid="compact-conversation-confirm">
              {busy ? 'Starting…' : 'Compact'}
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </PopoverRoot>
  );
}
