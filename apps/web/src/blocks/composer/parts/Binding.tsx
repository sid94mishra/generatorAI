// ────────────────────────────────────────────────────────────────
// Who the next turn is bound to (ComposerStates "Binding"; 03 §3.2
// F-composer-04/05/19/20).
//
//   AgentChip          worker agent: name + lock, read-only (`chat-agent-chip`)
//   OrchestratingChip  orchestrate mode without an agent: "Orchestrating ·
//                      3 running", opens Background tasks
//   TeamRow            orchestrator agent: its team, "Orchestrate mode is
//                      enabled by this agent", running count
//   SkillsMcpChip      "4 skills · 2 MCP" → read-only list; changes go through
//                      Customize capabilities, never the composer
// The binding is frozen per conversation (rebinding would invalidate the
// prompt-cache prefix), so none of these edit it.
// ────────────────────────────────────────────────────────────────

import { Avatar } from '@/ui/primitives/Avatar/Avatar.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Icon } from '@/ui/icons/Icon.js';
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';

/** Worker agent chip; the title keeps the historical "Driven by …" wording. */
export function AgentChip({ name }: { name: string }) {
  return (
    <span
      data-testid="chat-agent-chip"
      title={`Driven by the “${name}” agent`}
      className="inline-flex h-control-sm shrink-0 items-center gap-1 rounded-control-sm px-1.5 text-small font-medium text-fg-2"
    >
      <Icon concept="agents" size={14} />
      <span className="max-w-40 truncate">{name}</span>
      <Icon concept="lock" size={12} className="text-fg-3" label="Agent is fixed for this chat" />
    </span>
  );
}

/** Orchestrate mode without an agent; opens the Background tasks tab. */
export function OrchestratingChip({ running, onOpenTasks }: { running: number; onOpenTasks?: (() => void) | undefined }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon="tasks"
      onClick={onOpenTasks}
      disabled={!onOpenTasks}
      className="gap-1 px-1.5 text-small font-medium text-fg-2"
      title="Open Background tasks"
    >
      Orchestrating
      {running > 0 ? <span className="ml-1.5 font-mono text-micro text-run">{running} running</span> : null}
    </Button>
  );
}

export interface TeamMember {
  ref: string;
  name: string;
  model?: string | undefined;
}

/** Under the toolbar for orchestrator-agent chats. */
export function TeamRow({
  team,
  running,
  onOpenTasks,
}: {
  team: TeamMember[];
  running: number;
  onOpenTasks?: (() => void) | undefined;
}) {
  return (
    <div data-testid="composer-team-row" className="flex min-h-7 items-center gap-2 border-t border-line-soft px-3.5 text-small text-fg-3">
      <Icon concept="users" size={14} />
      <span>Team</span>
      {team.length > 0 ? (
        <span className="flex items-center gap-0.5">
          {team.slice(0, 6).map((m) => (
            <span key={m.ref} title={m.model ? `${m.name} · ${m.model}` : m.name}>
              <Avatar name={m.name} size={20} />
            </span>
          ))}
          {team.length > 6 ? <span className="ml-1 text-micro">+{team.length - 6}</span> : null}
        </span>
      ) : null}
      <span className="min-w-0 truncate">Orchestrate mode is enabled by this agent</span>
      {running > 0 ? (
        <Button variant="ghost" size="sm" icon="tasks" onClick={onOpenTasks} disabled={!onOpenTasks} className="ml-auto font-mono text-micro text-run">
          {running} running
        </Button>
      ) : null}
    </div>
  );
}

/** "4 skills · 2 MCP" with a read-only list of what this chat's agent context carries. */
export function SkillsMcpChip({ skills, mcpServers }: { skills: string[]; mcpServers: string[] }) {
  const label = `${skills.length} skill${skills.length === 1 ? '' : 's'} · ${mcpServers.length} MCP`;
  return (
    <PopoverRoot>
      <PopoverTrigger
        render={
          <Chip icon="skills" title="Skills and MCP servers for this chat">
            {label}
          </Chip>
        }
      />
      <PopoverPopup side="top" align="start" className="flex w-72 flex-col gap-2 p-3">
        <PopoverTitle className="text-ui font-medium text-fg">Skills and MCP servers</PopoverTitle>
        <List title="Skills" icon="skills" items={skills} empty="No skills" />
        <List title="MCP servers" icon="mcp" items={mcpServers} empty="No MCP servers" />
        <p className="text-micro text-fg-3">Fixed when the chat started; change them through Customize capabilities.</p>
      </PopoverPopup>
    </PopoverRoot>
  );
}

function List({ title, icon, items, empty }: { title: string; icon: 'skills' | 'mcp'; items: string[]; empty: string }) {
  return (
    <div className="flex flex-col">
      <p className="flex min-h-5 items-center text-small text-fg-3">{title}</p>
      {items.length === 0 ? (
        <p className="text-small text-fg-3">{empty}</p>
      ) : (
        items.map((name) => (
          <span key={name} className="flex min-h-6 items-center gap-1.5 font-mono text-small text-fg">
            <Icon concept={icon} size={12} className="text-fg-3" />
            <span className="truncate">{name}</span>
          </span>
        ))
      )}
    </div>
  );
}
