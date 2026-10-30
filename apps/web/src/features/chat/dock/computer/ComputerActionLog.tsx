// The Computer tab's action log: every desktop action, refusal and consent
// prompt, newest first. Clicking a row holds the window as it was at that
// moment ("pins" it); an action with no capture of its own shows the last
// window the agent read before it.

import type { IconConcept } from '@generatorai/design-tokens';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { tookScreen, type ComputerTimelineEntry } from '@/hooks/computerTimeline.js';

function glyph(entry: ComputerTimelineEntry): { concept: IconConcept; className: string } {
  if (entry.kind === 'refusal') return { concept: 'status-failed', className: 'text-err' };
  if (entry.kind === 'consent') return { concept: 'hand', className: 'text-warn' };
  if (entry.action === 'snapshot') return { concept: 'view', className: 'text-fg-3' };
  if (tookScreen(entry.path)) return { concept: 'keyboard', className: 'text-warn' };
  return { concept: 'pointer', className: 'text-fg-3' };
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export interface ComputerActionLogProps {
  entries: readonly ComputerTimelineEntry[];
  pinnedId: string | null;
  pinnedIsFallback: boolean;
  onPin: (entry: ComputerTimelineEntry) => void;
  onUnpin: () => void;
}

export function ComputerActionLog({ entries, pinnedId, pinnedIsFallback, onPin, onUnpin }: ComputerActionLogProps) {
  return (
    <section aria-label="Activity" className="flex flex-col gap-1 border-t border-line-soft px-3 py-2">
      <SectionHeader
        level={3}
        title="Activity"
        count={entries.length > 0 ? entries.length : undefined}
        hint={pinnedId ? (pinnedIsFallback ? 'Last window read before this step' : 'Showing a past frame') : undefined}
        action={
          pinnedId ? (
            <Button size="sm" variant="ghost" icon="back" onClick={onUnpin}>
              Back to live
            </Button>
          ) : undefined
        }
      />
      {entries.length === 0 ? (
        <p className="py-2 text-small text-fg-3">
          Nothing yet. Every desktop action the agent takes is listed here as it happens.
        </p>
      ) : (
        <ul className="flex flex-col" data-testid="computer-action-log">
          {entries.map((entry) => {
            const g = glyph(entry);
            const pinned = pinnedId === entry.id;
            return (
              <li key={entry.id}>
                <Button
                  size="sm"
                  variant="ghost"
                  fullWidth
                  pressed={pinned}
                  onClick={() => onPin(entry)}
                  title={entry.message ?? (tookScreen(entry.path) ? 'Took over the keyboard and mouse' : undefined)}
                  className="justify-start gap-2 font-normal"
                >
                  {/* One flex row: Button wraps its children in a block span, where a block Icon broke the line (U-63). */}
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-20 shrink-0 text-left font-mono text-micro text-fg-3">{clock(entry.at)}</span>
                    <Icon concept={g.concept} size={12} className={cn('shrink-0', g.className)} />
                    <span className="shrink-0 text-fg">{entry.action}</span>
                    <span className="min-w-0 flex-1 truncate text-left font-mono text-fg-3">
                      {[entry.appLabel, entry.target, entry.message].filter(Boolean).join(' · ')}
                    </span>
                    {entry.kind === 'action' && entry.verified ? (
                      <Icon concept="check" size={12} className="shrink-0 text-ok" label="Verified" />
                    ) : null}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
