// ────────────────────────────────────────────────────────────────
// ACP agents (docs/acp ACP-4…ACP-12), in Settings › Model providers.
//
// Every agent of the ACP Registry — its mark, version, description, licence
// and how it is distributed — with Install / Update / Uninstall (progress is
// polled), an Enable switch (an enabled agent runs and its models appear in
// the model picker as their own provider, ACP-3), write-only environment
// variables, sign-in per auth method (agent methods ask the agent; terminal
// methods show the exact command to run, ACP-12), sign-out, a connection
// test and the live status. Custom agents (a typed command, ACP-10) are
// added and removed here too.
//
// Natively supported agents (Claude, Codex, Copilot, OpenCode) stay listed
// with "Also available as a native provider" (ACP-7).
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import type { AcpAgentInfo, AcpAgentsResponse, AcpRegistryInfo } from '@generatorai/shared';
import { useAcpAgents, useRefreshAcpRegistry, useSetAcpAgentEnabled } from '@/hooks/acpQueries.js';
import { formatWhen } from '@/lib/formatWhen.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { ProviderLogo } from '@/ui/primitives/ProviderLogo/ProviderLogo.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { CatalogRow } from '../CatalogRow.js';
import { AcpAgentDetails, AcpCustomAgentForm } from './AcpAgentDetails.js';
import { agentBadges, enableable, filterAcpAgents } from './acpAgentModel.js';

const SOURCE_LABEL: Record<AcpRegistryInfo['source'], string> = {
  network: 'ACP Registry',
  cache: 'ACP Registry (saved copy)',
  snapshot: 'ACP Registry (built-in copy)',
};

export function AcpAgentsSection() {
  const { data, isLoading, error } = useAcpAgents();
  const refresh = useRefreshAcpRegistry();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const agents = useMemo(() => filterAcpAgents(data?.agents ?? [], query), [data, query]);
  const enabledCount = data?.agents.filter((a) => a.enabled).length ?? 0;

  return (
    <section className="flex flex-col gap-2" data-testid="acp-agents-section" aria-label="ACP agents">
      <SectionHeader
        title="ACP agents"
        level={3}
        count={data ? data.agents.length : undefined}
        action={
          <Button
            variant="ghost"
            size="sm"
            icon="refresh"
            loading={refresh.isPending}
            onClick={() => refresh.mutate()}
            disabled={!data}
          >
            Refresh
          </Button>
        }
      />
      <p className="text-small text-fg-3">
        Coding agents that speak the Agent Client Protocol. Install one, sign in, and turn it on: its models then appear in the
        model picker as their own provider.
      </p>

      {data ? <RegistryLine data={data} enabledCount={enabledCount} /> : null}
      {refresh.error ? <Callout tone="err">{refresh.error.message}</Callout> : null}

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-small text-fg-3">
          <Spinner size={14} /> Loading ACP agents…
        </div>
      ) : !data ? (
        <Callout tone="err">{error instanceof Error ? `Could not load ACP agents: ${error.message}` : 'Could not load ACP agents.'}</Callout>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <SearchInput
              size="sm"
              label="Search agents"
              placeholder="Search agents"
              shortcut={null}
              value={query}
              onValueChange={setQuery}
              className="min-w-0 flex-1"
            />
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              Add custom agent
            </Button>
          </div>

          {adding ? <AcpCustomAgentForm onDone={() => setAdding(false)} /> : null}

          {agents.length === 0 ? (
            <p className="py-3 text-small text-fg-3" role="status">
              {query ? `No agents match “${query.trim()}”.` : 'The registry lists no agents.'}
            </p>
          ) : (
            <div className="flex flex-col gap-2" data-testid="acp-agent-list">
              {agents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  node={data.node}
                  open={expanded === agent.id}
                  onOpenChange={(open) => setExpanded(open ? agent.id : null)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RegistryLine({ data, enabledCount }: { data: AcpAgentsResponse; enabledCount: number }) {
  const { registry, node } = data;
  const when = registry.fetchedAt ? `updated ${formatWhen(registry.fetchedAt)}` : null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-small text-fg-3" data-testid="acp-registry-info">
        {[SOURCE_LABEL[registry.source], when, `${enabledCount} turned on`].filter(Boolean).join(' · ')}
      </p>
      {registry.error ? (
        <Callout tone="warn">Could not reach the ACP Registry ({registry.error}). Showing the saved list.</Callout>
      ) : null}
      {!node.available ? (
        <p className="text-small text-fg-3">
          {node.error ?? 'Node.js 18 or later was not found on this computer'}, so agents distributed as npm packages cannot be
          installed.
        </p>
      ) : null}
    </div>
  );
}

function AgentRow({
  agent,
  node,
  open,
  onOpenChange,
}: {
  agent: AcpAgentInfo;
  node: AcpAgentsResponse['node'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setEnabled = useSetAcpAgentEnabled();
  const badges = agentBadges(agent, node);
  const canEnable = enableable(agent);
  return (
    <CatalogRow
      data-testid={`acp-agent-${agent.id}`}
      title={
        <span className="inline-flex items-center gap-2">
          <ProviderLogo provider="acp" mark={agent.mark} size={16} />
          {agent.name}
          {agent.version ? <span className="font-mono text-micro font-normal text-fg-3">v{agent.version}</span> : null}
        </span>
      }
      badges={
        <>
          {badges.map((b) => (
            <Badge key={b.label} tone={b.tone} size="sm" title={b.title}>
              {b.label}
            </Badge>
          ))}
        </>
      }
      subtitle={agent.description || (agent.custom ? agent.command?.command : undefined)}
      open={open}
      onOpenChange={onOpenChange}
      control={
        setEnabled.isPending ? (
          <Spinner size={14} className="text-fg-3" />
        ) : (
          <Switch
            aria-label={`Turn on ${agent.name}`}
            checked={agent.enabled}
            disabled={!canEnable}
            title={canEnable ? undefined : 'Install the agent first.'}
            onCheckedChange={(enabled) => setEnabled.mutate({ id: agent.id, enabled })}
          />
        )
      }
    >
      <AcpAgentDetails agent={agent} enableError={setEnabled.error?.message ?? null} />
    </CatalogRow>
  );
}
