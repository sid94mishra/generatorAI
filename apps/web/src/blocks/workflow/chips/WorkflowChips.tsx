// ────────────────────────────────────────────────────────────────
// Workflow kit chips (03-component-inventory-domain.md §4): WF-01
// VersionChip / DraftChip, WF-02 KeyChip, WF-20 TriggerChip. Props only —
// no workflow endpoint is called here (the pages feed them). Shared by the
// Workflows list, the definition page, the builder and the run page.
// ────────────────────────────────────────────────────────────────

import { Icon, type IconConcept } from '@/ui/icons/index.js';
import { cn } from '@/ui/lib/cn.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';

// ── WF-01 ─────────────────────────────────────────────────────

export interface VersionChipProps {
  status: 'draft' | 'published';
  /** Published version number ("v7"); omitted when the caller does not know it (D-36). */
  version?: number;
  /** Draft revision ("rev 13"). */
  revision?: number;
  className?: string;
}

/** "Published v7" (ok) or "Draft rev 13" (neutral); the numbers are mono. */
export function VersionChip({ status, version, revision, className }: VersionChipProps) {
  if (status === 'published') {
    return (
      <Badge tone="ok" suffix={version !== undefined ? `v${version}` : undefined} className={className}>
        Published
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" suffix={revision !== undefined ? `rev ${revision}` : undefined} className={className}>
      Draft
    </Badge>
  );
}

// ── WF-02 ─────────────────────────────────────────────────────

export interface KeyChipProps {
  stageKey: string;
  /** "· from name" hint (the key was derived from the stage name). */
  hint?: string;
  /** Outlined (inspector, lists) or borderless (tables). Default borderless. */
  outlined?: boolean;
  className?: string;
}

/** A stage key in mono (`assess_risk`). */
export function KeyChip({ stageKey, hint, outlined = false, className }: KeyChipProps) {
  return (
    <Chip mono size="sm" variant={outlined ? 'outline' : 'ghost'} className={className}>
      {stageKey}
      {hint ? <span className="text-fg-3">· {hint}</span> : null}
    </Chip>
  );
}

// ── WF-20 ─────────────────────────────────────────────────────

/** What started a run (`WorkflowRun.trigger.kind`); a run without a trigger was started by a person. */
export const RUN_TRIGGERS: ReadonlyArray<{ kind: string; label: string; filterLabel: string; icon: IconConcept }> = [
  { kind: 'user', label: 'Manual', filterLabel: 'A person', icon: 'user' },
  { kind: 'automation', label: 'Automation', filterLabel: 'An automation', icon: 'automations' },
  { kind: 'fork', label: 'Fork', filterLabel: 'A fork (re-run)', icon: 'retry' },
  { kind: 'stage', label: 'Parent workflow', filterLabel: 'A parent workflow', icon: 'workflows' },
  { kind: 'chat', label: 'Chat', filterLabel: 'A chat', icon: 'chats' },
  { kind: 'orchestrator', label: 'Orchestrator', filterLabel: 'An orchestrator', icon: 'agents' },
  { kind: 'external_agent', label: 'External agent', filterLabel: 'An external agent', icon: 'mcp' },
];

export interface TriggerChipProps {
  /** `trigger.kind`; undefined = a person. */
  kind: string | undefined;
  /** Glyph only (narrow rails); the word is the accessible name and tooltip. */
  iconOnly?: boolean;
  className?: string;
}

/** Glyph + word for what started a run: Manual / Automation / Fork / Chat … */
export function TriggerChip({ kind, iconOnly = false, className }: TriggerChipProps) {
  const known = RUN_TRIGGERS.find((t) => t.kind === (kind ?? 'user'));
  if (iconOnly) {
    const label = known?.label ?? kind ?? 'Manual';
    return (
      <span role="img" aria-label={label} title={label} className={cn('inline-flex text-fg-3', className)}>
        <Icon concept={known?.icon ?? 'zap'} size={14} />
      </span>
    );
  }
  return (
    <Chip variant="ghost" size="sm" icon={known?.icon ?? 'zap'} className={className}>
      {known?.label ?? kind}
    </Chip>
  );
}
