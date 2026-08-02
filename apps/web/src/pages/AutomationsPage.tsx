// ────────────────────────────────────────────────────────────────
// AutomationsPage — List and manage automations
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAutomations,
  useDeleteAutomation,
  useEnableAutomation,
  useDisableAutomation,
  useTriggerAutomation,
} from '@/hooks/automationQueries.js';
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Clock,
  Webhook,
  Hand,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Zap,
  Repeat,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { EmptyState, ConfirmDialog, Button, Spinner, Badge, PageHeader } from '@/components/ui/index.js';
import { EntityListRow } from '@/components/data/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import type { Automation } from '@generatorai/shared';

const triggerIcons: Record<string, React.ReactNode> = {
  manual: <Hand className="h-3.5 w-3.5" />,
  schedule: <Clock className="h-3.5 w-3.5" />,
  webhook: <Webhook className="h-3.5 w-3.5" />,
};

const triggerLabels: Record<string, string> = {
  manual: 'Manual',
  schedule: 'Schedule',
  webhook: 'Webhook',
};

function formatDate(date: Date | string | undefined): string {
  if (!date) return 'Never';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AutomationsPage() {
  const navigate = useNavigate();
  const { data: automations, isLoading } = useAutomations();
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  const deleteMutation = useDeleteAutomation();
  const enableMutation = useEnableAutomation();
  const disableMutation = useDisableAutomation();
  const triggerMutation = useTriggerAutomation();

  const handleToggle = (automation: Automation) => {
    if (automation.enabled) {
      disableMutation.mutate(automation.id);
    } else {
      enableMutation.mutate(automation.id);
    }
  };

  const handleTrigger = (id: string) => {
    triggerMutation.mutate({ id });
  };

  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  return (
    <PageContainer>
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
        title="Delete automation"
        description="Are you sure you want to delete this automation? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDeleteId) {
            deleteMutation.mutate(pendingDeleteId, { onSettled: () => setPendingDeleteId(null) });
          }
        }}
      />
      {/* Header */}
      <PageHeader
        className="mb-8"
        title="Automations"
        subtitle="Schedule, trigger, and loop workflows automatically"
        actions={
          <Button
            variant="primary"
            onClick={() => navigate('/automations/new')}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            New Automation
          </Button>
        }
      />

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" className="text-muted-foreground" />
        </div>
      ) : !automations?.length ? (
        <EmptyState
          icon={<Zap className="h-12 w-12" />}
          title="No automations yet"
          hint="Create an automation to run workflows on a schedule, via webhook, or in a loop for multiple inputs"
          action={
            <Button
              variant="primary"
              onClick={() => navigate('/automations/new')}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              Create Automation
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          {automations.map((automation) => (
            <EntityListRow
              key={automation.id}
              onClick={() => navigate(`/automations/${automation.id}`)}
              leading={
                <div className={cn(
                  'h-2.5 w-2.5 rounded-full',
                  automation.enabled ? 'bg-success' : 'bg-muted-foreground',
                )} />
              }
              title={
                <>
                  <span className="truncate">{automation.name}</span>
                  <Badge
                    tone={
                      automation.triggerType === 'schedule'
                        ? 'info'
                        : automation.triggerType === 'webhook'
                          ? 'done'
                          : 'neutral'
                    }
                    size="sm"
                  >
                    {triggerIcons[automation.triggerType]}
                    {triggerLabels[automation.triggerType]}
                  </Badge>
                  {automation.inputMode === 'loop' && (
                    <Badge tone="warning" size="sm">
                      <Repeat className="h-3 w-3" />
                      Loop ({automation.loopItems?.length ?? 0} items)
                    </Badge>
                  )}
                  {automation.inputMode === 'batch' && (
                    <Badge tone="info" size="sm">
                      <Repeat className="h-3 w-3" />
                      Batch
                    </Badge>
                  )}
                  {automation.inputMode === 'script' && (
                    <Badge tone="done" size="sm">
                      <Repeat className="h-3 w-3" />
                      Script
                    </Badge>
                  )}
                </>
              }
              description={
                <>
                  {automation.description && (
                    <span className="block">{automation.description}</span>
                  )}
                  <span className="mt-1 flex gap-4">
                    <span>{automation.workflowIds.length} workflow{automation.workflowIds.length !== 1 ? 's' : ''}</span>
                    <span>Last run: {formatDate(automation.lastRunAt)}</span>
                    {automation.triggerType === 'schedule' && automation.cronExpression && (
                      <span>Cron: {automation.cronExpression}</span>
                    )}
                  </span>
                </>
              }
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => { e.stopPropagation(); handleTrigger(automation.id); }}
                    disabled={!automation.enabled || triggerMutation.isPending}
                    className="hover:text-success"
                    title="Run now"
                  >
                    {triggerMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => { e.stopPropagation(); handleToggle(automation); }}
                    title={automation.enabled ? 'Disable' : 'Enable'}
                  >
                    {automation.enabled
                      ? <ToggleRight className="h-4 w-4 text-success" />
                      : <ToggleLeft className="h-4 w-4" />
                    }
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => { e.stopPropagation(); handleDelete(automation.id); }}
                    className="hover:text-danger"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              }
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
