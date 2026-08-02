// ────────────────────────────────────────────────────────────────
// RuntimeStageNode — Custom React Flow node for workflow run stages
// Shows live runtime status, progress bars, animated indicators
// ────────────────────────────────────────────────────────────────

import React, { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import {
  Pause,
  Check,
  X,
  AlertCircle,
  SkipForward,
  Clock,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { useWorkflowRunStore } from '@/stores/workflowRunStore.js';
import type { RuntimeStageNodeData } from './RuntimeDAGCanvas.js';
import type { StageRunStatus } from '@generatorai/shared';

/** Color + icon mapping for stage run statuses */
const statusStyles: Record<StageRunStatus, {
  bg: string;
  border: string;
  ringColor: string;
  icon: React.ReactNode;
  textColor: string;
}> = {
  pending: {
    bg: 'bg-gray-50 dark:bg-gray-800/80',
    border: 'border-gray-300 dark:border-gray-600',
    ringColor: 'ring-gray-300/30',
    icon: <Clock className="h-4 w-4 text-gray-400" />,
    textColor: 'text-gray-500',
  },
  queued: {
    bg: 'bg-blue-50/50 dark:bg-blue-900/20',
    border: 'border-blue-300 dark:border-blue-600',
    ringColor: 'ring-blue-300/30',
    icon: <Clock className="h-4 w-4 text-blue-500" />,
    textColor: 'text-blue-600',
  },
  running: {
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    border: 'border-blue-400 dark:border-blue-500',
    ringColor: 'ring-blue-400/30',
    icon: <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />,
    textColor: 'text-blue-700',
  },
  paused: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-400 dark:border-amber-500',
    ringColor: 'ring-amber-400/30',
    icon: <Pause className="h-4 w-4 text-amber-500" />,
    textColor: 'text-amber-700',
  },
  completed: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-400 dark:border-green-500',
    ringColor: 'ring-green-400/30',
    icon: <Check className="h-4 w-4 text-green-600" />,
    textColor: 'text-green-700',
  },
  failed: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-400 dark:border-red-500',
    ringColor: 'ring-red-400/30',
    icon: <AlertCircle className="h-4 w-4 text-red-500" />,
    textColor: 'text-red-700',
  },
  cancelled: {
    bg: 'bg-gray-100 dark:bg-gray-700/50',
    border: 'border-gray-400 dark:border-gray-500',
    ringColor: 'ring-gray-400/30',
    icon: <X className="h-4 w-4 text-gray-500" />,
    textColor: 'text-gray-600',
  },
  skipped: {
    bg: 'bg-gray-50 dark:bg-gray-800/60',
    border: 'border-gray-300 dark:border-gray-600',
    ringColor: 'ring-gray-200/30',
    icon: <SkipForward className="h-4 w-4 text-gray-400" />,
    textColor: 'text-gray-500',
  },
  sleeping: {
    bg: 'bg-indigo-50 dark:bg-indigo-900/20',
    border: 'border-indigo-300 dark:border-indigo-600',
    ringColor: 'ring-indigo-300/30',
    icon: <Clock className="h-4 w-4 text-indigo-400" />,
    textColor: 'text-indigo-500',
  },
  awaiting_input: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-400 dark:border-amber-500',
    ringColor: 'ring-amber-400/30',
    icon: <Pause className="h-4 w-4 text-amber-500" />,
    textColor: 'text-amber-700',
  },
};

function RuntimeStageNodeComponent({ id, data }: NodeProps<Node<RuntimeStageNodeData>>) {
  const { stageRun, label, isSelected } = data;
  const selectStageRun = useWorkflowRunStore((s) => s.selectStageRun);

  const status = stageRun.status;
  const style = statusStyles[status] ?? statusStyles.pending;
  const progressPercent = stageRun.totalSteps > 0
    ? Math.round((stageRun.currentStep / stageRun.totalSteps) * 100)
    : 0;

  const handleClick = useCallback(() => {
    selectStageRun(id);
  }, [id, selectStageRun]);

  return (
    <div
      onClick={handleClick}
      className={cn(
        'group relative min-w-[240px] max-w-[320px] cursor-pointer rounded-lg border-2 px-4 py-3 shadow-sm transition-all',
        style.bg,
        isSelected
          ? `${style.border} ring-2 ${style.ringColor} shadow-md`
          : `${style.border} hover:shadow-md`,
      )}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          '!h-3 !w-3 !border-2',
          status === 'running'
            ? '!border-blue-500 !bg-blue-100'
            : status === 'completed'
              ? '!border-green-500 !bg-green-100'
              : '!border-[var(--color-border)] !bg-[var(--color-background)]',
        )}
      />

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          '!h-3 !w-3 !border-2',
          status === 'running'
            ? '!border-blue-500 !bg-blue-100'
            : status === 'completed'
              ? '!border-green-500 !bg-green-100'
              : '!border-[var(--color-border)] !bg-[var(--color-background)]',
        )}
      />

      {/* Header */}
      <div className="flex items-center gap-2">
        {style.icon}
        <span className="truncate text-sm font-semibold text-[var(--color-foreground)]">
          {label}
        </span>
      </div>

      {/* Status text — only show step counter when it's actually informative (multi-step) */}
      <div className={cn('mt-1 text-xs font-medium capitalize', style.textColor)}>
        {status === 'awaiting_input' ? 'awaiting input' : status}
        {status === 'running' && stageRun.totalSteps > 1 && (
          <span className="ml-1 font-normal">
            (step {stageRun.currentStep}/{stageRun.totalSteps})
          </span>
        )}
      </div>

      {/* Progress bar (for running/paused stages with multiple steps) */}
      {(status === 'running' || status === 'paused') && stageRun.totalSteps > 1 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              status === 'running' ? 'bg-blue-500' : 'bg-amber-500',
            )}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* Error indicator */}
      {stageRun.error && (
        <div className="mt-1.5 truncate text-xs text-red-600 dark:text-red-400">
          {stageRun.error}
        </div>
      )}

      {/* Retry indicator */}
      {stageRun.retryCount > 0 && (
        <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          Retry #{stageRun.retryCount}
        </div>
      )}

      {/* Running animation ring */}
      {status === 'running' && (
        <div className="absolute -inset-0.5 rounded-lg border-2 border-blue-400/50 animate-pulse pointer-events-none" />
      )}
    </div>
  );
}

export const RuntimeStageNode = memo(RuntimeStageNodeComponent);
