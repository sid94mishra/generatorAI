// ────────────────────────────────────────────────────────────────
// ScriptDetailPage — View script details, profiles, run/materialize
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FileCode2,
  Play,
  Layers,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Cpu,
} from 'lucide-react';

import { useScript, useScriptProfiles, useMaterializeScript, useRunScript } from '@/hooks/scriptQueries.js';
import { CardGridSkeleton } from '@/components/Skeleton.js';
import { Button, Badge, PageHeader } from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { cn } from '@/lib/utils.js';
import { usePageTitle } from '@/hooks/usePageTitle.js';

export function ScriptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: script, isLoading, error } = useScript(id);

  usePageTitle(script?.metadata?.name ?? script?.id);
  const { data: profiles } = useScriptProfiles(id);
  const materialize = useMaterializeScript();
  const runScript = useRunScript();

  const [selectedProfile, setSelectedProfile] = useState<string | undefined>();

  if (isLoading) return <CardGridSkeleton count={3} />;
  if (error || !script) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-destructive gap-2">
        <AlertCircle className="w-8 h-8" />
        <p>Failed to load script: {(error as Error)?.message ?? 'Not found'}</p>
      </div>
    );
  }

  const metadata = script.metadata ?? script;
  const stages = script.stages ?? [];
  const edges = script.edges ?? [];

  const handleRun = () => {
    runScript.mutate(
      { id: id!, options: { profileName: selectedProfile } },
      {
        onSuccess: (result) => {
          navigate(`/workflows/${result.definitionId}/runs/${result.runId}`);
        },
      },
    );
  };

  const handleMaterialize = () => {
    materialize.mutate(
      { id: id! },
      {
        onSuccess: (result) => {
          navigate(`/workflows/${result.definitionId}`);
        },
      },
    );
  };

  return (
    <PageContainer variant="narrow">
      {/* Back + Header */}
      <PageHeader
        className="mb-6"
        leading={
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/scripts')}
              aria-label="Back to scripts"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <FileCode2 className="w-6 h-6 text-primary" />
          </div>
        }
        title={metadata.name}
        subtitle={metadata.description}
        actions={
          <>
            <Button
              variant="primary"
              onClick={handleRun}
              disabled={runScript.isPending}
              loading={runScript.isPending}
              leftIcon={<Play className="w-4 h-4" />}
            >
              Run Script
            </Button>
            <Button
              variant="secondary"
              onClick={handleMaterialize}
              disabled={materialize.isPending}
              loading={materialize.isPending}
              leftIcon={<Layers className="w-4 h-4" />}
            >
              Materialize
            </Button>
          </>
        }
      />

      {/* Tags */}
      {metadata.tags?.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {metadata.tags.map((tag: string) => (
            <Badge key={tag} tone="neutral" size="md">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Profiles */}
      {profiles && profiles.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5 mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-done" />
            Run Profiles
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {profiles.map((profile: { name: string; description?: string; sessionMode?: string }) => (
              <button
                key={profile.name}
                onClick={() => setSelectedProfile(profile.name === selectedProfile ? undefined : profile.name)}
                className={cn(
                  'text-left p-3 rounded-lg border transition-all',
                  selectedProfile === profile.name
                    ? 'border-primary bg-accent text-foreground'
                    : 'border-border bg-subtle text-foreground hover:border-primary',
                )}
              >
                <div className="font-medium text-sm">{profile.name}</div>
                {profile.description && (
                  <div className="text-xs text-muted-foreground mt-1">{profile.description}</div>
                )}
                {profile.sessionMode && (
                  <div className="text-xs text-muted-foreground mt-1">Mode: {profile.sessionMode}</div>
                )}
              </button>
            ))}
          </div>
          {selectedProfile && (
            <p className="text-xs text-primary mt-2">
              Selected profile: <strong>{selectedProfile}</strong> — will be used on next run.
            </p>
          )}
        </div>
      )}

      {/* Stages */}
      <div className="rounded-lg border border-border bg-card p-5 mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
          <Layers className="w-5 h-5 text-info" />
          Stages ({stages.length})
        </h2>
        <div className="space-y-2">
          {stages.map((stage: { localId?: string; config?: { name?: string; prompt?: { content?: string } } }, idx: number) => (
            <div key={stage.localId ?? idx} className="flex items-center gap-3 p-3 bg-subtle rounded-lg border border-border">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emphasis text-xs text-foreground font-mono">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  {stage.config?.name ?? stage.localId}
                </div>
                {stage.config?.prompt?.content && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {stage.config.prompt.content.slice(0, 80)}…
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edges */}
      {edges.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-semibold text-foreground mb-3">Edges ({edges.length})</h2>
          <div className="space-y-1.5">
            {edges.map((edge: { from: string; to: string; edgeType?: string }, idx: number) => (
              <div key={idx} className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-mono text-foreground">{edge.from}</span>
                <ArrowRight className="w-3 h-3" />
                <span className="font-mono text-foreground">{edge.to}</span>
                <span className="text-xs text-muted-foreground ml-2">({edge.edgeType ?? 'on_success'})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
