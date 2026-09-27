// ────────────────────────────────────────────────────────────────
// WorkflowDetail body cards (board WorkflowDetail; D-42: the graph the server
// stores is what is shown). Stages — a read-only table of the working graph
// in place of the legacy read-only DAG canvas: name, key (WF-02), kind, what
// it runs after (edges, with their `on`/`when`), agent/model and approval;
// Setup — project, codebases, default session, pre/post-processing, hooks,
// budget; Variables — what the Run dialog asks for.
// ────────────────────────────────────────────────────────────────

import { Link as RouterLink } from 'react-router';
import type { WorkflowGraph } from '@generatorai/workflow-spec';
import { KeyChip } from '@/blocks/workflow/index.js';
import type { IconConcept } from '@/ui/icons/index.js';
import { KeyValueList, type KeyValueItem } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Icon } from '@/ui/icons/index.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { Table, TableBody, TableCell, TableHeadCell, TableHeader, TableRow } from '@/ui/primitives/Table/Table.js';
import { formatDuration, plural } from '../workflowFormat.js';

type Stage = WorkflowGraph['stages'][number];
type Edge = WorkflowGraph['edges'][number];

const KIND: Record<Stage['kind'], { label: string; icon: IconConcept }> = {
  agent: { label: 'Agent', icon: 'agents' },
  check: { label: 'Check', icon: 'scan' },
  loop: { label: 'Loop', icon: 'retry' },
  map: { label: 'Map', icon: 'layers' },
  subworkflow: { label: 'Sub-workflow', icon: 'workflows' },
  wait: { label: 'Wait', icon: 'clock' },
};

const ON_WORD: Record<Edge['on'], string> = { success: 'on success', failure: 'on failure', completion: 'on completion', always: 'always' };

function stageSession(stage: Stage): { agentRef?: string; model?: string } | undefined {
  return 'session' in stage ? (stage.session as { agentRef?: string; model?: string } | undefined) : undefined;
}

function hasApproval(stage: Stage): boolean {
  return ('approval' in stage && !!stage.approval) || (stage.kind === 'wait' && stage.wait.type === 'approval');
}

/** Stages in graph order with each container's body right after it. */
function ordered(stages: readonly Stage[]): Array<{ stage: Stage; depth: number }> {
  const out: Array<{ stage: Stage; depth: number }> = [];
  const visit = (parent: string | undefined, depth: number) => {
    for (const s of stages) {
      if (s.parentKey !== parent) continue;
      out.push({ stage: s, depth });
      visit(s.key, depth + 1);
    }
  };
  visit(undefined, 0);
  // A stage whose parent key is unknown still shows (the validator reports it).
  for (const s of stages) if (!out.some((o) => o.stage === s)) out.push({ stage: s, depth: 0 });
  return out;
}

export function StagesCard({ graph }: { graph: WorkflowGraph }) {
  const rows = ordered(graph.stages);
  return (
    <Card data-testid="workflow-stages">
      <Card.Header title="Stages" meta={String(graph.stages.length)} />
      {rows.length === 0 ? (
        <EmptyState icon="workflows" title="No stages yet" description="Open the builder to add the first stage." />
      ) : (
        <Table columns={['minmax(180px,1fr)', 150, 120, 'minmax(140px,1fr)', 160]} size="dense" inset="card" bare label="Stages">
          <TableHeader>
            <TableHeadCell>Stage</TableHeadCell>
            <TableHeadCell>Key</TableHeadCell>
            <TableHeadCell>Kind</TableHeadCell>
            <TableHeadCell>Runs after</TableHeadCell>
            <TableHeadCell>Agent · model</TableHeadCell>
          </TableHeader>
          <TableBody>
            {rows.map(({ stage, depth }) => {
              const incoming = graph.edges.filter((e) => e.to === stage.key);
              const session = stageSession(stage);
              const kind = KIND[stage.kind];
              return (
                <TableRow key={stage.key}>
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-1.5" title={stage.description}>
                      {depth > 0 ? <Icon concept="chevron-right" size={12} className="shrink-0 text-fg-3" /> : null}
                      <span className="truncate text-fg">{stage.name}</span>
                      {hasApproval(stage) ? <Icon concept="hand" size={12} className="shrink-0 text-warn" aria-label="Waits for approval" /> : null}
                      {stage.guard ? <Badge>conditional</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <KeyChip stageKey={stage.key} />
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="ghost" icon={kind.icon}>
                      {kind.label}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    {incoming.length === 0 ? (
                      <span className="text-small text-fg-3">{depth > 0 ? `in ${stage.parentKey}` : 'start'}</span>
                    ) : (
                      <span className="truncate text-small text-fg-2" title={incoming.map((e) => `${e.from} ${ON_WORD[e.on]}${e.when ? ` when ${e.when}` : ''}`).join('\n')}>
                        {incoming.map((e) => `${e.from}${e.on === 'success' ? '' : ` (${ON_WORD[e.on]})`}${e.when ? ' · when …' : ''}`).join(', ')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="truncate text-small text-fg-2">
                      {[session?.agentRef, session?.model].filter(Boolean).join(' · ') || <span className="text-fg-3">default</span>}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

const PERMISSION_WORD: Record<string, string> = {
  default: 'Ask',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  bypassPermissions: 'Full auto',
};

export function SetupCard({ graph, projectName }: { graph: WorkflowGraph; projectName: string | undefined }) {
  const w = graph.workflow;
  const lc = w.lifecycle;
  const session = w.session as { agentRef?: string; model?: string; reasoningEffort?: string; permissionMode?: string };
  const post = [
    lc.postProcessing.autoCommit || lc.postProcessing.autoPush || lc.postProcessing.autoCreatePR ? 'Commit' : null,
    lc.postProcessing.autoPush || lc.postProcessing.autoCreatePR ? 'Push' : null,
    lc.postProcessing.autoCreatePR ? 'PR' : null,
    ...lc.postProcessing.steps.map((s) => s.name),
  ].filter((x): x is string => !!x);
  const budget = w.budget
    ? [
        w.budget.maxTurns !== undefined ? `${w.budget.maxTurns} turns` : null,
        w.budget.maxTokens !== undefined ? `${w.budget.maxTokens.toLocaleString()} tokens` : null,
        w.budget.maxCostUsd !== undefined ? `$${w.budget.maxCostUsd}` : null,
        w.budget.maxWallClockMs !== undefined ? formatDuration(w.budget.maxWallClockMs) : null,
      ].filter(Boolean)
    : [];

  const items: KeyValueItem[] = [
    {
      label: 'Project',
      value: w.projectId ? (
        <Link render={<RouterLink to={`/projects/${w.projectId}`} />}>{projectName ?? 'Project'}</Link>
      ) : (
        <span className="text-fg-3">No project</span>
      ),
    },
    {
      label: 'Codebases',
      value:
        lc.codebaseAliases.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {lc.codebaseAliases.map((a) => (
              <span key={a} className="font-mono">
                {a}
              </span>
            ))}
            <span className="text-fg-3">· {lc.useWorktree ? 'worktree' : 'in place'}</span>
            {lc.requiresCodebase ? <span className="text-fg-3">· required</span> : null}
          </span>
        ) : (
          <span className="text-fg-3">None</span>
        ),
    },
    {
      label: 'Default session',
      value: [session.agentRef, session.model, session.reasoningEffort, session.permissionMode ? PERMISSION_WORD[session.permissionMode] : null]
        .filter(Boolean)
        .join(' · ') || <span className="text-fg-3">Deployment defaults</span>,
    },
    ...(lc.preprocessingSteps.length > 0
      ? [{ label: 'Before stages', value: lc.preprocessingSteps.map((s) => s.name).join(' → ') }]
      : []),
    { label: 'Post-processing', value: post.length > 0 ? post.join(' → ') : <span className="text-fg-3">Nothing</span> },
    ...(w.hooks.length > 0 ? [{ label: 'Workflow hooks', value: plural(w.hooks.length, 'hook') }] : []),
    ...(budget.length > 0 ? [{ label: 'Budget', value: budget.join(' · ') }] : []),
    ...(w.maxParallel !== undefined ? [{ label: 'Parallel stages', value: String(w.maxParallel), mono: true }] : []),
  ];
  return (
    <Card>
      <Card.Header title="Setup" />
      <Card.Body>
        <KeyValueList items={items} labelWidth={120} />
      </Card.Body>
    </Card>
  );
}

export function VariablesCard({ graph }: { graph: WorkflowGraph }) {
  const vars = graph.workflow.variables;
  return (
    <Card>
      <Card.Header title="Variables" meta={vars.length > 0 ? `${vars.length} · asked for in the Run dialog` : undefined} />
      {vars.length === 0 ? (
        <Card.Body>
          <p className="text-small text-fg-3">No input variables.</p>
        </Card.Body>
      ) : (
        <Table columns={['minmax(0,2fr)', 120, 'minmax(0,1fr)']} size="dense" inset="card" bare label="Variables">
          <TableHeader>
            <TableHeadCell>Name</TableHeadCell>
            <TableHeadCell>Type</TableHeadCell>
            <TableHeadCell align="end">Default</TableHeadCell>
          </TableHeader>
          <TableBody>
            {vars.map((v) => (
              <TableRow key={v.name}>
                <TableCell>
                  <span className="flex min-w-0 items-center gap-2" title={v.description}>
                    <span className="truncate font-mono text-small text-fg">{v.name}</span>
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-small text-fg-2">
                    {v.type[0]!.toUpperCase() + v.type.slice(1)}
                    {v.required ? <span className="text-fg-3"> · required</span> : null}
                  </span>
                </TableCell>
                <TableCell mono align="end">
                  {v.defaultValue === undefined ? '—' : typeof v.defaultValue === 'string' ? v.defaultValue : JSON.stringify(v.defaultValue)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
