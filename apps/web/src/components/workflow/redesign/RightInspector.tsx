// ────────────────────────────────────────────────────────────────
// RightInspector — tabbed side panel for the focused stage.
// Tabs: Files · Output · Hooks · Tools.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import {
  FileText, FileCode, Database, Webhook, Wrench, CheckCircle2, AlertTriangle,
  Plus, Pencil, Minus, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/index.js';
import { useRunFileContent } from '@/hooks/workflowQueries.js';
import { FileViewerModal } from '@/components/shared/FileViewerComponents.js';
import type { StageView, FileChange } from './types.js';

type Tab = 'files' | 'output' | 'hooks' | 'tools';

interface RightInspectorProps {
  stage: StageView | null;
  defaultTab?: Tab;
  /** Optional run id — enables click-to-open file modal in the Files tab. */
  runId?: string;
}

const KIND_ICON: Record<FileChange['kind'], { icon: React.ReactNode; label: string; classes: string }> = {
  added:    { icon: <Plus     className="h-2.5 w-2.5" />, label: 'A', classes: 'bg-[var(--color-success)]/12 text-[var(--color-success)]' },
  modified: { icon: <Pencil   className="h-2.5 w-2.5" />, label: 'M', classes: 'bg-[var(--color-warning)]/12 text-[var(--color-warning)]' },
  deleted:  { icon: <Minus    className="h-2.5 w-2.5" />, label: 'D', classes: 'bg-[var(--color-danger)]/12 text-[var(--color-danger)]' },
  renamed:  { icon: <ArrowRight className="h-2.5 w-2.5" />, label: 'R', classes: 'bg-[var(--color-info)]/12 text-[var(--color-info)]' },
};

export function RightInspector({ stage, defaultTab = 'files', runId }: RightInspectorProps) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [openFile, setOpenFile] = useState<FileChange | null>(null);

  // If summary duplicates the scratchpad text, only count it once.
  const summaryDupOfText = !!stage?.outputText && !!stage?.summary && stage.summary.trim() === stage.outputText.trim();
  const outputCount = (stage?.outputData ? 1 : 0) + (stage?.outputText ? 1 : 0) + (stage?.summary && !summaryDupOfText ? 1 : 0);
  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'files',  label: 'Files',  icon: <FileText className="h-3.5 w-3.5" />, count: stage?.files?.length },
    { id: 'output', label: 'Output', icon: <Database className="h-3.5 w-3.5" />, count: outputCount },
    { id: 'hooks',  label: 'Hooks',  icon: <Webhook className="h-3.5 w-3.5" />, count: stage?.hooks?.length },
    { id: 'tools',  label: 'Tools',  icon: <Wrench   className="h-3.5 w-3.5" />, count: stage?.steps.filter((s) => s.kind === 'tool' || s.kind === 'run' || s.kind === 'search' || s.kind === 'read' || s.kind === 'edit').length },
  ];

  return (
    <aside className="flex h-full flex-col border-l border-[var(--color-border)] bg-[var(--color-card)]/40" aria-label="Stage inspector">
      {/* Focused stage strip */}
      <div className="border-b border-[var(--color-border)] px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted-foreground)]">
          Inspector
        </p>
        <p className="mt-0.5 truncate text-[12.5px] font-medium text-[var(--color-foreground)]">
          {stage ? stage.name : 'Select a stage'}
        </p>
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex shrink-0 items-center gap-0.5 border-b border-[var(--color-border)] px-2 pt-1.5">
        {tabs.map((t) => (
          <Button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            variant="ghost"
            size="sm"
            className={cn(
              'h-auto flex items-center gap-1.5 rounded-t-md border-b-2 bg-transparent px-2.5 py-1.5 text-[11.5px] font-medium transition-colors hover:bg-transparent',
              tab === t.id
                ? 'border-[var(--color-primary)] text-[var(--color-foreground)]'
                : 'border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
            )}
          >
            {t.icon}
            {t.label}
            {typeof t.count === 'number' && t.count > 0 && (
              <span className="rounded-full bg-[var(--color-muted-foreground)]/15 px-1.5 text-[10px] tabular-nums">
                {t.count}
              </span>
            )}
          </Button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {!stage && (
          <p className="text-[12px] text-[var(--color-muted-foreground)]">
            Focus a stage in the pipeline to see its files, structured output, hook invocations, and tool trace.
          </p>
        )}

        {stage && tab === 'files' && (
          <FilesTab files={stage.files ?? []} onOpen={runId ? setOpenFile : undefined} />
        )}
        {stage && tab === 'output' && (
          <OutputTab data={stage.outputData} summary={stage.summary} text={stage.outputText} />
        )}
        {stage && tab === 'hooks' && (
          <HooksTab hooks={stage.hooks ?? []} />
        )}
        {stage && tab === 'tools' && (
          <ToolsTab stage={stage} />
        )}
      </div>

      {runId && openFile && (
        <FileViewerModalConnected
          runId={runId}
          file={openFile}
          onClose={() => setOpenFile(null)}
        />
      )}
    </aside>
  );
}

/** Connects the shared FileViewerModal to `useRunFileContent`. */
function FileViewerModalConnected({
  runId,
  file,
  onClose,
}: {
  runId: string;
  file: FileChange;
  onClose: () => void;
}) {
  // Files in a run can live in the workspace OR the artifacts dir (stage
  // response .md files); pick the right endpoint based on what
  // `workspaceFilesFromRun` / manifest attached. Default to workspace for
  // legacy manifest entries that don't carry a source.
  const source = file.source ?? 'workspace';
  const { data, isLoading, error } = useRunFileContent(runId, file.path, source);
  return (
    <FileViewerModal
      filePath={file.path}
      source={source}
      onClose={onClose}
      fileContent={data}
      isLoading={isLoading}
      error={error}
    />
  );
}

function FilesTab({ files, onOpen }: { files: FileChange[]; onOpen?: (f: FileChange) => void }) {
  if (files.length === 0) {
    return <p className="text-[11.5px] text-[var(--color-muted-foreground)]">No file changes.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {files.map((f, i) => {
        const meta = KIND_ICON[f.kind];
        const clickable = !!onOpen;
        return (
          <li key={i}>
            <Button
              type="button"
              onClick={clickable ? () => onOpen(f) : undefined}
              disabled={!clickable}
              variant="ghost"
              size="sm"
              className={cn(
                'h-auto group flex w-full items-center gap-2 rounded bg-transparent px-1.5 py-1 text-left',
                clickable
                  ? 'cursor-pointer hover:bg-[var(--color-subtle)]/60'
                  : 'cursor-default hover:bg-transparent',
              )}
              title={clickable ? `Open ${f.path}` : f.path}
            >
              <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold', meta.classes)}>
                {meta.label}
              </span>
              <FileCode className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]/70" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[var(--color-foreground)]/85">
                {f.path}
              </span>
              {f.size && (
                <span className="text-[10.5px] text-[var(--color-muted-foreground)]/70">{f.size}</span>
              )}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function OutputTab({ data, summary, text }: { data?: Record<string, unknown>; summary?: string; text?: string }) {
  if (!data && !summary && !text) {
    return <p className="text-[11.5px] text-[var(--color-muted-foreground)]">No structured output or summary.</p>;
  }
  // When the workflow uses the harness summary path, the on-disk scratchpad
  // entry and the DB `summary` field are the same string. Don't render the
  // same wall of text twice — prefer the scratchpad text, hide the summary.
  const summaryMatchesText = !!text && !!summary && summary.trim() === text.trim();
  const showSummary = !!summary && !summaryMatchesText;
  return (
    <div className="space-y-3">
      {text && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-primary)]">
            <FileText className="h-3 w-3" />
            output
          </div>
          <p className="whitespace-pre-wrap rounded-md border border-[var(--color-border)]/60 bg-[var(--color-background)] p-2 text-[11.5px] leading-relaxed text-[var(--color-foreground)]/90">
            {text}
          </p>
        </div>
      )}
      {data && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
            <Database className="h-3 w-3" />
            outputData
          </div>
          <pre className="overflow-x-auto rounded-md border border-cyan-500/20 bg-[var(--color-background)] p-2 font-mono text-[10.5px] leading-relaxed text-[var(--color-foreground)]/85">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
      {showSummary && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            <FileText className="h-3 w-3" />
            summary
          </div>
          <p className="whitespace-pre-wrap rounded-md border border-[var(--color-border)]/60 bg-[var(--color-subtle)]/40 p-2 text-[11.5px] leading-relaxed text-[var(--color-foreground)]/80">
            {summary}
          </p>
        </div>
      )}
    </div>
  );
}

function HooksTab({ hooks }: { hooks: StageView['hooks'] extends undefined ? never : NonNullable<StageView['hooks']> }) {
  if (hooks.length === 0) {
    return <p className="text-[11.5px] text-[var(--color-muted-foreground)]">No hooks fired for this stage.</p>;
  }
  return (
    <ul className="space-y-1">
      {hooks.map((h) => (
        <li key={h.id} className="rounded-md border border-[var(--color-border)]/60 bg-[var(--color-subtle)]/40 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            {h.status === 'ok' ? (
              <CheckCircle2 className="h-3 w-3 text-[var(--color-success)]" />
            ) : h.status === 'failed' ? (
              <AlertTriangle className="h-3 w-3 text-[var(--color-danger)]" />
            ) : (
              // Matches the running dot in ToolsTab below — same status vocabulary.
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)] animate-status-breathe" />
            )}
            <span className="text-[11.5px] font-medium text-[var(--color-foreground)]/85">{h.name}</span>
            <span className="ml-auto text-[10px] text-[var(--color-muted-foreground)]/70">
              {h.status === 'running' ? 'running…' : `${h.durationMs}ms`}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--color-muted-foreground)]/80">
            <span className="rounded bg-[var(--color-muted-foreground)]/10 px-1.5 py-px font-mono">{h.type}</span>
            <span className="rounded bg-[var(--color-muted-foreground)]/10 px-1.5 py-px font-mono">{h.phase}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ToolsTab({ stage }: { stage: StageView }) {
  const toolSteps = stage.steps.filter((s) => s.kind !== 'think' && s.kind !== 'note');
  if (toolSteps.length === 0) {
    return <p className="text-[11.5px] text-[var(--color-muted-foreground)]">No tool activity yet.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {toolSteps.map((s) => (
        <li key={s.id} className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[var(--color-subtle)]/60">
          <span className={cn(
            'h-1.5 w-1.5 rounded-full',
            s.status === 'done' && 'bg-[var(--color-success)]',
            s.status === 'running' && 'bg-[var(--color-primary)] animate-status-breathe',
            s.status === 'failed' && 'bg-[var(--color-danger)]',
            s.status === 'pending' && 'bg-[var(--color-muted-foreground)]/40',
          )} />
          <Wrench className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]/70" />
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--color-foreground)]/85">
            <span className="font-medium">{s.verb}</span> <span className="font-mono text-[10.5px] text-[var(--color-foreground)]/70">{s.target}</span>
          </span>
          {s.meta && <span className="text-[10.5px] text-[var(--color-muted-foreground)]/70">{s.meta}</span>}
        </li>
      ))}
    </ul>
  );
}
