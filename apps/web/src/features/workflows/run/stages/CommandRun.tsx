// ────────────────────────────────────────────────────────────────
// What a command stage (kind `check`: one program, no agent) shows in its
// row (D-174), read like a command an agent ran in the chat: a header
// "Running / Ran `<command line>`" with the exit code, the time and copy; a
// fixed-height output box that follows the newest lines while it runs (until
// the person scrolls up); and a details line — where it ran, its timeout,
// what the exit means and the full output in the inspector. While it runs
// the text is the live stream (D-173); after a reload or once it ends, the
// stored tails.
// ────────────────────────────────────────────────────────────────

import { useLayoutEffect, useRef } from 'react';
import { formatStepDuration } from '@generatorai/client-core';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import type { StageView } from '../model/types.js';

/** The output so far: the live stream, else (after a reload, or once finished) the stored tails. */
export function commandOutputText(stage: Pick<StageView, 'liveOutput' | 'outputData'>): string {
  if (stage.liveOutput) return stage.liveOutput;
  const out = stage.outputData;
  const tails = [out?.['stdoutTail'], out?.['stderrTail']].filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  return tails.join('\n');
}

/** How the finished command ended, from its stored output: exit code, passed, timed out. */
export function commandOutcome(out: Record<string, unknown> | undefined): { tone: 'ok' | 'err'; label: string } | null {
  if (!out || typeof out['exitCode'] !== 'number') return null;
  if (out['timedOut'] === true) return { tone: 'err', label: 'timed out' };
  return out['exitCode'] === 0 ? { tone: 'ok', label: 'exit 0' } : { tone: 'err', label: `exit ${out['exitCode']}` };
}

/** "10 min", "45 s". */
function formatTimeout(ms: number): string {
  return ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 1000)} s`;
}

/** Within this many pixels of the bottom the box keeps following new lines. */
const FOLLOW_SLACK = 24;

export function CommandRun({
  stage,
  running,
  onOpenOutput,
}: {
  stage: StageView;
  running: boolean;
  /** Opens the stage in the inspector (its Output tab holds the full tails). */
  onOpenOutput?: (() => void) | undefined;
}) {
  const text = commandOutputText(stage);
  const outcome = running ? null : commandOutcome(stage.outputData);
  const duration = running ? null : formatStepDuration(stage.durationMs);
  const box = useRef<HTMLPreElement>(null);
  const follow = useRef(true);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  const command = stage.command;
  if (!command && !text) return null;
  const where = [command?.mount ?? 'primary mount', command?.cwd].filter(Boolean).join(' / ');

  const copy = () => {
    void navigator.clipboard.writeText(text).then(
      () => toast.done('Output copied'),
      () => toast.error('Could not copy the output'),
    );
  };

  return (
    <section
      aria-label={`${stage.name} command`}
      className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-raised"
      data-testid="command-run"
    >
      <div className="flex h-step min-w-0 items-center gap-1.5 border-b border-line-soft px-2.5 text-small text-fg-2">
        {running ? (
          <Spinner size={14} />
        ) : (
          <Icon
            concept={outcome?.tone === 'err' ? 'status-failed' : 'status-succeeded'}
            size={14}
            className={cn('shrink-0', outcome?.tone === 'err' ? 'text-err' : 'text-ok')}
          />
        )}
        <span className="shrink-0">{running ? 'Running' : 'Ran'}</span>
        {command ? <InlineCode className="min-w-0 truncate">{command.line}</InlineCode> : null}
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-micro text-fg-3">
          {outcome ? <span className={outcome.tone === 'err' ? 'text-err' : undefined}>{outcome.label}</span> : null}
          {duration ? <span>{duration}</span> : null}
        </span>
        {text ? <IconButton size="sm" icon="copy" label="Copy the output" onClick={copy} /> : null}
      </div>
      <pre
        ref={box}
        tabIndex={0}
        aria-label={`${stage.name} output`}
        aria-live={running ? 'polite' : undefined}
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK;
        }}
        className={cn(
          'min-w-0 overflow-auto bg-sunken px-3 py-2 font-mono text-small break-words whitespace-pre-wrap text-fg-2',
          running ? 'min-h-64 max-h-64' : 'max-h-64',
        )}
        data-testid="command-output"
      >
        {text || <span className="text-fg-3">{running ? 'Started — waiting for the first line…' : 'No output.'}</span>}
      </pre>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft px-2.5 py-1 text-micro text-fg-3">
        <span className="min-w-0 truncate">
          In <span className="font-mono">{where}</span>
        </span>
        {command ? <span>Timeout {formatTimeout(command.timeoutMs)}</span> : null}
        {stage.outputData?.['passed'] === false && !running ? (
          <span className="text-err">{stage.outputData['timedOut'] === true ? 'Killed at its timeout' : 'Did not pass'}</span>
        ) : null}
        {onOpenOutput && !running ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onOpenOutput}>
            Full output
          </Button>
        ) : null}
      </div>
    </section>
  );
}
