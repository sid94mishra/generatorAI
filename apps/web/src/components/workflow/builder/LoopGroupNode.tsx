// ────────────────────────────────────────────────────────────────
// LoopGroupNode — a container stage (loop §2.1, map §4.1) on the builder
// canvas (P05).
//
// A React Flow group node: its body stages are child nodes drawn inside
// it, and it is auto-sized around them (containerLayout). The header
// shows the container's name and its settings (a loop's iteration cap and
// exit rules; a map's list, concurrency and workspace); outer stages
// connect to its handles, body stages only to each other.
// ────────────────────────────────────────────────────────────────

import React, { memo, useCallback } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { AlertCircle, Plus, Trash2, Ungroup } from 'lucide-react';
import type { StageKind } from '@generatorai/workflow-spec';
import { cn } from '@/lib/utils.js';
import { Tooltip } from '@/components/Tooltip.js';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/index.js';
import { useWorkflowBuilderStore, type StageNodeData } from '@/stores/workflowBuilderStore.js';
import { useCanvasReadonly } from '../canvasContext.js';
import { GROUP_HEADER } from './containerLayout.js';
import { ADDABLE_KINDS, KIND_META } from './kindMeta.js';

/** Short label of an exit action, as the quick rows name them. */
const ACTION_LABELS: Record<string, string> = {
  complete: 'until',
  fail: 'fail when',
  pause: 'pause when',
  exhaust: 'stall',
};

const handleClass = cn(
  '!h-3.5 !w-3.5 !rounded-full !border-2',
  '!border-[var(--color-primary)] !bg-[var(--color-background)]',
  'transition-all duration-200',
  'hover:!shadow-[0_0_8px_var(--color-primary)] hover:!bg-[var(--color-primary)]/20',
);

function LoopGroupNodeComponent({ id, data, selected }: NodeProps<Node<StageNodeData>>) {
  const { stage, label } = data;
  const readonly = useCanvasReadonly();
  const selectNode = useWorkflowBuilderStore((s) => s.selectNode);
  const addStage = useWorkflowBuilderStore((s) => s.addStage);
  const unwrapContainer = useWorkflowBuilderStore((s) => s.unwrapContainer);
  const removeStage = useWorkflowBuilderStore((s) => s.removeStage);
  const issueMessages = useWorkflowBuilderStore(
    useShallow((s) => s.issues.filter((i) => i.stageKey === id && i.severity === 'error').map((i) => i.message)),
  );
  const bodyCount = useWorkflowBuilderStore((s) => s.nodes.filter((n) => n.parentId === id).length);

  const loop = stage.kind === 'loop' ? stage.loop : undefined;
  const map = stage.kind === 'map' ? stage.map : undefined;
  const exits = loop?.exits ?? [];
  const noun = map ? 'map' : 'loop';
  const KindIcon = KIND_META[map ? 'map' : 'loop'].icon;

  const addInside = useCallback(
    (kind: StageKind) => {
      const key = addStage(undefined, { kind, parentKey: id });
      selectNode(key);
    },
    [addStage, selectNode, id],
  );

  return (
    <div
      onClick={() => selectNode(id)}
      role="group"
      aria-label={`${map ? 'Map' : 'Loop'}: ${label}`}
      className={cn(
        'group relative h-full w-full rounded-xl border-2 border-dashed',
        'bg-[var(--color-primary)]/[0.03] transition-colors duration-200',
        selected
          ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20'
          : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/60',
        issueMessages.length > 0 && !selected && 'border-danger',
      )}
    >
      {/* Outer edges attach to the container itself; handles sit at header height. */}
      <Handle type="target" position={Position.Left} className={handleClass} style={{ top: GROUP_HEADER / 2 }} />
      <Handle type="source" position={Position.Right} className={handleClass} style={{ top: GROUP_HEADER / 2 }} />

      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-3.5 pt-2.5" style={{ minHeight: GROUP_HEADER - 12 }}>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)]/10">
              <KindIcon className="h-3.5 w-3.5 text-[var(--color-primary)]" />
            </div>
            <span className="truncate text-sm font-semibold leading-tight text-[var(--color-card-foreground)]">{label}</span>
            <span className="shrink-0 rounded-md bg-[var(--color-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted-foreground)]">
              {map ? `×${map.concurrency} · ≤${map.maxItems}` : `max ${loop?.maxIterations ?? '?'}`}
            </span>
            {issueMessages.length > 0 && (
              <Tooltip content={issueMessages.join(' · ')} side="top">
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-danger-muted px-1 py-0.5 text-[10px] font-semibold text-danger"
                  aria-label={`${issueMessages.length} validation ${issueMessages.length === 1 ? 'issue' : 'issues'}`}
                >
                  <AlertCircle className="h-3 w-3" />
                  {issueMessages.length}
                </span>
              </Tooltip>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[var(--color-muted-foreground)]">
            {map ? (
              <>
                <Tooltip content={`For each item of: ${map.items}`} side="top">
                  <span className="max-w-[220px] cursor-help truncate rounded bg-[var(--color-subtle)] px-1 py-px font-mono">for each in {map.items}</span>
                </Tooltip>
                {map.workspace === 'mount_per_item' && (
                  <span className="rounded bg-[var(--color-subtle)] px-1 py-px">
                    mount per item{map.merge !== 'none' ? ` · ${map.merge === 'pr_per_item' ? 'PR per item' : 'merge'}` : ''}
                  </span>
                )}
                {map.toleratedFailurePercent > 0 && <span>tolerates {map.toleratedFailurePercent}% failed</span>}
              </>
            ) : exits.length === 0 ? (
              <span>no exit rule · runs {loop?.maxIterations ?? '?'} times</span>
            ) : (
              exits.slice(0, 3).map((rule, i) => (
                <Tooltip key={i} content={`${rule.when}${rule.consecutive > 1 ? ` (${rule.consecutive}× in a row)` : ''}`} side="top">
                  <span className="cursor-help rounded bg-[var(--color-subtle)] px-1 py-px font-mono">
                    {ACTION_LABELS[rule.action] ?? rule.action}: {rule.reason}
                  </span>
                </Tooltip>
              ))
            )}
            {exits.length > 3 && <span>+{exits.length - 3}</span>}
            {bodyCount === 0 && <span className="text-danger">empty body</span>}
          </div>
        </div>

        {!readonly && (
          <div
            className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Add a stage to the ${noun} body`}
                  title={`Add a stage to the ${noun} body`}
                  className="nodrag h-auto w-auto rounded-lg p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {ADDABLE_KINDS.map((kind) => {
                  const { icon: Icon, label: kindLabel } = KIND_META[kind];
                  return (
                    <DropdownMenuItem key={kind} onSelect={() => addInside(kind)}>
                      <Icon className="h-3.5 w-3.5" /> {kind === 'loop' || kind === 'map' ? `Nested ${kind}` : kindLabel}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip content={`Unwrap: remove the ${noun}, keep its stages`} side="top">
              <Button
                onClick={() => unwrapContainer(id)}
                variant="ghost"
                size="icon-sm"
                aria-label={`Unwrap ${noun}`}
                className="nodrag h-auto w-auto rounded-lg p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
              >
                <Ungroup className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content={`Delete the ${noun} and its stages`} side="top">
              <Button
                onClick={() => removeStage(id)}
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${noun}`}
                className="nodrag h-auto w-auto rounded-lg p-1.5 text-[var(--color-muted-foreground)] hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}

export const LoopGroupNode = memo(LoopGroupNodeComponent);
