// ────────────────────────────────────────────────────────────────
// ScriptsListPage — Grid of discovered .workflow.mjs scripts
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileCode2,
  Play,
  RefreshCw,
  AlertCircle,
  Layers,
} from 'lucide-react';

import { useScripts, useReloadScripts, useRunScript } from '@/hooks/scriptQueries.js';
import { CardGridSkeleton } from '@/components/Skeleton.js';
import { SearchInput, EmptyState, Button, Badge, PageHeader } from '@/components/ui/index.js';
import { EntityCard } from '@/components/data/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { Toolbar } from '@/components/layout/Toolbar.js';
import { cn } from '@/lib/utils.js';

/** Shape of a row from GET /api/workflow-scripts (the platform client is untyped here). */
interface ScriptListItem {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  stageCount?: number;
  profileCount?: number;
}

export function ScriptsListPage() {
  const navigate = useNavigate();
  const { data: scripts, isLoading, error } = useScripts();
  const reloadScripts = useReloadScripts();
  const runScript = useRunScript();

  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!scripts) return [];
    let result = scripts;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s: ScriptListItem) =>
          s.name?.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q) ||
          s.tags?.some((t: string) => t.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [scripts, search]);

  if (isLoading) return <CardGridSkeleton count={6} />;
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-destructive gap-2">
        <AlertCircle className="w-8 h-8" />
        <p>Failed to load scripts: {(error as Error).message}</p>
      </div>
    );
  }

  return (
    <PageContainer>
      {/* Header */}
      <PageHeader
        className="mb-8"
        title="Scripts"
        subtitle="Programmatic workflow definitions (.workflow.mjs)"
        actions={
          <Button
            variant="secondary"
            onClick={() => reloadScripts.mutate()}
            disabled={reloadScripts.isPending}
            leftIcon={<RefreshCw className={cn('w-4 h-4', reloadScripts.isPending && 'animate-spin')} />}
          >
            Reload
          </Button>
        }
      />

      {/* Search */}
      <Toolbar className="mb-6">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search scripts by name, description, or tag…"
          aria-label="Search scripts"
          className="min-w-0 flex-1"
        />
      </Toolbar>

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<FileCode2 className="h-12 w-12" />}
          title={search ? 'No scripts match your search' : 'No workflow scripts found'}
          hint="Place .workflow.mjs files in templates/scripts/ to define programmatic workflows"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((script: ScriptListItem) => (
            <EntityCard
              key={script.id}
              icon={<FileCode2 className="w-5 h-5" />}
              title={script.name}
              description={script.description}
              onClick={() => navigate(`/scripts/${script.id}`)}
              actions={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    runScript.mutate({ id: script.id });
                  }}
                  className="h-auto w-auto rounded-lg bg-success-muted p-2 text-success transition-colors hover:bg-success/20 hover:text-success"
                  title="Run with defaults"
                  aria-label={`Run ${script.name ?? 'script'} with defaults`}
                >
                  <Play className="w-4 h-4" />
                </Button>
              }
              meta={
                <>
                  <span className="flex items-center gap-1">
                    <Layers className="w-3 h-3" />
                    {script.stageCount ?? 0} stages
                  </span>
                  {(script.profileCount ?? 0) > 0 && (
                    <span className="flex items-center gap-1">
                      <Play className="w-3 h-3" />
                      {script.profileCount} profiles
                    </span>
                  )}
                </>
              }
            >
              {(script.tags?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {script.tags!.slice(0, 4).map((tag: string) => (
                    <Badge key={tag} tone="neutral" size="sm">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </EntityCard>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
