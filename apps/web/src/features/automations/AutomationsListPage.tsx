// ────────────────────────────────────────────────────────────────
// AutomationsListPage (T-01 ListPage; 04-screen-map.md §2.6 Automations,
// §4.7 #58) — ports pages/AutomationsPage.tsx onto the kit (D-35 fallback:
// the Workflow Overhaul built this functional-only on legacy components; the
// redesign now rebuilds it on `ui/` + `blocks/`, per the owner).
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { resolveStatus, type Automation, type AutomationExecutionStatus } from '@generatorai/shared';
import {
  useAutomations,
  useDeleteAutomation,
  useDisableAutomation,
  useEnableAutomation,
  useLatestAutomationExecutions,
  useTriggerAutomation,
} from '@/hooks/automationQueries.js';
import { useWorkflowDefinitions } from '@/hooks/workflowQueries.js';
import { formatNextRun } from '@/lib/nextRun.js';
import { AutomationTriggerBadge } from './AutomationTriggerBadge.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { SegmentedControl, type SegmentedItem } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { DataTable, type DataTableColumn } from '@/ui/patterns/DataTable/DataTable.js';
import { FilterBar } from '@/ui/patterns/FilterBar/FilterBar.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { PERMISSION_LABELS } from '@/blocks/workflow/index.js';
import { ListPage } from '@/ui/templates/ListPage/ListPage.js';

const ALL_EXECUTION_STATUSES: AutomationExecutionStatus[] = ['pending', 'running', 'paused', 'completed', 'partial', 'failed', 'cancelled', 'skipped'];

type StatusFilter = 'all' | 'enabled' | 'disabled';

export function AutomationsListPage() {
  const navigate = useNavigate();
  const { data: automations, isLoading, isError, error, refetch } = useAutomations();
  const deleteMutation = useDeleteAutomation();
  const enableMutation = useEnableAutomation();
  const disableMutation = useDisableAutomation();
  const triggerMutation = useTriggerAutomation();
  const confirmer = useConfirm();
  const { data: definitions } = useWorkflowDefinitions();
  const definitionNames = useMemo(
    () => new Map((definitions ?? []).map((d: { id: string; name: string }) => [d.id, d.name])),
    [definitions],
  );

  // Not memoized: `byStatus` is a fresh closure per render over the polling
  // execution queries (useQueries), and automation counts are small (a
  // "handful" per the hook's own doc) — recomputing this map every render
  // is cheap and keeps it live as an execution's status transitions,
  // which a `useMemo` keyed on the (rarely-changing) `automations` array
  // reference would miss.
  const { byStatus: latestByStatus } = useLatestAutomationExecutions(automations ?? []);
  const latestExecutionByAutomation = new Map<string, ReturnType<typeof latestByStatus>[number]>();
  for (const exec of latestByStatus(ALL_EXECUTION_STATUSES)) latestExecutionByAutomation.set(exec.automationId, exec);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [runningId, setRunningId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!automations) return [];
    return automations.filter((a) => {
      if (status === 'enabled' && !a.enabled) return false;
      if (status === 'disabled' && a.enabled) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q);
    });
  }, [automations, search, status]);

  const statusItems: SegmentedItem<StatusFilter>[] = [
    { value: 'all', label: 'All', count: automations?.length },
    { value: 'enabled', label: 'Enabled', count: automations?.filter((a) => a.enabled).length },
    { value: 'disabled', label: 'Disabled', count: automations?.filter((a) => !a.enabled).length },
  ];

  const handleRunNow = (automation: Automation) => {
    setRunningId(automation.id);
    triggerMutation.mutate(
      { id: automation.id },
      { onSettled: () => setRunningId((current) => (current === automation.id ? null : current)) },
    );
  };

  const handleDelete = async (automation: Automation) => {
    const ok = await confirmer.confirm({
      title: `Delete "${automation.name}"?`,
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (ok) deleteMutation.mutate(automation.id);
  };

  const columns: readonly DataTableColumn<Automation>[] = [
    {
      id: 'name',
      header: 'Name',
      width: 'minmax(220px,1fr)',
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Switch
            checked={row.enabled}
            onCheckedChange={(checked) => (checked ? enableMutation.mutate(row.id) : disableMutation.mutate(row.id))}
            aria-label={row.enabled ? `Disable ${row.name}` : `Enable ${row.name}`}
          />
          <span className="flex min-w-0 flex-col">
            <Link render={<RouterLink to={`/automations/${row.id}`} />} className="truncate font-medium">
              {row.name}
            </Link>
            {row.projectId ? null : <span className="truncate text-small text-fg-3">All projects</span>}
          </span>
        </span>
      ),
    },
    {
      id: 'trigger',
      header: 'Trigger',
      width: 150,
      cell: (row) => <AutomationTriggerBadge triggerType={row.triggerType} label={row.triggerType === 'schedule' ? row.cronExpression : undefined} />,
    },
    {
      id: 'workflows',
      header: 'Workflows',
      width: 180,
      // Board Automations names the workflow ("Nightly dependency audit", "…, +1"); the count is the fallback.
      cell: (row) => {
        const names = row.workflowIds.map((id) => definitionNames.get(id)).filter((n): n is string => Boolean(n));
        if (names.length === 0) return `${row.workflowIds.length} workflow${row.workflowIds.length === 1 ? '' : 's'}`;
        const rest = row.workflowIds.length - 1;
        return (
          <span className="truncate text-small text-fg-2" title={names.join(', ')}>
            {names[0]}
            {rest > 0 ? `, +${rest}` : ''}
          </span>
        );
      },
    },
    {
      id: 'dataset',
      header: 'Dataset',
      width: 110,
      // A schema means one run per row (or group); without one each trigger runs the workflows once.
      cell: (row) =>
        row.dataSchema ? (
          row.defaultDataset?.parsedRowCount != null ? (
            `${row.defaultDataset.parsedRowCount} rows`
          ) : (
            'Per trigger'
          )
        ) : (
          <span className="text-fg-3">One run</span>
        ),
    },
    {
      id: 'permission',
      header: 'Permission',
      width: 120,
      cell: (row) => PERMISSION_LABELS[row.permissionMode as keyof typeof PERMISSION_LABELS] ?? row.permissionMode,
    },
    {
      id: 'lastExecution',
      header: 'Last execution',
      width: 150,
      cell: (row) => {
        const exec = latestExecutionByAutomation.get(row.id);
        if (!exec) return <span className="font-mono text-micro text-fg-3">—</span>;
        const resolved = resolveStatus('automationExecution', exec.status);
        return resolved ? <StatusBadge state={resolved.state} label={resolved.label} context="run" /> : null;
      },
    },
    {
      id: 'nextRun',
      header: 'Next run',
      width: 150,
      align: 'end',
      cell: (row) => {
        const next = formatNextRun(row.nextRunAt, { enabled: row.enabled });
        return <span className={next.none ? 'text-fg-3' : 'text-fg'}>{next.short}</span>;
      },
    },
  ];

  return (
    <>
      <ListPage
        header={<PageHeader title="Automations" />}
        title={
          <PageTitle
            title="Automations"
            count={automations ? automations.length : undefined}
            description="Schedule and trigger workflows automatically"
            actions={
              <Button variant="primary" icon="plus" onClick={() => navigate('/automations/new')} data-testid="automation-create-button">
                New automation
              </Button>
            }
          />
        }
        filters={
          <FilterBar
            search={<SearchInput value={search} onValueChange={setSearch} label="Search automations" placeholder="Search automations" />}
            scope={<SegmentedControl value={status} onValueChange={setStatus} items={statusItems} semantics="tabs" label="Automation status" />}
          />
        }
        content={
          isError ? (
            <EmptyState
              tone="error"
              icon="warning"
              title="Couldn't load automations"
              description={error instanceof Error ? error.message : String(error)}
              action={
                <Button size="sm" onClick={() => void refetch()}>
                  Retry
                </Button>
              }
            />
          ) : (
            <DataTable
              label="Automations"
              columns={columns}
              rows={filtered}
              getRowId={(row) => row.id}
              actionsWidth={76}
              loading={isLoading}
              rowActions={(row) => (
                <>
                  <IconButton
                    icon="play"
                    label={`Run ${row.name} now`}
                    size="sm"
                    disabled={!row.enabled || runningId === row.id}
                    onClick={() => handleRunNow(row)}
                  />
                  <MenuButton
                    label={`More actions for ${row.name}`}
                    iconOnly
                    icon="more"
                    items={[
                      row.enabled
                        ? { id: 'disable', label: 'Disable', icon: 'pause', onSelect: () => disableMutation.mutate(row.id) }
                        : { id: 'enable', label: 'Enable', icon: 'play', onSelect: () => enableMutation.mutate(row.id) },
                      { type: 'separator' },
                      { id: 'delete', label: 'Delete', icon: 'trash', danger: true, onSelect: () => void handleDelete(row) },
                    ]}
                  />
                </>
              )}
              empty={
                <EmptyState
                  icon="automations"
                  title={search || status !== 'all' ? 'No automations match your filters' : 'No automations yet'}
                  description="Create an automation to run workflows on a schedule, via webhook, or once per row of a dataset."
                  action={
                    <Button size="sm" variant="primary" icon="plus" onClick={() => navigate('/automations/new')}>
                      New automation
                    </Button>
                  }
                />
              }
              footer="Schedules fire only while GeneratorAI is running and the computer is awake · times shown in your local timezone"
            />
          )
        }
      />
      {confirmer.dialog}
    </>
  );
}
