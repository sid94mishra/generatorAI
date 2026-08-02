// ────────────────────────────────────────────────────────────────
// BackgroundTasksPanel — right-pane view of an orchestrator chat's
// spawned background worker tasks. Lists tasks with live status, shows
// each worker's digest, and links to the full worker chat (real stream).
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, Clock, Eye, ExternalLink, Ban } from 'lucide-react';
import { useBackgroundTasks, useBackgroundTaskDigest } from '@/hooks/queries.js';
import { usePlatform } from '@/providers/PlatformProvider.js';
import type { HttpPlatformClient } from '@/platform/HttpPlatformClient.js';
import { cn } from '@/lib/utils.js';

interface BackgroundTasksPanelProps {
  chatId: string | undefined;
}

const STATUS_META: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  running: { label: 'Running', icon: <Loader2 className="h-3 w-3 animate-spin" />, cls: 'text-blue-500 bg-blue-500/10' },
  needs_review: { label: 'Needs review', icon: <Eye className="h-3 w-3" />, cls: 'text-amber-500 bg-amber-500/10' },
  completed: { label: 'Completed', icon: <CheckCircle2 className="h-3 w-3" />, cls: 'text-green-500 bg-green-500/10' },
  failed: { label: 'Failed', icon: <XCircle className="h-3 w-3" />, cls: 'text-red-500 bg-red-500/10' },
  cancelled: { label: 'Cancelled', icon: <Ban className="h-3 w-3" />, cls: 'text-neutral-400 bg-neutral-500/10' },
  spawned: { label: 'Starting', icon: <Clock className="h-3 w-3" />, cls: 'text-neutral-400 bg-neutral-500/10' },
};

function StatusChip({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META['spawned']!;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', meta.cls)}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

function TaskDigest({ chatId, taskId }: { chatId: string; taskId: string }) {
  const { data, isLoading } = useBackgroundTaskDigest(chatId, taskId);
  if (isLoading) return <div className="px-3 py-2 text-[11px] text-[var(--color-muted-foreground)]">Loading digest…</div>;
  if (!data) return null;
  const d = data as {
    status?: string;
    summary?: string;
    keyFindings?: string[];
    artifacts?: Array<{ path: string; kind?: string }>;
    risks?: string[];
    openQuestions?: string[];
  };
  return (
    <div className="space-y-2 px-3 pb-3 pt-1 text-[11px] leading-relaxed">
      {d.summary && (
        <div>
          <div className="mb-0.5 font-semibold text-[var(--color-foreground)]">Summary</div>
          <div className="whitespace-pre-wrap text-[var(--color-muted-foreground)]">{d.summary}</div>
        </div>
      )}
      {d.keyFindings && d.keyFindings.length > 0 && (
        <div>
          <div className="mb-0.5 font-semibold text-[var(--color-foreground)]">Key findings</div>
          <ul className="list-disc pl-4 text-[var(--color-muted-foreground)]">
            {d.keyFindings.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}
      {d.artifacts && d.artifacts.length > 0 && (
        <div>
          <div className="mb-0.5 font-semibold text-[var(--color-foreground)]">Artifacts</div>
          <ul className="pl-1 font-mono text-[10px] text-[var(--color-muted-foreground)]">
            {d.artifacts.map((a, i) => <li key={i}>{a.path}{a.kind ? ` (${a.kind})` : ''}</li>)}
          </ul>
        </div>
      )}
      {d.risks && d.risks.length > 0 && (
        <div>
          <div className="mb-0.5 font-semibold text-amber-500">Risks</div>
          <ul className="list-disc pl-4 text-[var(--color-muted-foreground)]">
            {d.risks.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
      {d.openQuestions && d.openQuestions.length > 0 && (
        <div>
          <div className="mb-0.5 font-semibold text-[var(--color-foreground)]">Open questions</div>
          <ul className="list-disc pl-4 text-[var(--color-muted-foreground)]">
            {d.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function BackgroundTasksPanel({ chatId }: BackgroundTasksPanelProps) {
  const navigate = useNavigate();
  const platform = usePlatform() as HttpPlatformClient;
  const { data, isLoading } = useBackgroundTasks(chatId);
  const [expanded, setExpanded] = useState<string | null>(null);

  const tasks = data?.tasks ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div className="text-xs font-semibold text-[var(--color-foreground)]">Background Tasks</div>
        <div className="text-[10px] text-[var(--color-muted-foreground)]">{tasks.length} task{tasks.length === 1 ? '' : 's'}</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && tasks.length === 0 ? (
          <div className="p-4 text-[11px] text-[var(--color-muted-foreground)]">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="p-4 text-[11px] text-[var(--color-muted-foreground)]">
            No background tasks yet. When the orchestrator spawns background agents, they appear here.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {tasks.map((t) => {
              const isOpen = expanded === t.taskId;
              return (
                <li key={t.taskId}>
                  <div
                    className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-[var(--color-muted)]/40"
                    onClick={() => setExpanded(isOpen ? null : t.taskId)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-[var(--color-foreground)]">{t.taskName}</span>
                        <StatusChip status={t.status} />
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--color-muted-foreground)]">
                        {t.model && <span className="rounded bg-[var(--color-muted)]/60 px-1 py-0.5 font-mono">{t.model}</span>}
                        {t.reviewRounds > 0 && <span>· {t.reviewRounds} review{t.reviewRounds === 1 ? '' : 's'}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="Open worker chat"
                        className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                        onClick={(e) => { e.stopPropagation(); navigate(`/chats/${t.taskId}`); }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                      {(t.status === 'running' || t.status === 'spawned') && (
                        <button
                          type="button"
                          title="Cancel"
                          className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-red-500/10 hover:text-red-500"
                          onClick={(e) => { e.stopPropagation(); if (chatId) void platform.cancelBackgroundTask(chatId, t.taskId); }}
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {isOpen && chatId && <TaskDigest chatId={chatId} taskId={t.taskId} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
