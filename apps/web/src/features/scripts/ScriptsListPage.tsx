// ────────────────────────────────────────────────────────────────
// ScriptsListPage (T-05 MasterDetail — "Scripts today" per the template's
// own doc comment; 04-screen-map.md §2.6 Scripts, §4.7 #59) — ports
// pages/{ScriptsListPage,ScriptDetailPage}.tsx onto the kit as one
// list+detail page (D-35 fallback port). Routed at both `scripts` and
// `scripts/:id`; the id (if any) selects the detail pane.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { RunProfile, WorkflowGraph } from '@generatorai/workflow-spec';
import { newIdempotencyKey } from '@generatorai/client-core';
import { useMaterializeScript, useScript, useScriptProfiles, useScripts, useScriptsStatus, useReloadScripts } from '@/hooks/scriptQueries.js';
import { useInvokeWorkflow } from '@/hooks/workflowQueries.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { RadioCard } from '@/ui/primitives/RadioCard/RadioCard.js';
import { RadioGroup } from '@/ui/primitives/RadioGroup/RadioGroup.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { Skeleton } from '@/ui/primitives/Skeleton/Skeleton.js';
import { EntityRow } from '@/ui/patterns/EntityRow/EntityRow.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { KeyValueList } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { ListPane } from '@/ui/patterns/ListPane/ListPane.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { MasterDetail } from '@/ui/templates/MasterDetail/MasterDetail.js';

export function ScriptsListPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: scripts, isLoading, error } = useScripts();
  const reloadScripts = useReloadScripts();
  const { data: status } = useScriptsStatus();
  const [search, setSearch] = useState('');

  const filtered = (scripts ?? []).filter((s) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return s.name?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q) || s.tags?.some((t: string) => t.toLowerCase().includes(q));
  });
  const selected = scripts?.find((s) => s.id === id);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
      <PageHeader breadcrumb={<Breadcrumb items={selected ? [{ label: 'Scripts' }, { label: selected.name, mono: true }] : [{ label: 'Scripts' }]} />} />
      <MasterDetail
        list={
          <ListPane
            headingLevel={1}
            title="Scripts"
            count={scripts?.length}
            action={<IconButton icon="refresh" label="Reload scripts" onClick={() => reloadScripts.mutate()} disabled={reloadScripts.isPending} />}
            search={<SearchInput value={search} onValueChange={setSearch} label="Filter scripts" placeholder="Filter scripts" size="sm" />}
            footer={
              <div className="flex flex-col gap-2">
                {reloadScripts.isError ? (
                  <Callout tone="err">{reloadScripts.error instanceof Error ? reloadScripts.error.message : String(reloadScripts.error)}</Callout>
                ) : null}
                <Callout>Scripts are .workflow.mjs files in templates/scripts on the server. Edit them in your editor, then Reload.</Callout>
              </div>
            }
          >
            {isLoading ? (
              <div className="flex flex-col gap-2 px-2 py-1">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} width="80%" />
                ))}
              </div>
            ) : error ? (
              <EmptyState tone="error" icon="warning" title="Couldn't load scripts" description={error instanceof Error ? error.message : String(error)} framed={false} />
            ) : filtered.length === 0 ? (
              search ? (
                <EmptyState icon="scripts" title="No scripts match your filter" framed={false} />
              ) : status && !status.enabled ? (
                // "No scripts found" was wrong here: the files exist, the server refuses to load them.
                <EmptyState
                  icon="lock"
                  title="Workflow scripts are turned off"
                  description={`${status.found > 0 ? `${status.found} .workflow.mjs ${status.found === 1 ? 'file is' : 'files are'} in templates/scripts but not loaded. ` : ''}Scripts run with the server's privileges: set GENERATORAI_ALLOW_WORKFLOW_SCRIPTS=true on a trusted server, restart it, then Reload.`}
                  framed={false}
                />
              ) : (
                <EmptyState
                  icon="scripts"
                  title="No workflow scripts found"
                  description="Place .workflow.mjs files in templates/scripts/ to define programmatic workflows."
                  framed={false}
                />
              )
            ) : (
              filtered.map((script) => (
                <EntityRow
                  key={script.id}
                  role="button"
                  tabIndex={0}
                  variant="nav"
                  icon="file-text"
                  title={script.name}
                  subtitle={`${script.stageCount ?? 0} stages${(script.profileCount ?? 0) > 0 ? ` · ${script.profileCount} profiles` : ''}`}
                  selected={script.id === id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/scripts/${script.id}`)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    navigate(`/scripts/${script.id}`);
                  }}
                  data-testid={`script-row-${script.id}`}
                />
              ))
            )}
          </ListPane>
        }
        detail={id ? <ScriptDetail id={id} /> : <EmptyState icon="scripts" title="Select a script" description="Pick a script from the list to see its stages and run it." />}
      />
    </div>
  );
}

function ScriptDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data: script, isLoading, error } = useScript(id);
  const { data: profiles } = useScriptProfiles(id);
  const materialize = useMaterializeScript();
  const invokeWorkflow = useInvokeWorkflow();
  const [selectedProfile, setSelectedProfile] = useState<string | undefined>();
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton width="40%" />
        <Skeleton shape="meta" />
      </div>
    );
  }
  if (error || !script) {
    return <EmptyState tone="error" icon="warning" title="Couldn't load script" description={error instanceof Error ? error.message : 'Not found'} />;
  }

  const metadata = script.metadata ?? script;
  const graph = script.graph as WorkflowGraph | undefined;
  const stages = graph?.stages ?? [];
  const edges = graph?.edges ?? [];

  const handleRun = () => {
    invokeWorkflow.mutate(
      { request: { target: { kind: 'script', scriptId: id }, variables: {}, ...(selectedProfile ? { profile: selectedProfile } : {}), client: 'web' }, idempotencyKey },
      {
        onSuccess: (result) => {
          setIdempotencyKey(newIdempotencyKey());
          navigate(`/workflows/${result.workflowDefinitionId}/runs/${result.runId}`);
        },
      },
    );
  };

  const handleMaterialize = () => {
    materialize.mutate({ id }, { onSuccess: (result) => navigate(`/workflows/${result.definitionId}`) });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        variant="detail"
        title={metadata.name}
        description={metadata.description}
        actions={
          <>
            <Button variant="secondary" icon="layers" onClick={handleMaterialize} disabled={materialize.isPending} loading={materialize.isPending}>
              Materialize as draft
            </Button>
            <Button variant="primary" icon="play" onClick={handleRun} disabled={invokeWorkflow.isPending} loading={invokeWorkflow.isPending} data-testid="script-run-button">
              Run script
            </Button>
          </>
        }
      />
      {metadata.tags?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {metadata.tags.map((tag: string) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      ) : null}

      {profiles && profiles.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-title font-semibold text-fg">Run profiles</h2>
          <RadioGroup
            aria-label="Run profile"
            value={selectedProfile ?? ''}
            onValueChange={(next) => setSelectedProfile((next as string) || undefined)}
            className="grid grid-cols-2 gap-2.5"
          >
            {(profiles as RunProfile[]).map((profile) => (
              <RadioCard
                key={profile.name}
                value={profile.name}
                title={profile.name}
                description={profile.description ?? (profile.overrides?.permissionMode ? `Permissions: ${profile.overrides.permissionMode}` : undefined)}
              />
            ))}
          </RadioGroup>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-title font-semibold text-fg">Stages ({stages.length})</h2>
        <div className="flex flex-col gap-1 rounded-card border border-line-soft">
          {stages.map((stage, i) => (
            <EntityRow
              key={stage.key}
              title={stage.name}
              subtitle={stage.kind === 'agent' && stage.prompts[0]?.text ? stage.prompts[0].text.slice(0, 100) : undefined}
              meta={<span className="font-mono">{i + 1}</span>}
            />
          ))}
        </div>
      </div>

      {edges.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-title font-semibold text-fg">Edges ({edges.length})</h2>
          <KeyValueList labelWidth={140} items={edges.map((edge) => ({ label: edge.from, value: `→ ${edge.to}`, meta: edge.on, mono: true }))} />
        </div>
      ) : null}
    </div>
  );
}
