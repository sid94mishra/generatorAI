// ────────────────────────────────────────────────────────────────
// ChatsList filter chips (F-chats-01; 04-screen-map.md §2.1 ChatsList row):
// Project, Agent, Status, Tags (dropdown Chips) + the sort chip. `Status`
// here filters the LIVE `state` (needs_you/running/done/failed) — separate
// from the All/Active/Archived scope seg, which filters lifecycle `status`.
//
// Tags has no list endpoint (no "distinct tags" API, D-36): typed values are
// real filters against `?tag=`, not an invented enumerated list.
// ────────────────────────────────────────────────────────────────

import { useState, type KeyboardEvent } from 'react';
import type { ChatListSort, ChatListState } from '@generatorai/shared';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { useAgents } from '@/hooks/agentQueries.js';
import { useProjects } from '@/hooks/projectQueries.js';

function toggle<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function chipLabel(base: string, selected: readonly string[], nameOf: (id: string) => string | undefined): string {
  if (selected.length === 0) return base;
  if (selected.length === 1) return nameOf(selected[0]!) ?? base;
  return `${base} (${selected.length})`;
}

export interface FilterChipProps<T extends string> {
  value: readonly T[];
  onChange: (next: T[]) => void;
}

/** Project filter — options from `useProjects()` (real data, D-36). */
export function ProjectFilterChip({ value, onChange }: FilterChipProps<string>) {
  const { data: projects } = useProjects();
  const nameOf = (id: string) => projects?.find((p) => p.id === id)?.name;
  return (
    <Menu.Root>
      <Menu.Trigger render={<Chip dropdown>{chipLabel('Project', value, nameOf)}</Chip>} />
      <Menu.Popup>
        {(projects ?? []).length === 0 ? (
          <Menu.Item disabled>No projects</Menu.Item>
        ) : (
          (projects ?? []).map((project) => (
            <Menu.CheckboxItem
              key={project.id}
              checked={value.includes(project.id)}
              onCheckedChange={() => onChange(toggle(value, project.id))}
            >
              {project.name}
            </Menu.CheckboxItem>
          ))
        )}
      </Menu.Popup>
    </Menu.Root>
  );
}

/** Agent filter — options from `useAgents()` (real data, D-36). */
export function AgentFilterChip({ value, onChange }: FilterChipProps<string>) {
  const { data: agents } = useAgents();
  const nameOf = (ref: string) => agents?.find((a) => a.ref === ref)?.name;
  return (
    <Menu.Root>
      <Menu.Trigger render={<Chip dropdown>{chipLabel('Agent', value, nameOf)}</Chip>} />
      <Menu.Popup>
        {(agents ?? []).length === 0 ? (
          <Menu.Item disabled>No agents</Menu.Item>
        ) : (
          (agents ?? []).map((agent) => (
            <Menu.CheckboxItem
              key={agent.ref}
              checked={value.includes(agent.ref)}
              onCheckedChange={() => onChange(toggle(value, agent.ref))}
            >
              {agent.name}
            </Menu.CheckboxItem>
          ))
        )}
      </Menu.Popup>
    </Menu.Root>
  );
}

const STATE_LABELS: Record<ChatListState, string> = {
  needs_you: 'Needs you',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};
const STATE_OPTIONS: readonly ChatListState[] = ['needs_you', 'running', 'done', 'failed'];

/** Status filter — the LIVE `state` (attention feed + last-turn outcome, G-01/G-02). */
export function StatusFilterChip({ value, onChange }: FilterChipProps<ChatListState>) {
  const nameOf = (state: string) => STATE_LABELS[state as ChatListState];
  return (
    <Menu.Root>
      <Menu.Trigger render={<Chip dropdown>{chipLabel('Status', value, nameOf)}</Chip>} />
      <Menu.Popup>
        {STATE_OPTIONS.map((state) => (
          <Menu.CheckboxItem
            key={state}
            checked={value.includes(state)}
            onCheckedChange={() => onChange(toggle(value, state))}
          >
            {STATE_LABELS[state]}
          </Menu.CheckboxItem>
        ))}
      </Menu.Popup>
    </Menu.Root>
  );
}

/** Tags filter — free text against `?tag=` (no "list distinct tags" endpoint exists yet). */
export function TagsFilterChip({ value, onChange }: FilterChipProps<string>) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const tag = draft.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    add();
  };
  return (
    <Menu.Root>
      <Menu.Trigger render={<Chip dropdown>{value.length === 0 ? 'Tags' : `Tags (${value.length})`}</Chip>} />
      <Menu.Popup className="w-60">
        <div className="p-1">
          <Input
            size="sm"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Add tag and press ↵"
            aria-label="Add a tag filter"
          />
        </div>
        {value.length > 0 ? (
          <div className="flex flex-wrap gap-1 px-1 pb-1">
            {value.map((tag) => (
              <Chip key={tag} size="sm" onRemove={() => onChange(value.filter((t) => t !== tag))}>
                {tag}
              </Chip>
            ))}
          </div>
        ) : null}
      </Menu.Popup>
    </Menu.Root>
  );
}

export interface ChatsFilterValues {
  projectIds: readonly string[];
  agentRefs: readonly string[];
  states: readonly ChatListState[];
  tags: readonly string[];
}

export interface ChatsFilterSetters {
  onProjectIdsChange: (next: string[]) => void;
  onAgentRefsChange: (next: string[]) => void;
  onStatesChange: (next: ChatListState[]) => void;
  onTagsChange: (next: string[]) => void;
}

/**
 * The single "Filters" chip FilterBar shows below ~1024px of bar width (D-56):
 * every group from the four chips above, stacked in one popup, so a 1100px
 * window keeps every filter reachable.
 */
export function FiltersCollapsedChip({
  projectIds,
  agentRefs,
  states,
  tags,
  onProjectIdsChange,
  onAgentRefsChange,
  onStatesChange,
  onTagsChange,
}: ChatsFilterValues & ChatsFilterSetters) {
  const { data: projects } = useProjects();
  const { data: agents } = useAgents();
  const [tagDraft, setTagDraft] = useState('');
  const activeCount = projectIds.length + agentRefs.length + states.length + tags.length;
  const addTag = () => {
    const tag = tagDraft.trim();
    if (tag && !tags.includes(tag)) onTagsChange([...tags, tag]);
    setTagDraft('');
  };
  return (
    <Menu.Root>
      <Menu.Trigger render={<Chip dropdown>{activeCount > 0 ? `Filters (${activeCount})` : 'Filters'}</Chip>} />
      <Menu.Popup className="w-64">
        <Menu.Group>
          <Menu.GroupLabel>Project</Menu.GroupLabel>
          {(projects ?? []).map((project) => (
            <Menu.CheckboxItem
              key={project.id}
              checked={projectIds.includes(project.id)}
              onCheckedChange={() => onProjectIdsChange(toggle(projectIds, project.id))}
            >
              {project.name}
            </Menu.CheckboxItem>
          ))}
        </Menu.Group>
        <Menu.Separator />
        <Menu.Group>
          <Menu.GroupLabel>Agent</Menu.GroupLabel>
          {(agents ?? []).map((agent) => (
            <Menu.CheckboxItem
              key={agent.ref}
              checked={agentRefs.includes(agent.ref)}
              onCheckedChange={() => onAgentRefsChange(toggle(agentRefs, agent.ref))}
            >
              {agent.name}
            </Menu.CheckboxItem>
          ))}
        </Menu.Group>
        <Menu.Separator />
        <Menu.Group>
          <Menu.GroupLabel>Status</Menu.GroupLabel>
          {STATE_OPTIONS.map((state) => (
            <Menu.CheckboxItem
              key={state}
              checked={states.includes(state)}
              onCheckedChange={() => onStatesChange(toggle(states, state))}
            >
              {STATE_LABELS[state]}
            </Menu.CheckboxItem>
          ))}
        </Menu.Group>
        <Menu.Separator />
        <Menu.Group>
          <Menu.GroupLabel>Tags</Menu.GroupLabel>
          <div className="p-1">
            <Input
              size="sm"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addTag();
              }}
              placeholder="Add tag and press ↵"
              aria-label="Add a tag filter"
            />
          </div>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1 px-1 pb-1">
              {tags.map((tag) => (
                <Chip key={tag} size="sm" onRemove={() => onTagsChange(tags.filter((t) => t !== tag))}>
                  {tag}
                </Chip>
              ))}
            </div>
          ) : null}
        </Menu.Group>
      </Menu.Popup>
    </Menu.Root>
  );
}

const SORT_LABELS: Record<ChatListSort, string> = { activity: 'Last activity', created: 'Date created', name: 'Name' };
const SORT_OPTIONS: readonly ChatListSort[] = ['activity', 'created', 'name'];

export interface SortChipProps {
  value: ChatListSort;
  onChange: (next: ChatListSort) => void;
}

/** Sort chip: Last activity (default) / Date created / Name. */
export function SortChip({ value, onChange }: SortChipProps) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Chip dropdown icon="sort">
            {SORT_LABELS[value]}
          </Chip>
        }
      />
      <Menu.Popup align="end">
        <Menu.RadioGroup value={value} onValueChange={(next) => onChange(next as ChatListSort)}>
          {SORT_OPTIONS.map((sort) => (
            <Menu.RadioItem key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Popup>
    </Menu.Root>
  );
}
