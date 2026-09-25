// ────────────────────────────────────────────────────────────────
// SessionSpecEditor — one editor for an agent session (P02 WP-2.11, PD-19).
//
// A chat, a workflow and a stage are all described by a `SessionSpec`, and
// the server builds all three with one SessionComposer, so they are edited
// with one control set: model, provider, reasoning effort, context tier,
// agent + overrides, default agent mode, permission mode, skills, MCP
// servers and the platform toggles (browser, computer use, widgets). The
// capability warnings under it are the composer's own rules (the shared
// provider-levels table), shown before the run instead of after it.
//
// The host owns the layout: it asks for the `sections` it wants where it
// wants them (the stage panel spreads them over its collapsible sections).
// `onChange` has patch semantics — a key set to undefined is removed.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';
import {
  AGENT_MODES,
  HARNESS_PROVIDER_IDS,
  REASONING_EFFORTS,
  RUN_PERMISSION_MODES,
  resolveSessionSpec,
  type SessionSpec,
} from '@generatorai/workflow-spec';
import { sessionCapabilityWarnings, type Agent } from '@generatorai/shared';
import { Select, ToggleSwitch } from '@/components/ui/index.js';
import { ModelPicker, providerLabel } from '@/components/shared/ModelPicker.js';
import { useModels } from '@/hooks/queries.js';
import { cn } from '@/lib/utils.js';
import { AgentBindingSection } from './AgentBindingSection.js';
import { SkillSelector } from './SkillSelector.js';
import { McpServerSelector } from './McpServerSelector.js';

export type SessionSpecSection = 'runtime' | 'mode' | 'agent' | 'skills' | 'mcp' | 'platform' | 'warnings';

export const ALL_SESSION_SECTIONS: readonly SessionSpecSection[] = [
  'runtime',
  'mode',
  'agent',
  'skills',
  'mcp',
  'platform',
  'warnings',
];

export interface SessionSpecEditorProps {
  /** The (partial) session being edited. */
  value: SessionSpec | undefined;
  /** Patch semantics: a key set to undefined is removed. */
  onChange: (updates: Partial<SessionSpec>) => void;
  /** Where the session binds: decides defaults, labels and which toggles exist. */
  scope: 'chat' | 'workflow' | 'stage';
  projectId?: string | undefined;
  /** The session this one is merged over (a stage's workflow session). */
  inherited?: SessionSpec | undefined;
  sections?: readonly SessionSpecSection[];
  /** A chat reacts to the picked agent's role (orchestrator). */
  onAgentChange?: (agent: Agent | undefined) => void;
  className?: string;
}

const EFFORT_LABEL = (e: string) => e[0]!.toUpperCase() + e.slice(1);

const PERMISSION_LABELS: Record<(typeof RUN_PERMISSION_MODES)[number], string> = {
  default: 'Ask before tools run',
  acceptEdits: 'Accept edits, ask for the rest',
  plan: 'Plan only (no changes)',
  bypassPermissions: 'Full access (never ask)',
};

/** Merge a patch into a session with the editor's removal rule. */
export function applySessionPatch(session: SessionSpec | undefined, updates: Partial<SessionSpec>): SessionSpec {
  const next: Record<string, unknown> = { ...(session ?? {}), ...updates };
  for (const [k, v] of Object.entries(updates)) if (v === undefined) delete next[k];
  return next as SessionSpec;
}

export function SessionSpecEditor({
  value,
  onChange,
  scope,
  projectId,
  inherited,
  sections = ALL_SESSION_SECTIONS,
  onAgentChange,
  className,
}: SessionSpecEditorProps) {
  const session = value ?? {};
  const has = (s: SessionSpecSection) => sections.includes(s);
  const inheritsLabel = scope === 'stage' ? 'Workflow default' : scope === 'workflow' ? 'Provider default' : 'Default';
  const { data: models } = useModels();

  // The session the composer will see: a stage over its workflow session.
  const effective = useMemo(
    (): SessionSpec => (inherited ? resolveSessionSpec(inherited, value) : (value ?? {})),
    [inherited, value],
  );
  const provider =
    effective.harnessType ?? (effective.model ? models?.find((m) => m.id === effective.model)?.provider : undefined);
  const warnings = useMemo(
    () =>
      sessionCapabilityWarnings({
        ...(provider ? { provider } : {}),
        ...(effective.permissionMode ? { permissionMode: effective.permissionMode } : {}),
        wantsSkills:
          !!effective.agentRef ||
          (effective.agentOverrides?.addSkillIds?.length ?? 0) > 0 ||
          (effective.skills?.directories?.length ?? 0) > 0,
        wantsHostTools:
          effective.browser?.enabled !== false || effective.widgets !== false || effective.computerUse === true,
        computerUse: effective.computerUse === true,
      }),
    [effective, provider],
  );

  const setBrowserEnabled = (enabled: boolean | undefined) => {
    const next = { ...(session.browser ?? {}) };
    if (enabled === undefined) delete next.enabled;
    else next.enabled = enabled;
    onChange({ browser: Object.keys(next).length > 0 ? next : undefined });
  };

  return (
    <div className={cn('space-y-3', className)} data-testid={`session-spec-editor-${scope}`}>
      {has('runtime') && (
        <>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Model</label>
            <ModelPicker
              value={session.model ?? ''}
              onChange={(v) => onChange({ model: v || undefined })}
              allowEmpty
              emptyLabel={inheritsLabel}
              emptyDescription={scope === 'stage' ? 'Inherit from workflow settings' : 'Use the provider or agent default'}
              placeholder="Select a model…"
              ariaLabel={`${scope} model`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Provider</label>
              <Select
                aria-label={`${scope} provider`}
                value={session.harnessType ?? ''}
                onChange={(v) => onChange({ harnessType: (v || undefined) as SessionSpec['harnessType'] })}
                options={[
                  { value: '', label: scope === 'stage' ? 'Workflow default' : 'Route by model' },
                  ...HARNESS_PROVIDER_IDS.map((id) => ({ value: id, label: providerLabel(id) })),
                ]}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Reasoning Effort</label>
              <Select
                aria-label={`${scope} reasoning effort`}
                value={session.reasoningEffort ?? ''}
                onChange={(v) => onChange({ reasoningEffort: (v || undefined) as SessionSpec['reasoningEffort'] })}
                options={[
                  { value: '', label: inheritsLabel },
                  ...REASONING_EFFORTS.map((e) => ({ value: e, label: EFFORT_LABEL(e) })),
                ]}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Context</label>
              <Select
                aria-label={`${scope} context tier`}
                value={session.contextTier ?? ''}
                onChange={(v) => onChange({ contextTier: (v || undefined) as SessionSpec['contextTier'] })}
                options={[
                  { value: '', label: inheritsLabel },
                  { value: 'default', label: 'Standard window' },
                  { value: 'long_context', label: 'Long context' },
                ]}
              />
            </div>
          </div>
        </>
      )}

      {has('mode') && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Agent Mode</label>
            <Select
              aria-label={`${scope} agent mode`}
              value={session.defaultAgentMode ?? ''}
              onChange={(v) => onChange({ defaultAgentMode: (v || undefined) as SessionSpec['defaultAgentMode'] })}
              options={[
                { value: '', label: inheritsLabel },
                ...AGENT_MODES.map((m) => ({ value: m, label: m === 'plan' ? 'Plan' : 'Auto' })),
              ]}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Permissions</label>
            <Select
              aria-label={`${scope} permission mode`}
              value={session.permissionMode ?? ''}
              onChange={(v) => onChange({ permissionMode: (v || undefined) as SessionSpec['permissionMode'] })}
              options={[
                {
                  value: '',
                  label: scope === 'chat' ? 'Default' : scope === 'stage' ? 'Workflow default' : 'Run default',
                },
                ...RUN_PERMISSION_MODES.map((m) => ({ value: m, label: PERMISSION_LABELS[m] })),
              ]}
            />
          </div>
        </div>
      )}

      {has('agent') && (
        <AgentBindingSection
          session={value}
          onChange={onChange}
          projectId={projectId}
          scope={scope === 'chat' ? 'chat' : 'stage'}
          testIdPrefix={scope}
          {...(onAgentChange ? { onAgentChange } : {})}
        />
      )}

      {has('skills') && <SkillSelector session={value} onChange={onChange} projectId={projectId} />}

      {has('mcp') && <McpServerSelector session={value} onChange={onChange} projectId={projectId} />}

      {has('platform') && (
        <div className="space-y-2.5">
          <ToggleSwitch
            label="Integrated browser"
            description="Browser tools for this session"
            checked={effective.browser?.enabled !== false}
            onChange={(on) => setBrowserEnabled(on ? undefined : false)}
          />
          {scope !== 'chat' && (
            <>
              <ToggleSwitch
                label="Computer use"
                description="Desktop control; opt-in, never on a bypass run"
                checked={effective.computerUse === true}
                onChange={(on) => onChange({ computerUse: on ? true : undefined })}
              />
              <ToggleSwitch
                label="Widgets"
                description="Interactive widgets in the transcript"
                checked={effective.widgets !== false}
                onChange={(on) => onChange({ widgets: on ? undefined : false })}
              />
            </>
          )}
        </div>
      )}

      {has('warnings') && warnings.length > 0 && (
        <ul className="space-y-1.5" aria-label="Session capability warnings" data-testid={`session-warnings-${scope}`}>
          {warnings.map((w) => (
            <li
              key={w.code}
              className={cn(
                'flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] leading-snug',
                w.severity === 'error' ? 'bg-danger-muted text-danger' : 'bg-warning-muted text-warning',
              )}
            >
              {w.severity === 'error' ? (
                <XCircle className="mt-px h-3 w-3 shrink-0" />
              ) : (
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              )}
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
