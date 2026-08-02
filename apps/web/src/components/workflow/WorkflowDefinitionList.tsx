// ────────────────────────────────────────────────────────────────
// WorkflowDefinitionList — Sidebar list of workflow definitions
// Compact list with navigation, status indicators, action menu
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { GitBranch, MoreHorizontal, Play, Edit3, Trash2 } from 'lucide-react';
import { useWorkflowDefinitions, useDeleteWorkflowDefinition } from '@/hooks/workflowQueries.js';
import { ConfirmDialog, Spinner } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import type { WorkflowDefinition } from '@generatorai/shared';

interface WorkflowDefinitionListProps {
  activeDefinitionId?: string;
  onSelectDefinition?: (id: string) => void;
}

export function WorkflowDefinitionList({
  activeDefinitionId,
  onSelectDefinition,
}: WorkflowDefinitionListProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: definitions, isLoading, error } = useWorkflowDefinitions();
  const deleteDefinition = useDeleteWorkflowDefinition();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleSelect = (id: string) => {
    if (onSelectDefinition) {
      onSelectDefinition(id);
    } else {
      navigate(`/workflows/${id}`);
    }
  };

  const handleEdit = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    navigate(`/workflows/${id}/edit`);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteTarget(id);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteDefinition.mutateAsync(deleteTarget);
    setDeleteTarget(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-4 text-center text-sm text-danger">
        Failed to load workflows
      </div>
    );
  }

  if (!definitions || definitions.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <GitBranch className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No workflows yet
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create one to get started
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Workflow"
        description="Delete this workflow definition? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />

      {definitions.map((def) => (
        <DefinitionItem
          key={def.id}
          definition={def}
          isActive={def.id === activeDefinitionId || location.pathname.includes(def.id)}
          onClick={() => handleSelect(def.id)}
          onEdit={(e) => handleEdit(e, def.id)}
          onDelete={(e) => handleDelete(e, def.id)}
        />
      ))}
    </div>
  );
}

function DefinitionItem({
  definition,
  isActive,
  onClick,
  onEdit,
  onDelete,
}: {
  definition: WorkflowDefinition;
  isActive: boolean;
  onClick: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
      )}
    >
      <GitBranch className="h-4 w-4 shrink-0 text-primary" />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{definition.name}</div>
        {definition.description && (
          <div className="truncate text-xs text-muted-foreground">
            {definition.description}
          </div>
        )}
        {definition.tags.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {definition.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-block rounded bg-subtle px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions (visible on hover) */}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onEdit}
          className="rounded p-1 text-muted-foreground hover:bg-subtle hover:text-foreground"
          title="Edit workflow"
        >
          <Edit3 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground hover:bg-danger-muted hover:text-danger"
          title="Delete workflow"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
