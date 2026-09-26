// ────────────────────────────────────────────────────────────────
// B-02 AgentPicker — the pure view (03 §2.1; board AgentPickerBoard).
//
// Trigger: a field "Bug Fixer · Project" with a clear button and, below it,
// the meta line "3 skills · 1 MCP server · claude-sonnet-5".
// Popover 760×508: list 420 (SearchInput "Search agents…", scope tabs
// All / Global / Project / Built-in with counts, the "No agent — just a
// model" row, groups Orchestrators / Workers; rows avatar · name · scope
// badge · description · model · "N skills · M MCP") · detail pane for the
// highlighted row (role · scope · version, description, orchestrate note,
// Team, Runtime, Skills / MCP counts, "Always on: Orchestration") · footer
// "↑↓ Navigate · ↵ Select · Esc Close" + "Manage agents".
//
// Keyboard as B-01: focus in the search field, ↑/↓ move the highlight
// (aria-activedescendant), Enter picks, Escape clears then closes.
// Everything shown comes from the agent list payload (D-36).
// ────────────────────────────────────────────────────────────────

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Agent } from '@generatorai/shared';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { agentPickerBox } from '@/ui/lib/popup.js';
import { KbdHintRow } from '@/ui/patterns/KbdHintRow/KbdHintRow.js';
import { optionSecondaryText } from '@/ui/primitives/Autocomplete/Autocomplete.js';
import { Avatar } from '@/ui/primitives/Avatar/Avatar.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import {
  SCOPE_FILTERS,
  agentHeadline,
  agentSummary,
  capabilityCounts,
  filterAgents,
  groupAgents,
  scopeCounts,
  scopeFilterLabel,
  scopeLabel,
  teamOf,
  type AgentScopeFilter,
} from './agentPickerModel.js';

export interface AgentPickerViewProps {
  /** The agents the user may pick (already filtered by role / exclusions / enabled). */
  agents: readonly Agent[];
  /** Every selectable agent, to resolve an orchestrator's team. Defaults to `agents`. */
  teamPool?: readonly Agent[];
  /** Selected agent ref (`scope:slug`); undefined = no agent. */
  value: string | undefined;
  /** A row was chosen; `undefined` for "No agent". The popover then closes. */
  onSelect: (ref: string | undefined) => void;
  loading?: boolean;
  disabled?: boolean;
  /** Trigger text when no agent is selected. */
  placeholder?: string;
  /** Render the "N skills · M MCP servers · model" line under the trigger. */
  showSummary?: boolean;
  /** Where "Manage agents" goes. Omit to hide the link. */
  manageAgentsHref?: string;
  /** Client-side navigation for the link (router); without it the link is a plain href. */
  onNavigate?: (href: string) => void;
  side?: 'top' | 'bottom';
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** On the trigger. Default `agent-picker`. */
  'data-testid'?: string;
}

const HINTS = [
  { keys: '↑↓', label: 'Navigate' },
  { keys: '↵', label: 'Select' },
  { keys: 'Esc', label: 'Close' },
] as const;

/** Choose "No agent", a worker or an orchestrator. */
export function AgentPickerView({
  agents,
  teamPool,
  value,
  onSelect,
  loading = false,
  disabled = false,
  placeholder = 'No agent (platform default)',
  showSummary = true,
  manageAgentsHref,
  onNavigate,
  side = 'bottom',
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  className,
  'data-testid': testId = 'agent-picker',
}: AgentPickerViewProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const popupRef = useRef<HTMLDivElement>(null);
  const selected = agents.find((a) => a.ref === value);

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <PopoverRoot open={open} onOpenChange={(next) => setOpen(next)}>
        <div className="relative flex min-w-0">
          <PopoverTrigger
            render={
              <Button
                variant="secondary"
                size="lg"
                trailingIcon="chevron-down"
                disabled={disabled}
                data-testid={testId}
                className={cn(
                  'w-full justify-between border-line-strong bg-sunken font-normal data-popup-open:border-focus',
                  selected && 'pr-10',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {selected ? (
                    <>
                      <Avatar name={selected.name} size={20} decorative />
                      <span className="truncate text-fg">{selected.name}</span>
                      <span className="shrink-0 text-small text-fg-3">{scopeLabel(selected.scope)}</span>
                    </>
                  ) : (
                    <span className="truncate text-fg-3">{placeholder}</span>
                  )}
                </span>
              </Button>
            }
          />
          {selected && !disabled ? (
            <IconButton
              size="sm"
              icon="x"
              label="Clear selection"
              tooltip={false}
              onClick={() => onSelect(undefined)}
              className="absolute top-1/2 right-7 -translate-y-1/2"
            />
          ) : null}
        </div>
        <PopoverPopup
          side={side}
          align="start"
          ref={popupRef}
          // Focus lands in the search field so typing filters at once.
          initialFocus={() => popupRef.current?.querySelector<HTMLElement>('[role="searchbox"]') ?? true}
          className={cn(agentPickerBox, 'flex flex-col overflow-hidden')}
          data-testid="agent-picker-popup"
        >
          <PopoverTitle className="sr-only">Choose an agent</PopoverTitle>
          <AgentPickerPanel
            agents={agents}
            teamPool={teamPool ?? agents}
            value={value}
            loading={loading}
            manageAgentsHref={manageAgentsHref}
            onNavigate={onNavigate}
            onSelect={(ref) => {
              onSelect(ref);
              setOpen(false);
            }}
          />
        </PopoverPopup>
      </PopoverRoot>
      {showSummary && selected ? (
        <p className="flex min-w-0 items-center gap-1.5 text-small text-fg-3" data-testid={`${testId}-summary`}>
          <Icon concept={selected.role === 'orchestrator' ? 'workflows' : 'agents'} size={12} className="shrink-0" />
          <span className="truncate">{agentSummary(selected)}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Highlight key of the "No agent" row. */
const NONE = '';

interface PanelProps {
  agents: readonly Agent[];
  teamPool: readonly Agent[];
  value: string | undefined;
  loading: boolean;
  manageAgentsHref?: string;
  onNavigate?: (href: string) => void;
  onSelect: (ref: string | undefined) => void;
}

/** The popover body. Base UI mounts it only while open, so scope, query and highlight start fresh. */
function AgentPickerPanel({ agents, teamPool, value, loading, manageAgentsHref, onNavigate, onSelect }: PanelProps) {
  const [scope, setScope] = useState<AgentScopeFilter>('all');
  const [query, setQuery] = useState('');
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const listId = useId();

  const counts = useMemo(() => scopeCounts(agents), [agents]);
  const groups = useMemo(() => groupAgents(filterAgents(agents, scope, query)), [agents, scope, query]);
  // Row keys in visual order: "No agent" first, then the grouped agents.
  const keys = useMemo(() => [NONE, ...groups.flatMap((g) => g.agents.map((a) => a.ref))], [groups]);
  const selectedKey = value ?? NONE;
  const highlighted =
    highlightedKey !== null && keys.includes(highlightedKey)
      ? highlightedKey
      : keys.includes(selectedKey)
        ? selectedKey
        : NONE;
  const optionId = (key: string) => `${listId}-${keys.indexOf(key)}`;
  const highlightedAgent = agents.find((a) => a.ref === highlighted);

  useEffect(() => {
    document.getElementById(`${listId}-${keys.indexOf(highlighted)}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted, keys, listId]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const at = keys.indexOf(highlighted);
      const next = keys[(at + (event.key === 'ArrowDown' ? 1 : -1) + keys.length) % keys.length];
      if (next !== undefined) setHighlightedKey(next);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onSelect(highlighted === NONE ? undefined : highlighted);
    } else if (event.key === 'Escape' && query) {
      // The first Escape only clears the query (SearchInput); keep the popover open.
      event.stopPropagation();
    }
  };

  const scopeItems = SCOPE_FILTERS.map((s) => ({ value: s, label: scopeFilterLabel(s), count: counts[s] }));
  const nothingMatches = groups.length === 0 && !loading;

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-105 shrink-0 flex-col border-r border-line-soft">
          <div className="flex shrink-0 flex-col gap-2 border-b border-line-soft p-2">
            <SearchInput
              size="sm"
              label="Search agents"
              placeholder="Search agents…"
              shortcut={null}
              value={query}
              onValueChange={(next) => {
                setQuery(next);
                setHighlightedKey(null);
              }}
              onKeyDown={onSearchKeyDown}
              aria-controls={listId}
              aria-activedescendant={optionId(highlighted)}
            />
            <SegmentedControl
              semantics="tabs"
              label="Agent scope"
              value={scope}
              onValueChange={(next) => {
                setScope(next);
                setHighlightedKey(null);
              }}
              items={scopeItems}
              className="self-start"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            <div id={listId} role="listbox" aria-label="Agents">
              <AgentOption
                id={optionId(NONE)}
                selected={value === undefined}
                highlighted={highlighted === NONE}
                onHover={() => setHighlightedKey(NONE)}
                onPick={() => onSelect(undefined)}
              >
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-control border border-dashed border-line-strong text-fg-3"
                >
                  <Icon concept="model" size={12} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ui text-fg">No agent — just a model</span>
                  <span className={cn('truncate text-small', optionSecondaryText)}>Uses the model you pick; add skills and MCP yourself.</span>
                </span>
              </AgentOption>
              {groups.map((group) => (
                <AgentGroupBlock key={group.key} label={group.label}>
                  {group.agents.map((agent) => (
                    <AgentOption
                      key={agent.ref}
                      id={optionId(agent.ref)}
                      selected={agent.ref === value}
                      highlighted={agent.ref === highlighted}
                      onHover={() => setHighlightedKey(agent.ref)}
                      onPick={() => onSelect(agent.ref)}
                    >
                      <Avatar name={agent.name} decorative className="group-data-highlighted/option:text-fg" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-ui text-fg">{agent.name}</span>
                          <Badge className="shrink-0 group-data-highlighted/option:text-fg">{scopeLabel(agent.scope)}</Badge>
                        </span>
                        <span className={cn('truncate text-small', optionSecondaryText)}>{agent.description}</span>
                      </span>
                      <span className={cn('flex max-w-36 shrink-0 flex-col items-end font-mono text-micro', optionSecondaryText)}>
                        {agent.runtime.model ? <span className="max-w-full truncate">{agent.runtime.model}</span> : null}
                        <span className="whitespace-nowrap">{capabilityCounts(agent)}</span>
                      </span>
                    </AgentOption>
                  ))}
                </AgentGroupBlock>
              ))}
            </div>
            {loading ? <SkeletonRows rows={3} label="Loading agents" /> : null}
            {nothingMatches ? (
              <p className="px-2 py-3 text-small text-fg-3" role="status">
                {query
                  ? `No agents match “${query.trim()}”.`
                  : scope === 'all'
                    ? 'No agents available.'
                    : `No ${scopeFilterLabel(scope).toLowerCase()} agents.`}
              </p>
            ) : null}
          </div>
        </div>
        <AgentDetail agent={highlightedAgent} team={highlightedAgent ? teamOf(highlightedAgent, teamPool) : []} />
      </div>
      <KbdHintRow
        hints={HINTS}
        className="min-h-8 shrink-0 border-t border-line-soft px-3"
        end={
          manageAgentsHref ? (
            <Link
              href={manageAgentsHref}
              className="text-small text-fg-2"
              onClick={(event) => {
                if (!onNavigate) return;
                event.preventDefault();
                onNavigate(manageAgentsHref);
              }}
            >
              Manage agents
            </Link>
          ) : null
        }
      />
    </>
  );
}

function AgentGroupBlock({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId}>
      <div id={labelId} className="flex h-step items-center px-2 text-small text-fg-3 select-none">
        {label}
      </div>
      {children}
    </div>
  );
}

function AgentOption({
  id,
  selected,
  highlighted,
  onHover,
  onPick,
  children,
}: {
  id: string;
  selected: boolean;
  highlighted: boolean;
  onHover: () => void;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      data-highlighted={highlighted || undefined}
      onMouseMove={highlighted ? undefined : onHover}
      // Keep focus in the search field; the click still picks.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      className="group/option flex min-h-11 cursor-default items-center gap-2.5 rounded-control-sm px-2 py-1 select-none data-highlighted:bg-selected"
    >
      {children}
      <span className="flex size-4 shrink-0 items-center justify-center text-fg">
        {selected ? <Icon concept="check" size={14} /> : null}
      </span>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-6 items-start gap-3 text-small">
      <dt className="w-20 shrink-0 pt-0.5 text-fg-3">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 pt-0.5 text-fg">{children}</dd>
    </div>
  );
}

function AgentDetail({ agent, team }: { agent: Agent | undefined; team: Agent[] }) {
  if (!agent) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-4" data-testid="agent-picker-detail">
        <span className="text-ui font-semibold text-fg">No agent</span>
        <p className="text-small text-fg-2">
          The chat runs on the model you pick, with only the skills and MCP servers you add to it.
        </p>
      </div>
    );
  }
  const orchestrator = agent.role === 'orchestrator';
  const runtime = [agent.runtime.model, agent.runtime.reasoningEffort ? `effort ${agent.runtime.reasoningEffort}` : null]
    .filter(Boolean)
    .join(' · ');
  const skills = agent.skillIds.length;
  const mcp = agent.mcpServerIds.length;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4" data-testid="agent-picker-detail">
      <div className="flex items-center gap-2.5">
        <Avatar name={agent.name} size={32} decorative />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-ui font-semibold text-fg">{agent.name}</span>
          <span className="truncate text-small text-fg-3">{agentHeadline(agent)}</span>
        </div>
      </div>
      <p className="text-small text-fg-2">{agent.description}</p>
      {orchestrator ? (
        <p className="flex items-center gap-2 rounded-control border border-line-soft bg-sunken px-2.5 py-1.5 text-small text-fg-2">
          <Icon concept="workflows" size={14} className="shrink-0 text-fg-3" />
          Orchestrate mode is enabled by this agent.
        </p>
      ) : null}
      {orchestrator && team.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-small text-fg-3">
            <Icon concept="users" size={12} />
            Team <span className="font-mono">{team.length}</span>
          </span>
          <ul className="flex flex-col" aria-label="Team">
            {team.map((member) => (
              <li key={member.ref} className="flex min-h-9 items-center gap-2">
                <Avatar name={member.name} size={20} decorative />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-small text-fg">{member.name}</span>
                  <span className="truncate text-micro text-fg-3">{member.description}</span>
                </span>
                {member.runtime.model ? (
                  <span className="max-w-32 shrink-0 truncate font-mono text-micro text-fg-3">{member.runtime.model}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <dl className="flex flex-col gap-0.5">
        <DetailRow label="Runtime">
          {runtime ? <span className="font-mono text-micro">{runtime}</span> : <span className="text-fg-3">Inherits the chat's model</span>}
        </DetailRow>
        <DetailRow label="Skills">
          <Badge>{skills === 1 ? '1 skill' : `${skills} skills`}</Badge>
        </DetailRow>
        <DetailRow label="MCP">
          <Badge>{mcp === 1 ? '1 server' : `${mcp} servers`}</Badge>
        </DetailRow>
        {orchestrator ? <DetailRow label="Always on">Orchestration (spawn workers)</DetailRow> : null}
      </dl>
    </div>
  );
}
