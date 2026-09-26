// ────────────────────────────────────────────────────────────────
// StageNode — Custom React Flow node for workflow stages
// Shows stage name, template type, status indicator, handles
// ────────────────────────────────────────────────────────────────

import React, { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import { Box, Play, Pause, Check, X, AlertTriangle, AlertCircle, SkipForward, Clock, Copy, Trash2, Cpu, Sparkles, Server, ShieldCheck, Bot, Filter, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Tooltip } from '@/components/Tooltip.js';
import { Button } from '@/components/ui/index.js';
import type { StageNodeData } from '@/stores/workflowBuilderStore.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useShallow } from 'zustand/react/shallow';
import { useCanvasReadonly } from './canvasContext.js';

/** Color mapping for stage run statuses (used in runtime mode) */
const statusColors: Record<string, { bg: string; border: string; icon: React.ReactNode }> = {
  pending: {
    bg: 'bg-gray-50 dark:bg-gray-800',
    border: 'border-gray-300 dark:border-gray-600',
    icon: <Clock className="h-3.5 w-3.5 text-gray-400" />,
  },
  queued: {
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    border: 'border-blue-300 dark:border-blue-600',
    icon: <Clock className="h-3.5 w-3.5 text-blue-500" />,
  },
  running: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    border: 'border-yellow-400 dark:border-yellow-500',
    icon: <Play className="h-3.5 w-3.5 text-yellow-600 animate-pulse" />,
  },
  paused: {
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    border: 'border-orange-300 dark:border-orange-500',
    icon: <Pause className="h-3.5 w-3.5 text-orange-500" />,
  },
  completed: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-400 dark:border-green-500',
    icon: <Check className="h-3.5 w-3.5 text-green-600" />,
  },
  failed: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-400 dark:border-red-500',
    icon: <X className="h-3.5 w-3.5 text-red-600" />,
  },
  cancelled: {
    bg: 'bg-gray-100 dark:bg-gray-700',
    border: 'border-gray-400 dark:border-gray-500',
    icon: <X className="h-3.5 w-3.5 text-gray-500" />,
  },
  skipped: {
    bg: 'bg-gray-50 dark:bg-gray-800',
    border: 'border-gray-300 dark:border-gray-600',
    icon: <SkipForward className="h-3.5 w-3.5 text-gray-400" />,
  },
};

function StageNodeComponent({ id, data, selected }: NodeProps<Node<StageNodeData>>) {
  const { stage, label } = data;
  const readonly = useCanvasReadonly();
  const selectNode = useWorkflowBuilderStore((s) => s.selectNode);
  const removeStage = useWorkflowBuilderStore((s) => s.removeStage);
  const duplicateStage = useWorkflowBuilderStore((s) => s.duplicateStage);
  // Error-severity validator issues located on this stage (D-25).
  const issueMessages = useWorkflowBuilderStore(
    useShallow((s) => s.issues.filter((i) => i.stageKey === id && i.severity === 'error').map((i) => i.message)),
  );

  // Determine status styling (runtime status if available, else design-time default)
  const runtimeStatus = (stage as StageNodeData['stage'] & { runtimeStatus?: string }).runtimeStatus;
  const statusStyle = runtimeStatus
    ? statusColors[runtimeStatus] ?? statusColors.pending
    : null;

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      removeStage(id);
    },
    [id, removeStage],
  );

  const handleDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      duplicateStage(id);
    },
    [id, duplicateStage],
  );

  const handleClick = useCallback(() => {
    selectNode(id);
  }, [id, selectNode]);

  // Agent-only fields; a check stage shows its command instead (P05).
  const agent = stage.kind === 'agent' ? stage : undefined;
  const retry = stage.kind === 'loop' ? undefined : stage.retry;
  const promptCount = agent?.prompts.length ?? 0;

  // Capability summary, read from the fields the panel writes (D-30).
  const model = agent?.session?.model;
  const reasoningEffort = agent?.session?.reasoningEffort;
  const skillCount = agent?.session?.agentOverrides?.addSkillIds?.length ?? 0;
  const excludedMcpCount = agent?.session?.mcp?.excludedIds?.length ?? 0;
  const validationCount = agent?.output.rules.length ?? 0;
  const agentRef = agent?.session?.agentRef;
  const isStructured = agent?.output.format === 'json';

  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      role="button"
      tabIndex={0}
      aria-label={`Stage: ${label}`}
      className={cn(
        // Entrance animation: nodes pop in with scale + opacity
        'animate-in fade-in zoom-in-95 duration-200',
        'group relative min-w-[240px] max-w-[320px]',
        'rounded-lg border-2 px-4 py-3.5',
        'shadow-sm transition-all duration-200 ease-out',
        'bg-[var(--color-card)] text-[var(--color-card-foreground)]',
        ' ',
        selected
          ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/25 shadow-sm shadow-[var(--color-primary)]/10'
          : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/60 hover:shadow-sm hover:shadow-black/5',
        statusStyle?.bg,
        statusStyle?.border,
        issueMessages.length > 0 && !statusStyle && 'border-danger',
      )}
    >
      {/* Input Handle (left) — glows on hover */}
      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          '!h-3.5 !w-3.5 !rounded-full !border-2',
          '!border-[var(--color-primary)] !bg-[var(--color-background)]',
          'transition-all duration-200',
          'hover:!shadow-[0_0_8px_var(--color-primary)] hover:!bg-[var(--color-primary)]/20',
          'group-hover:!shadow-[0_0_6px_var(--color-primary)]/40',
        )}
      />

      {/* Output Handle (right) — glows on hover */}
      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          '!h-3.5 !w-3.5 !rounded-full !border-2',
          '!border-[var(--color-primary)] !bg-[var(--color-background)]',
          'transition-all duration-200',
          'hover:!shadow-[0_0_8px_var(--color-primary)] hover:!bg-[var(--color-primary)]/20',
          'group-hover:!shadow-[0_0_6px_var(--color-primary)]/40',
        )}
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
            statusStyle ? '' : 'bg-[var(--color-primary)]/10',
          )}>
            {statusStyle ? (
              statusStyle.icon
            ) : (
              <Box className="h-4 w-4 text-[var(--color-primary)]" />
            )}
          </div>
          <span className="truncate text-sm font-semibold leading-tight">{label}</span>
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

        {/* Action buttons (visible on hover) */}
        {!readonly && <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <Tooltip content="Duplicate stage" side="top">
            <Button
              onClick={handleDuplicate}
              variant="ghost"
              size="icon-sm"
              aria-label="Duplicate stage"
              className="h-auto w-auto rounded-lg p-1.5 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Delete stage" side="top">
            <Button
              onClick={handleDelete}
              variant="ghost"
              size="icon-sm"
              aria-label="Delete stage"
              className="h-auto w-auto rounded-lg p-1.5 text-[var(--color-muted-foreground)] transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>}
      </div>

      {/* Capability pills */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-muted-foreground)]">
        {model && (
          <Tooltip content={`Model override: ${model}${reasoningEffort ? ` · ${reasoningEffort} effort` : ''}`} side="top">
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-info-muted)] px-1.5 py-0.5 text-[var(--color-primary)] font-medium font-mono max-w-[120px] truncate cursor-help">
              <Cpu className="h-3 w-3 shrink-0" />
              <span className="truncate">{model}</span>
            </span>
          </Tooltip>
        )}
        <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-subtle)] px-1.5 py-0.5">
          {promptCount} prompt{promptCount !== 1 ? 's' : ''}
        </span>
        {agentRef && (
          <Tooltip content={`Driven by agent: ${agentRef}`} side="top">
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-subtle)] px-1.5 py-0.5 cursor-help">
              <Bot className="h-3 w-3" />{agentRef}
            </span>
          </Tooltip>
        )}
        {skillCount > 0 && (
          <Tooltip content={`${skillCount} skill${skillCount !== 1 ? 's' : ''} enabled`} side="top">
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-subtle)] px-1.5 py-0.5 cursor-help">
              <Sparkles className="h-3 w-3" />{skillCount}
            </span>
          </Tooltip>
        )}
        {excludedMcpCount > 0 && (
          <Tooltip content={`${excludedMcpCount} MCP server${excludedMcpCount !== 1 ? 's' : ''} excluded`} side="top">
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-subtle)] px-1.5 py-0.5 cursor-help">
              <Server className="h-3 w-3" />−{excludedMcpCount}
            </span>
          </Tooltip>
        )}
        {stage.guard && (
          <Tooltip content={`Guard: ${stage.guard}`} side="top">
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-subtle)] px-1.5 py-0.5 cursor-help">
              <Filter className="h-3 w-3" />if
            </span>
          </Tooltip>
        )}
        {agent?.approval && (
          <Tooltip content="Waits for approval before successors start" side="top">
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-subtle)] px-1.5 py-0.5 cursor-help">
              <UserCheck className="h-3 w-3" />
            </span>
          </Tooltip>
        )}
        {validationCount > 0 && (
          <Tooltip content={`${validationCount} result-validation rule${validationCount !== 1 ? 's' : ''}`} side="top">
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-subtle)] px-1.5 py-0.5 cursor-help">
              <ShieldCheck className="h-3 w-3" />{validationCount}
            </span>
          </Tooltip>
        )}
        {isStructured && (
          <Tooltip content="Produces structured JSON output" side="top">
            <span className="inline-flex items-center gap-1 rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-cyan-600 dark:text-cyan-400 cursor-help font-mono">
              JSON
            </span>
          </Tooltip>
        )}
        {retry && (
          <Tooltip content={`Retry policy: up to ${retry.maxAttempts} attempts`} side="top">
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 cursor-help">
              <AlertTriangle className="h-3 w-3" />
              ×{retry.maxAttempts}
            </span>
          </Tooltip>
        )}
      </div>

      {/* Description (truncated) */}
      {stage.description && (
        <p className="mt-2 truncate text-xs text-[var(--color-muted-foreground)] leading-relaxed">
          {stage.description}
        </p>
      )}
    </div>
  );
}

export const StageNode = memo(StageNodeComponent);
