// ────────────────────────────────────────────────────────────────
// BuilderHeader — L-04's C-01 PageHeader for the workflow builder
// (WorkflowBuilder board): breadcrumb "Workflows / <name>" with the name
// editable in place, the version chip (Published v7 / Draft) and "Agent
// draft", "Unsaved changes" and the transient save/validate notes; then
// undo · redo · history | Save · Validate (error/warning counts) · Publish
// · Run (Test run / Save and run / Publish and run / Run) · More · the
// inspector toggle.
// ────────────────────────────────────────────────────────────────

import { Link as RouterLink } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useDefinitionVersions } from '@/hooks/workflowQueries.js';
import { isMacOS } from '@/lib/desktop.js';
import { DraftChip, VersionChip } from '@/blocks/workflow/VersionChip/VersionChip.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Separator } from '@/ui/primitives/Separator/Separator.js';
import { Icon } from '@/ui/icons/Icon.js';
import { RUN_LABELS, type RunMode } from './useBuilderDocument.js';

const MOD = isMacOS ? '⌘' : 'Ctrl';
const SAVE_KEYS = [MOD, 'S'] as const;
const UNDO_KEYS = [MOD, 'Z'] as const;
const REDO_KEYS = isMacOS ? (['⇧', '⌘', 'Z'] as const) : (['Ctrl', 'Shift', 'Z'] as const);

export interface BuilderHeaderProps {
  isNew: boolean;
  /** An existing workflow whose record has not loaded yet: nothing may be saved over it. */
  loading: boolean;
  isAgentDraft: boolean;
  runMode: RunMode;
  isPublishing: boolean;
  saveSuccess: boolean;
  saveError: string | null;
  validateOk: boolean;
  historyOpen: boolean;
  inspectorOpen: boolean;
  onSave: () => void;
  onValidate: () => void;
  onPublish: () => void;
  onRun: () => void;
  onExport: () => void;
  onOpenSettings: () => void;
  onToggleHistory: () => void;
  onToggleInspector: () => void;
}

export function BuilderHeader({
  isNew,
  loading,
  isAgentDraft,
  runMode,
  isPublishing,
  saveSuccess,
  saveError,
  validateOk,
  historyOpen,
  inspectorOpen,
  onSave,
  onValidate,
  onPublish,
  onRun,
  onExport,
  onOpenSettings,
  onToggleHistory,
  onToggleInspector,
}: BuilderHeaderProps) {
  const name = useWorkflowBuilderStore((s) => s.workflow.name);
  const setName = useWorkflowBuilderStore((s) => s.setName);
  const status = useWorkflowBuilderStore((s) => s.status);
  const revision = useWorkflowBuilderStore((s) => s.revision);
  const isDirty = useWorkflowBuilderStore((s) => s.isDirty);
  const isSaving = useWorkflowBuilderStore((s) => s.isSaving);
  const definitionId = useWorkflowBuilderStore((s) => s.definitionId);
  const currentVersionId = useWorkflowBuilderStore((s) => s.currentVersionId);
  const hasUnpublishedChanges = useWorkflowBuilderStore((s) => s.hasUnpublishedChanges);
  const canUndo = useWorkflowBuilderStore((s) => s.canUndo());
  const canRedo = useWorkflowBuilderStore((s) => s.canRedo());
  const undo = useWorkflowBuilderStore((s) => s.undo);
  const redo = useWorkflowBuilderStore((s) => s.redo);
  const counts = useWorkflowBuilderStore(
    useShallow((s) => ({
      errors: s.issues.filter((i) => i.severity === 'error').length,
      warnings: s.issues.filter((i) => i.severity === 'warning').length,
    })),
  );
  const { data: versions } = useDefinitionVersions(definitionId ?? undefined, { enabled: status === 'published' });
  const liveVersion = versions?.find((v) => v.id === currentVersionId)?.version;

  const blocked = isSaving || loading;
  const publishDisabled = blocked || isPublishing || (status === 'published' && !isDirty && !hasUnpublishedChanges);

  return (
    <PageHeader
      breadcrumb={
        <Breadcrumb
          items={[
            { label: 'Workflows', render: <RouterLink to="/workflows" /> },
            {
              // The current crumb is the name itself, editable in place.
              label: (
                <Input
                  size="sm"
                  aria-label="Workflow name"
                  placeholder="Untitled Workflow"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-64 border-transparent bg-transparent hover:border-line"
                  inputClassName="font-semibold"
                />
              ),
            },
          ]}
        />
      }
      status={
        <>
          {status === 'published' ? (
            <VersionChip
              version={liveVersion}
              hasUnpublishedChanges={hasUnpublishedChanges}
              title={hasUnpublishedChanges ? 'Runs use the published version; saved changes are not published yet' : 'Runs use this version'}
            />
          ) : status ? (
            <DraftChip revision={revision ?? undefined} title="A draft runs only as a test run" />
          ) : null}
          {isAgentDraft ? <Badge icon="agents">Agent draft</Badge> : null}
        </>
      }
      meta={
        <>
          {isDirty ? <span>Unsaved changes</span> : null}
          {saveSuccess ? (
            <span role="status" className="flex items-center gap-1 text-ok">
              <Icon concept="status-succeeded" size={12} /> Saved
            </span>
          ) : null}
          {validateOk ? (
            <span role="status" className="flex items-center gap-1 text-ok">
              <Icon concept="status-succeeded" size={12} /> Workflow is valid
            </span>
          ) : null}
          {saveError ? (
            <span role="alert" className="flex items-center gap-1 text-err">
              <Icon concept="status-failed" size={12} /> {saveError}
            </span>
          ) : null}
        </>
      }
      actions={
        <>
          <IconButton icon="undo" label="Undo" shortcut={UNDO_KEYS} tooltip disabled={!canUndo} onClick={undo} />
          <IconButton icon="redo" label="Redo" shortcut={REDO_KEYS} tooltip disabled={!canRedo} onClick={redo} />
          <IconButton
            icon="history"
            label="Version history"
            tooltip
            pressed={historyOpen}
            disabled={!definitionId}
            onClick={onToggleHistory}
          />
          <Separator orientation="vertical" className="mx-1" />
          <Button size="sm" icon="save" shortcut={SAVE_KEYS} loading={isSaving} disabled={blocked} onClick={onSave}>
            Save
          </Button>
          <Button size="sm" icon={counts.errors > 0 ? 'status-failed' : 'check'} onClick={onValidate} title="Validate the workflow">
            Validate
            {counts.errors > 0 ? <span className="font-mono text-micro text-err">{counts.errors}</span> : null}
            {counts.warnings > 0 ? <span className="font-mono text-micro text-warn">{counts.warnings}</span> : null}
          </Button>
          <Button
            size="sm"
            icon="upload"
            loading={isPublishing}
            disabled={publishDisabled || counts.errors > 0}
            onClick={onPublish}
            title={counts.errors > 0 ? 'Fix the errors to publish' : 'Publish: runs use the published version'}
          >
            Publish
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="play"
            disabled={blocked || counts.errors > 0}
            onClick={onRun}
            title={counts.errors > 0 ? 'Fix the errors to run' : undefined}
          >
            {RUN_LABELS[runMode]}
          </Button>
          <MenuButton
            label="More"
            icon="more"
            iconOnly
            size="sm"
            align="end"
            items={[
              { id: 'settings', label: 'Workflow settings', icon: 'settings', onSelect: onOpenSettings },
              {
                id: 'export',
                label: isDirty ? 'Export the saved version' : 'Export as JSON',
                icon: 'download',
                disabled: isNew || !definitionId,
                onSelect: onExport,
              },
            ]}
          />
          <IconButton
            icon="dock"
            label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            tooltip
            pressed={inspectorOpen}
            onClick={onToggleInspector}
          />
        </>
      }
    />
  );
}
