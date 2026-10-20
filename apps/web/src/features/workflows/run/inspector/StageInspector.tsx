// ────────────────────────────────────────────────────────────────
// StageInspector — the run dock's Inspector tab for the focused stage
// (board WorkflowRun / WorkflowRunLoop, right dock): the stage's name, key
// and status, then kit Tabs — Output · Files · Tools · Hooks · Events
// (the instance's raw run-scope events) · History (the stage across runs).
// The Output tab closes with the stage's own figures (usage, model, time).
// ────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react';
import { CHANGE_KIND, resolveStatus } from '@generatorai/shared';
import type { StepStatus } from '@generatorai/client-core';
import type { IconConcept } from '@generatorai/design-tokens';
import { useRunFileContent } from '@/hooks/workflowQueries.js';
import { FileViewer, type WorkspaceFileContent } from '@/blocks/files/FileViewer.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { CodeBlock } from '@/ui/patterns/CodeBlock/CodeBlock.js';
import { Inspector } from '@/ui/patterns/Inspector/Inspector.js';
import { KeyValueList, type KeyValueItem } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Dialog } from '@/ui/primitives/Dialog/Dialog.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { StatusDot, type DotTone } from '@/ui/primitives/StatusDot/StatusDot.js';
import type { TabItem } from '@/ui/primitives/Tabs/Tabs.js';
import { compactCount, formatMs, formatUsd } from '../model/format.js';
import { hasStructuredOutput, structuredOutputMarkdown } from '../model/structuredOutput.js';
import type { FileChange, HookInvocation, StageView } from '../model/types.js';
import { StageEventsTab } from './StageEventsTab.js';
import { StageHistoryTab } from './StageHistoryTab.js';
import { ModelLabel } from '@/blocks/model-picker/ModelLabel.js';

type Tab = 'output' | 'files' | 'tools' | 'hooks' | 'events' | 'history';

export interface StageInspectorProps {
  stage: StageView | null;
  /** Optional run id — enables click-to-open files and the Events tab. */
  runId: string | undefined;
  /** The run's definition: the History tab lists the stage's executions across its runs. */
  definitionId: string | undefined;
  /**
   * What the Files tab lists (D-22): the files THIS stage changed, from its
   * checkpoint to the next one. Says so, or says why there is nothing.
   */
  filesNote?: string | undefined;
}

/** Step kinds the Tools tab counts (its list also shows other non-thinking steps). */
const TOOL_KINDS = new Set(['tool', 'run', 'search', 'read', 'edit']);

const STEP_TONE: Record<StepStatus, DotTone> = {
  done: 'ok',
  running: 'run',
  waiting: 'neutral',
  failed: 'err',
  pending: 'muted',
};

const KIND_TONE = { ok: 'ok', warn: 'warn', err: 'err', run: 'run', 'fg-3': 'neutral' } as const;

const count = (n: number | undefined): number | undefined => (n && n > 0 ? n : undefined);

export function StageInspector({ stage, runId, definitionId, filesNote }: StageInspectorProps) {
  const [tab, setTab] = useState<Tab>('output');
  const [openFile, setOpenFile] = useState<FileChange | null>(null);

  // If the summary duplicates the output text, only count it once.
  const summaryDupOfText = !!stage?.outputText && !!stage?.summary && stage.summary.trim() === stage.outputText.trim();
  const outputCount = (stage?.outputData ? 1 : 0) + (stage?.outputText ? 1 : 0) + (stage?.summary && !summaryDupOfText ? 1 : 0);
  const items: TabItem[] = [
    { value: 'output', label: 'Output', count: count(outputCount) },
    { value: 'files', label: 'Files', count: count(stage?.files?.length) },
    { value: 'tools', label: 'Tools', count: count(stage?.steps.filter((s) => TOOL_KINDS.has(s.kind)).length) },
    { value: 'hooks', label: 'Hooks', count: count(stage?.hooks?.length) },
    ...(runId ? [{ value: 'events', label: 'Events' }] : []),
    ...(definitionId ? [{ value: 'history', label: 'History' }] : []),
  ];
  // A tab that disappeared (no run id / definition yet) falls back to Output.
  const active: Tab = items.some((t) => t.value === tab) ? tab : 'output';
  const status = stage ? resolveStatus('stageRun', stage.rawStatus) : null;

  const title = stage ? (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate">{stage.name}</span>
      <span className="shrink-0 font-mono text-micro font-normal text-fg-3">{stage.stageKey}</span>
      {status ? <StatusBadge state={status.state} label={status.label} /> : null}
    </span>
  ) : (
    'Select a stage'
  );

  return (
    <aside aria-label="Stage inspector" className="flex h-full min-h-0 flex-col">
      <Inspector
        title={title}
        className="w-full border-l-0"
        {...(stage ? { tabs: { items, value: active, onValueChange: (v: string) => setTab(v as Tab) } } : {})}
      >
        {!stage ? (
          <p className="text-small text-fg-3">
            Focus a stage in the pipeline to see its files, structured output, hook invocations, and tool trace.
          </p>
        ) : null}

        {stage && active === 'output' ? <OutputTab stage={stage} /> : null}
        {stage && active === 'files' ? (
          <>
            {filesNote ? <p className="text-small text-fg-3">{filesNote}</p> : null}
            <FilesTab files={stage.files ?? []} onOpen={runId ? setOpenFile : undefined} />
          </>
        ) : null}
        {stage && active === 'tools' ? <ToolsTab stage={stage} /> : null}
        {stage && active === 'hooks' ? <HooksTab hooks={stage.hooks ?? []} /> : null}
        {stage && active === 'events' && runId ? <StageEventsTab key={stage.id} runId={runId} stageRunId={stage.id} /> : null}
        {stage && active === 'history' && definitionId ? (
          <StageHistoryTab
            definitionId={definitionId}
            stageKey={stage.stageKey}
            currentStageRunId={stage.id}
            currentRunId={runId}
          />
        ) : null}
      </Inspector>

      {runId && openFile ? <RunFileDialog runId={runId} file={openFile} onClose={() => setOpenFile(null)} /> : null}
    </aside>
  );
}

// ── Files ──────────────────────────────────────────────────────

function FilesTab({ files, onOpen }: { files: FileChange[]; onOpen: ((f: FileChange) => void) | undefined }) {
  if (files.length === 0) return <p className="text-small text-fg-3">No file changes.</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {files.map((f, i) => {
        const kind = CHANGE_KIND[f.kind];
        return (
          <li key={i} className="flex min-h-7 min-w-0 items-center gap-1.5">
            <Badge tone={KIND_TONE[kind.tone]} className="w-5 justify-center font-mono" title={kind.label}>
              {kind.letter}
            </Badge>
            <Icon concept="file" size={14} className="text-fg-3" />
            {onOpen ? (
              <Button
                variant="ghost"
                size="sm"
                title={`Open ${f.path}`}
                onClick={() => onOpen(f)}
                className="min-w-0 flex-1 justify-start px-1 font-mono text-micro font-normal text-fg"
              >
                {f.path}
              </Button>
            ) : (
              <span className="min-w-0 flex-1 truncate px-1 font-mono text-micro text-fg" title={f.path}>
                {f.path}
              </span>
            )}
            {f.size ? <span className="shrink-0 font-mono text-micro text-fg-3">{f.size}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The file viewer (blocks/files) in a dialog, reading the run's file endpoint. */
function RunFileDialog({ runId, file, onClose }: { runId: string; file: FileChange; onClose: () => void }) {
  // A stage's files come from its checkpoints in the run workspace
  // (`source: 'workspace'`); the endpoint follows the entry's source.
  const source = file.source ?? 'workspace';
  const { data, isLoading, isFetching, error, refetch } = useRunFileContent(runId, file.path, source);
  const content: WorkspaceFileContent | undefined = data
    ? {
        contents: data.content,
        isTooLarge: data.truncated,
        // No content and not truncated: the endpoint had nothing it could show as text.
        isBinary: data.content === null && !data.truncated,
        size: data.size,
        cacheKey: `${source}:${file.path}:${data.content?.length ?? 0}`,
      }
    : undefined;
  const name = file.path.split(/[/\\]/).pop() ?? file.path;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="xl"
      title={name}
      badge={
        source === 'workspace' ? <Badge tone="ok">New</Badge> : source === 'artifacts' ? <Badge tone="run">Generated</Badge> : undefined
      }
    >
      <FileViewer
        path={file.path}
        file={content}
        loading={isLoading}
        error={error}
        onRefresh={() => void refetch()}
        refreshing={isFetching}
      />
    </Dialog>
  );
}

// ── Output ─────────────────────────────────────────────────────

function Caption({ icon, children }: { icon: IconConcept; children: ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 text-micro font-medium text-fg-3">
      <Icon concept={icon} size={12} />
      {children}
    </div>
  );
}

function OutputTab({ stage }: { stage: StageView }) {
  const { outputData: data, summary, outputText: text } = stage;
  // A text stage whose summary IS its output would render the same wall of
  // text twice — prefer the output text, hide the summary.
  const summaryMatchesText = !!text && !!summary && summary.trim() === text.trim();
  // A JSON stage's result is its data; its text is the closing remark it ended on (D-159). A summary that only
  // restates the data's own fields is not shown again.
  const structured = stage.kind === 'agent' && hasStructuredOutput(data);
  const showSummary = !!summary && !summaryMatchesText && !structured;
  const facts = stageFacts(stage);
  const textBlock = text ? (
    <div>
      <Caption icon="file-text">{structured ? 'last message' : 'output'}</Caption>
      <p className={cn('rounded-control border border-line-soft p-2 text-small whitespace-pre-wrap', structured ? 'bg-raised text-fg-2' : 'bg-sunken text-fg')}>{text}</p>
    </div>
  ) : null;
  return (
    <div className="flex flex-col gap-3">
      {!data && !summary && !text ? <p className="text-small text-fg-3">No structured output or summary.</p> : null}
      {structured ? (
        <div data-testid="stage-structured-result">
          <Caption icon="database">result</Caption>
          <div className="rounded-control border border-line-soft bg-sunken px-3 py-2">
            <Markdown>{structuredOutputMarkdown(data)}</Markdown>
          </div>
        </div>
      ) : (
        textBlock
      )}
      {data ? (
        <div>
          <Caption icon="database">outputData</Caption>
          <CodeBlock lang="json">{JSON.stringify(data, null, 2)}</CodeBlock>
        </div>
      ) : null}
      {structured ? textBlock : null}
      {showSummary ? (
        <div>
          <Caption icon="file-text">summary</Caption>
          <p className="rounded-control border border-line-soft bg-raised p-2 text-small whitespace-pre-wrap text-fg-2">{summary}</p>
        </div>
      ) : null}
      {facts.length > 0 ? <KeyValueList items={facts} labelWidth={108} dense className="border-t border-line-soft pt-3" /> : null}
    </div>
  );
}

/** The stage's own figures — only what the run reported (D-36): usage, model, time, instance. */
function stageFacts(stage: StageView): KeyValueItem[] {
  const out: KeyValueItem[] = [];
  const u = stage.usage;
  if (u) {
    const tokens = (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
    const parts = [`${compactCount(tokens)} tokens`];
    if (u.costUsd !== undefined) parts.push(formatUsd(u.costUsd));
    out.push({ label: 'Stage usage', value: parts.join(' · '), mono: true });
    if (u.model) out.push({ label: 'Model', value: <ModelLabel modelId={u.model} provider={u.provider} /> });
  }
  if (stage.durationMs !== undefined) out.push({ label: 'Duration', value: formatMs(stage.durationMs), mono: true });
  if (stage.instancePath && stage.instancePath !== stage.stageKey) {
    out.push({ label: 'Instance', value: stage.instancePath, mono: true });
  }
  return out;
}

// ── Hooks ──────────────────────────────────────────────────────

function HookGlyph({ status }: { status: HookInvocation['status'] }) {
  if (status === 'ok') return <Icon concept="status-succeeded" size={12} className="text-ok" />;
  if (status === 'failed') return <Icon concept="status-failed" size={12} className="text-err" />;
  // Matches the running dot in the Tools tab — same status vocabulary.
  return <Spinner size={12} className="text-run" />;
}

function HooksTab({ hooks }: { hooks: HookInvocation[] }) {
  if (hooks.length === 0) return <p className="text-small text-fg-3">No hooks fired for this stage.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {hooks.map((h) => (
        <li key={h.id} className="rounded-control border border-line-soft bg-raised px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <HookGlyph status={h.status} />
            <span className="min-w-0 truncate text-small font-medium text-fg">{h.name}</span>
            <span className="ml-auto shrink-0 font-mono text-micro text-fg-3">
              {h.status === 'running' ? 'running…' : h.durationMs !== undefined ? `${h.durationMs}ms` : ''}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge className="font-mono">{h.type}</Badge>
            <Badge className="font-mono">{h.phase}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Tools ──────────────────────────────────────────────────────

function ToolsTab({ stage }: { stage: StageView }) {
  const toolSteps = stage.steps.filter((s) => s.kind !== 'think' && s.kind !== 'note');
  if (toolSteps.length === 0) return <p className="text-small text-fg-3">No tool activity yet.</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {toolSteps.map((s) => (
        <li key={s.id} className="flex min-h-7 min-w-0 items-center gap-1.5 rounded-control px-1.5 hover:bg-hover">
          <StatusDot
            tone={STEP_TONE[s.status]}
            size="sm"
            className={cn(s.status === 'running' && 'animate-pulse reduced:animate-none')}
          />
          <Icon concept="tool" size={12} className="text-fg-3" />
          <span className="min-w-0 flex-1 truncate text-small text-fg">
            <span className="font-medium">{s.verb}</span> <span className="font-mono text-micro text-fg-2">{s.target}</span>
          </span>
          {s.meta ? <span className="shrink-0 font-mono text-micro text-fg-3">{s.meta}</span> : null}
        </li>
      ))}
    </ul>
  );
}
