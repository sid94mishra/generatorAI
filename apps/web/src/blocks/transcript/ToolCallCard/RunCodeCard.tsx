// ────────────────────────────────────────────────────────────────
// The `run_code` tool card (D-182, PLAN §6): the script the agent ran, each
// tool call it made (tool, ok / failed, duration), its logs and its result.
// Composed from the kit only (D-178): CodeBlock, KeyValueList, Badge,
// StatusDot. The row's verb ("Ran code" / "Running code") comes from the
// ui-contract verb table; a failed script's error is the row's inline error
// (the report is a `{ ok: false, error }` envelope), so it is not repeated.
// Registered from app/registries/codeModeTranscriptCards.ts.
// ────────────────────────────────────────────────────────────────

import type { TimelineStep } from '@generatorai/client-core';
import { toolDisplayName } from '@generatorai/shared/ui-contract';
import { CodeBlock } from '@/ui/patterns/CodeBlock/CodeBlock.js';
import { KeyValueList, type KeyValueItem } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { StatusDot } from '@/ui/primitives/StatusDot/StatusDot.js';
import type { ToolCardEntry, ToolCardProps } from './toolCardRegistry.js';

/** One call in the script's trace. */
export interface RunCodeCall {
  tool: string;
  ok: boolean;
  ms: number;
  error?: string;
}

/** The report `run_code` returns (packages/core tools/codeMode/sandbox.ts `SandboxReport`). */
export interface RunCodeReport {
  ok: boolean;
  error?: string;
  result?: unknown;
  logs: string[];
  calls: RunCodeCall[];
  truncated?: boolean;
}

/** Calls listed before the rest are summarised as a count. */
const MAX_LISTED_CALLS = 12;

function asText(result: unknown): string | null {
  if (typeof result === 'string') return result;
  // An MCP content array ([{ type: 'text', text }]) or a `{ content: [...] }` envelope.
  const blocks = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && Array.isArray((result as { content?: unknown }).content)
      ? (result as { content: unknown[] }).content
      : null;
  if (!blocks) return null;
  const texts = blocks.flatMap((b) =>
    b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? [(b as { text: string }).text] : [],
  );
  return texts.length > 0 ? texts.join('') : null;
}

/** The report from a step's result (JSON text, a parsed object or MCP text blocks); null when it is not one. */
export function parseRunCodeReport(result: unknown): RunCodeReport | null {
  let value: unknown = result;
  const text = asText(result);
  if (text !== null) {
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (!Array.isArray(r['logs']) || !Array.isArray(r['calls'])) return null;
  const calls = (r['calls'] as unknown[]).flatMap((c): RunCodeCall[] => {
    if (!c || typeof c !== 'object') return [];
    const call = c as Record<string, unknown>;
    if (typeof call['tool'] !== 'string') return [];
    return [
      {
        tool: call['tool'],
        ok: call['ok'] === true,
        ms: typeof call['ms'] === 'number' ? call['ms'] : 0,
        ...(typeof call['error'] === 'string' ? { error: call['error'] } : {}),
      },
    ];
  });
  return {
    ok: r['ok'] !== false,
    ...(typeof r['error'] === 'string' ? { error: r['error'] } : {}),
    ...('result' in r ? { result: r['result'] } : {}),
    logs: (r['logs'] as unknown[]).map((l) => (typeof l === 'string' ? l : JSON.stringify(l))),
    calls,
    ...(r['truncated'] === true ? { truncated: true } : {}),
  };
}

function scriptOf(step: TimelineStep): string {
  const code = step.args && typeof step.args === 'object' ? (step.args as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : '';
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function resultText(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2) ?? String(result);
  } catch {
    return String(result);
  }
}

function callItems(calls: readonly RunCodeCall[]): KeyValueItem[] {
  return calls.slice(0, MAX_LISTED_CALLS).map((call) => ({
    label: (
      <span className="inline-flex items-center gap-1.5">
        <StatusDot tone={call.ok ? 'ok' : 'err'} size="sm" />
        {call.ok ? 'OK' : 'Failed'}
      </span>
    ),
    value: (
      <span title={call.error ?? call.tool}>
        {toolDisplayName(call.tool)}
        {call.error ? <span className="text-err"> · {call.error}</span> : null}
      </span>
    ),
    meta: formatMs(call.ms),
  }));
}

/** The card body: script, call trace, logs, result. */
export function RunCodeCard({ step }: ToolCardProps) {
  const script = scriptOf(step);
  const report = step.status === 'running' ? null : parseRunCodeReport(step.result);
  const failed = report?.calls.filter((c) => !c.ok).length ?? 0;
  const hidden = report ? report.calls.length - MAX_LISTED_CALLS : 0;

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid="run-code-card">
      {script ? (
        <CodeBlock lang="javascript" header="Script" copy={script} collapse>
          {script}
        </CodeBlock>
      ) : null}
      {report ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="run-code-summary">
            <Badge size="sm">
              {report.calls.length} {report.calls.length === 1 ? 'tool call' : 'tool calls'}
            </Badge>
            {failed > 0 ? (
              <Badge size="sm" tone="err">
                {failed} failed
              </Badge>
            ) : null}
            {report.truncated ? (
              <Badge size="sm" tone="warn">
                Output truncated
              </Badge>
            ) : null}
          </div>
          {report.calls.length > 0 ? (
            <div className="flex min-w-0 flex-col gap-1" data-testid="run-code-calls">
              <KeyValueList items={callItems(report.calls)} labelWidth={72} dense className="gap-0" />
              {hidden > 0 ? <span className="text-small text-fg-3">and {hidden} more</span> : null}
            </div>
          ) : null}
          {report.logs.length > 0 ? (
            <CodeBlock header="Logs" copy={report.logs.join('\n')} wrap collapse>
              {report.logs.join('\n')}
            </CodeBlock>
          ) : null}
          {report.result !== undefined ? (
            <CodeBlock {...(typeof report.result === 'string' ? {} : { lang: 'json' })} header="Result" copy={resultText(report.result)} wrap collapse>
              {resultText(report.result)}
            </CodeBlock>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** The registry entry: matched bare or MCP-namespaced (`mcp__generatorai-tools__run_code`). */
export const RUN_CODE_TOOL_CARD: ToolCardEntry = {
  id: 'code-mode.run-code',
  match: 'run_code',
  icon: 'braces',
  target: (step) => {
    const report = step.status === 'running' ? null : parseRunCodeReport(step.result);
    if (report) return `${report.calls.length} ${report.calls.length === 1 ? 'tool call' : 'tool calls'}`;
    const first = scriptOf(step).trim().split(/\r?\n/)[0] ?? '';
    return first.length > 60 ? `${first.slice(0, 59)}…` : first;
  },
  Card: RunCodeCard,
};
