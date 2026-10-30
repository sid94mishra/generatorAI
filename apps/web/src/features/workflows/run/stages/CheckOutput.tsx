// ────────────────────────────────────────────────────────────────
// What a check stage (a command, no agent) shows in its row (D-173): the
// command line, "Running" while it runs, and its output as it prints — the
// newest lines, the way a terminal shows them. Once it ends, the same block
// keeps the end of its output (the full tails are in the inspector's Output).
// ────────────────────────────────────────────────────────────────

import { CodeBlock } from '@/ui/patterns/CodeBlock/CodeBlock.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import type { StageView } from '../model/types.js';

/** Lines of output the row shows; a terminal's worth, the newest at the bottom. */
const SHOWN_LINES = 40;

/** The output so far: the live stream, else (after a reload, or once finished) the stored tails. */
export function checkOutputText(stage: Pick<StageView, 'liveOutput' | 'outputData'>): string {
  if (stage.liveOutput) return stage.liveOutput;
  const out = stage.outputData;
  const tails = [out?.['stdoutTail'], out?.['stderrTail']].filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  return tails.join('\n');
}

/** The last `n` lines of `text`, without the trailing newline. */
export function lastLines(text: string, n: number): string {
  const lines = text.replace(/\n+$/, '').split('\n');
  return lines.length <= n ? lines.join('\n') : lines.slice(-n).join('\n');
}

export function CheckOutput({ stage, running }: { stage: StageView; running: boolean }) {
  const text = checkOutputText(stage);
  if (!stage.command && !text) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="check-output">
      {running ? (
        <p className="flex min-w-0 items-center gap-2 text-small text-fg-2" aria-live="polite">
          <Spinner size={14} />
          <span className="shrink-0">Running</span>
          {stage.command ? <InlineCode className="truncate">{stage.command}</InlineCode> : null}
        </p>
      ) : null}
      {text ? (
        <CodeBlock header={stage.command ? `$ ${stage.command}` : undefined} copy={text} wrap>
          {lastLines(text, SHOWN_LINES)}
        </CodeBlock>
      ) : null}
    </div>
  );
}
