// ────────────────────────────────────────────────────────────────
// B-23 BackgroundStepTail — a long command still running in the background:
// "Running pnpm build · in background · 0:18" and the last three lines of its
// output with a caret.
//
// GAP (05-gap-matrix, D-36): tool output arrives only on completion
// (`ToolCallBlock.result`). The tail needs `tool_call.output_delta {callId,
// chunk, seq}` events kept as a bounded tail in the client-core reducer. Until
// that lands this part exists in Storybook only; the transcript does not render
// it.
// ────────────────────────────────────────────────────────────────

import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Icon } from '@/ui/icons/Icon.js';

export interface BackgroundStepTailProps {
  /** The command ("pnpm build"). */
  command: string;
  /** Elapsed, formatted ("0:18"). */
  elapsed: string;
  /** Output so far; the last three lines are shown. */
  lines: readonly string[];
  running?: boolean;
}

/** The live tail of a background command. */
export function BackgroundStepTail({ command, elapsed, lines, running = true }: BackgroundStepTailProps) {
  const tail = lines.slice(-3);
  return (
    <div className="flex min-w-0 flex-col" data-testid="background-step-tail" data-gai-block="background-tail">
      <div className="flex h-step min-w-0 items-center gap-2.5 pl-0.5 text-ui">
        <span className="flex size-4 shrink-0 items-center justify-center">
          {running ? <Spinner size={14} className="text-run" /> : <Icon concept="status-succeeded" size={16} className="text-ok" />}
        </span>
        <span className="shrink-0 font-medium text-fg">{running ? 'Running' : 'Ran'}</span>
        <span className="min-w-0 truncate font-mono text-small text-fg-2">{command}</span>
        <span className="shrink-0 text-small text-fg-3">{TRANSCRIPT_COPY.inBackground}</span>
        <span className="ml-auto shrink-0 font-mono text-micro text-run">{elapsed}</span>
      </div>
      <pre
        className="ml-6 overflow-hidden rounded-control border border-line-soft bg-sunken px-2.5 py-1.5 font-mono text-small whitespace-pre text-fg-2"
        aria-live="polite"
      >
        {tail.join('\n')}
        {running ? <span aria-hidden className="ml-0.5 inline-block w-0.5 animate-pulse bg-fg align-middle reduced:animate-none">&nbsp;</span> : null}
      </pre>
    </div>
  );
}
