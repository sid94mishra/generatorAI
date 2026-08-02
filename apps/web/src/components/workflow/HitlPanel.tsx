// ────────────────────────────────────────────────────────────────
// HitlPanel — HITL-05 interrupt approval + permission-mode selector.
//
// The panel is always present on the WorkflowRunPage but visually quiet by
// default. The product ships with `permissionMode = 'bypassPermissions'`
// (auto-approve), so the happy path is: mode selector sits at
// "Auto-approve", pending queue is empty, nothing prompts the user.
//
// When the operator flips the mode (plan / default / acceptEdits), stage
// bodies that request `hitl.interrupt(...)` surface here with
// approve / reject / reason controls. The component polls the pending
// queue on a short cadence so users don't need to wait for SSE routing —
// live SSE is still the source of truth for state transitions, but the
// polled queue guarantees a stage in `awaiting_input` shows up within a
// second of the transition even if an event is dropped.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import type { StageRun, WorkflowRunPermissionMode } from '@generatorai/shared';
import type { HttpPlatformClient } from '@/platform/HttpPlatformClient.js';
import { Select } from '@/components/ui/index.js';

interface HitlPanelProps {
  runId: string;
  platform: HttpPlatformClient;
}

const MODE_LABELS: Record<WorkflowRunPermissionMode, string> = {
  bypassPermissions: 'Auto-approve (default)',
  default: 'Ask for unmatched requests',
  acceptEdits: 'Auto-approve file edits only',
  plan: 'Plan mode (approve every tool call)',
};

const MODE_DESCRIPTIONS: Record<WorkflowRunPermissionMode, string> = {
  bypassPermissions:
    'All tool calls auto-approve. Stages never pause for input unless a stage explicitly calls interrupt().',
  default:
    'Rule-based: matching rules allow/deny; unmatched requests surface here for manual approval.',
  acceptEdits:
    'File reads and writes auto-approve; shell commands and network calls require approval.',
  plan:
    'Every tool call pauses here before execution. Review the plan, approve individually, or deny to abort.',
};

export function HitlPanel({ runId, platform }: HitlPanelProps) {
  const [mode, setMode] = useState<WorkflowRunPermissionMode>('bypassPermissions');
  const [modeLoaded, setModeLoaded] = useState(false);
  const [pending, setPending] = useState<StageRun[]>([]);
  const [busyStageId, setBusyStageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── initial mode fetch ──
  useEffect(() => {
    let cancelled = false;
    platform
      .getPermissionMode(runId)
      .then((res) => {
        if (!cancelled) {
          setMode(res.mode);
          setModeLoaded(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setModeLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runId, platform]);

  // ── pending-interrupts polling ──
  // 2s while mode != bypassPermissions (approvals are possible); 15s
  // otherwise so the inert case costs almost nothing. Live SSE events
  // will move the needle faster when they arrive — this is the safety net.
  useEffect(() => {
    let cancelled = false;
    const intervalMs = mode === 'bypassPermissions' ? 15_000 : 2_000;

    const poll = async () => {
      try {
        const list = await platform.listPendingInterrupts(runId);
        if (!cancelled) setPending(list);
      } catch {
        // ignore transient; state stays as last-known
      }
    };
    void poll();
    const handle = setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [runId, platform, mode]);

  const handleModeChange = useCallback(
    async (next: WorkflowRunPermissionMode) => {
      const previous = mode;
      setMode(next); // optimistic
      setError(null);
      try {
        await platform.setPermissionMode(runId, next);
      } catch (err) {
        setMode(previous); // rollback
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [runId, platform, mode],
  );

  const handleResume = useCallback(
    async (stage: StageRun, approved: boolean) => {
      setBusyStageId(stage.id);
      setError(null);
      try {
        const result = await platform.resumeStage(runId, stage.id, {
          approved,
          reason: approved ? 'approved via UI' : 'denied via UI',
        });
        if (!result.ok) {
          // Another approver (or cancellation) won the race — surface it
          // so the operator knows why nothing happened, and let the poller
          // refresh the list rather than optimistically dropping the row.
          setError(result.reason ?? 'Stage was no longer awaiting input');
        } else {
          // Optimistic removal; the poller will re-confirm.
          setPending((prev) => prev.filter((s) => s.id !== stage.id));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyStageId(null);
      }
    },
    [runId, platform],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">Human-in-the-Loop</div>
          <div className="text-xs text-muted-foreground">
            Permission mode controls when this run pauses for approval.
          </div>
        </div>
        <Select
          className="w-60 shrink-0"
          value={mode}
          disabled={!modeLoaded}
          onChange={(v) => handleModeChange(v as WorkflowRunPermissionMode)}
          aria-label="Permission mode"
          options={(Object.keys(MODE_LABELS) as WorkflowRunPermissionMode[]).map((m) => ({
            value: m,
            label: MODE_LABELS[m],
            description: MODE_DESCRIPTIONS[m],
          }))}
        />
      </div>

      <div className="text-xs text-muted-foreground italic">{MODE_DESCRIPTIONS[mode]}</div>

      {error && (
        <div className="text-xs text-danger bg-danger-muted border border-danger/20 rounded-md px-2.5 py-1.5">
          {error}
        </div>
      )}

      {pending.length === 0 ? (
        <div className="text-xs text-muted-foreground border-t border-border pt-2.5">
          No stages awaiting input.
          {mode === 'bypassPermissions' && (
            <span className="ml-1">
              (Auto-approve is on — change mode above to require approvals.)
            </span>
          )}
        </div>
      ) : (
        <div className="border-t border-border pt-2.5 space-y-2">
          <div className="text-xs font-semibold text-warning">
            {pending.length} stage{pending.length > 1 ? 's' : ''} awaiting input
          </div>
          {pending.map((stage) => (
            <div
              key={stage.id}
              className="border border-border rounded-md p-2.5 bg-warning/5 flex flex-col gap-2"
            >
              <div className="text-xs font-medium text-foreground">{stage.name}</div>
              {stage.interruptData !== undefined && (
                <pre className="text-[11px] bg-subtle border border-border text-foreground rounded p-1.5 overflow-x-auto max-h-32">
                  {JSON.stringify(stage.interruptData, null, 2)}
                </pre>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-2.5 py-1 text-xs rounded-md bg-success text-white hover:opacity-90 disabled:opacity-50 transition-colors"
                  disabled={busyStageId === stage.id}
                  onClick={() => handleResume(stage, true)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="px-2.5 py-1 text-xs rounded-md border border-border bg-card text-foreground hover:bg-danger-muted hover:border-danger/40 hover:text-danger disabled:opacity-50 transition-colors"
                  disabled={busyStageId === stage.id}
                  onClick={() => handleResume(stage, false)}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
