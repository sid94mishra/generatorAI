// ────────────────────────────────────────────────────────────────
// SessionSpecEditor — one editor for an agent session (P02 WP-2.11), on
// the kit. A workflow and a stage are both described by a `SessionSpec`
// and the server builds both with one SessionComposer, so they are edited
// with one control set: model, reasoning effort, context window, provider,
// max turns, agent mode, permission mode, the agent + overrides, skills,
// MCP servers and the platform toggles. The capability warnings are the
// composer's own rules, shown before the run instead of after it.
//
// The host owns the layout: it asks for the `sections` it wants where it
// wants them. `runtime`, `mode`, `agent` and `warnings` render bare rows
// (the host titles them); `skills`, `mcp` and `platform` render titled
// inspector sections (count + Select all). `onChange` has patch semantics:
// a key set to undefined is removed (apply with model/sessionPatch.ts).
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import {
  AGENT_MODES,
  REASONING_EFFORTS,
  RUN_PERMISSION_MODES,
  type SessionSpec,
} from '@generatorai/workflow-spec';
import { sessionCapabilityWarnings, type Agent } from '@generatorai/shared';
import { reasoningEffortLabel } from '@generatorai/shared/ui-contract';
import { useModels } from '@/hooks/harnessQueries.js';
import { ProviderSelect } from '@/blocks/provider-select/index.js';
import { ModelPicker } from '@/blocks/model-picker/ModelPicker.js';
import { cn } from '@/ui/lib/cn.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { InspectorSection } from '../../../fields/InspectorLayout.js';
import { Row } from '../Row.js';
import { AgentBindingSection } from './AgentBindingSection.js';
import { McpSection, PlatformToolsSection, SkillsSection } from './ToolSections.js';
import {
  ALL_SESSION_SECTIONS,
  effectiveSession,
  inheritsLabel,
  useBoundAgent,
  useSessionCatalog,
  type SessionScope,
  type SessionSpecSection,
} from './sessionModel.js';

export interface SessionSpecEditorProps {
  /** The (partial) session being edited. */
  value: SessionSpec | undefined;
  /** Patch semantics: a key set to undefined is removed. */
  onChange: (updates: Partial<SessionSpec>) => void;
  /** Where the session binds: decides defaults, labels and which toggles exist. */
  scope: SessionScope;
  projectId?: string | undefined;
  /** The session this one is merged over (a stage's workflow session). */
  inherited?: SessionSpec | undefined;
  sections?: readonly SessionSpecSection[];
  /**
   * Title the agent binding ("Agent · optional") and the runtime group
   * ("Model · agent, then … default") as inspector sections, so one editor
   * instance can render a whole tab.
   */
  headings?: boolean;
  /** A chat reacts to the picked agent's role (orchestrator). */
  onAgentChange?: (agent: Agent | undefined) => void;
  className?: string;
}


const PERMISSION_LABELS: Record<(typeof RUN_PERMISSION_MODES)[number], string> = {
  default: 'Ask before tools run',
  acceptEdits: 'Accept edits, ask for the rest',
  plan: 'Plan only (no changes)',
  bypassPermissions: 'Full access (never ask)',
};

/** Sentinel of a segmented "inherit" choice (a radio value cannot be empty). */
const INHERIT = 'inherit';

export function SessionSpecEditor({
  value,
  onChange,
  scope,
  projectId,
  inherited,
  sections = ALL_SESSION_SECTIONS,
  headings = false,
  onAgentChange,
  className,
}: SessionSpecEditorProps) {
  const session = value ?? {};
  const has = (s: SessionSpecSection) => sections.includes(s);
  const inherits = inheritsLabel(scope);
  const { data: models } = useModels();
  const effective = useMemo(() => effectiveSession(value, inherited), [inherited, value]);
  const catalog = useSessionCatalog(projectId);
  const agent = useBoundAgent(effective.agentRef, projectId);

  const provider = effective.harnessType ?? (effective.model ? models?.find((m) => m.id === effective.model)?.provider : undefined);
  const warnings = useMemo(
    () =>
      sessionCapabilityWarnings({
        ...(provider ? { provider } : {}),
        ...(effective.permissionMode ? { permissionMode: effective.permissionMode } : {}),
        wantsSkills:
          !!effective.agentRef || (effective.agentOverrides?.addSkillIds?.length ?? 0) > 0 || (effective.skills?.directories?.length ?? 0) > 0,
        wantsHostTools: effective.browser?.enabled !== false || effective.widgets !== false || effective.computerUse === true,
        computerUse: effective.computerUse === true,
      }),
    [effective, provider],
  );

  const agentPart = has('agent') ? (
    <AgentBindingSection
      session={value}
      onChange={onChange}
      projectId={projectId}
      scope={scope === 'chat' ? 'chat' : 'stage'}
      testIdPrefix={scope}
      {...(onAgentChange ? { onAgentChange } : {})}
    />
  ) : null;

  const modelPart =
    has('runtime') || has('mode') || (has('warnings') && warnings.length > 0) ? (
      <>
        {has('runtime') ? (
          <>
            <Row label="Model" hint={session.model ? undefined : scope === 'stage' ? 'Empty: the agent’s model, then the workflow default.' : 'Empty: the agent’s model, then the provider default.'}>
              <div className="flex min-w-0 items-center gap-1">
                <div className="min-w-0 flex-1">
                  <ModelPicker
                    variant="field"
                    value={session.model ?? ''}
                    onChange={(v) => onChange({ model: v || undefined })}
                    ariaLabel={`${scope} model`}
                    placeholder={inherits}
                  />
                </div>
                {session.model ? <IconButton icon="x" size="sm" label={`Clear ${scope} model`} onClick={() => onChange({ model: undefined })} /> : null}
              </div>
            </Row>
            <Row label="Reasoning effort">
              <Select
                size="sm"
                aria-label={`${scope} reasoning effort`}
                value={session.reasoningEffort ?? ''}
                onValueChange={(v) => onChange({ reasoningEffort: (v || undefined) as SessionSpec['reasoningEffort'] })}
                items={[{ value: '', label: inherits }, ...REASONING_EFFORTS.map((e) => ({ value: e, label: reasoningEffortLabel(e) }))]}
              />
            </Row>
            <Row label="Context window">
              <SegmentedControl
                label={`${scope} context tier`}
                value={session.contextTier ?? INHERIT}
                onValueChange={(v) => onChange({ contextTier: v === INHERIT ? undefined : (v as SessionSpec['contextTier']) })}
                items={[
                  { value: INHERIT, label: scope === 'stage' ? 'Inherit' : 'Default' },
                  { value: 'default', label: 'Standard' },
                  { value: 'long_context', label: 'Long' },
                ]}
              />
            </Row>
            <Row label="Provider">
              <ProviderSelect
                size="sm"
                aria-label={`${scope} provider`}
                emptyLabel={scope === 'stage' ? 'Workflow default' : 'Route by model'}
                value={session.harnessType ?? ''}
                onChange={(v) => onChange({ harnessType: (v || undefined) as SessionSpec['harnessType'] })}
              />
            </Row>
            <Row label="Max turns" hint="Turn cap per prompt; empty inherits.">
              <NumberField
                size="sm"
                className="w-32"
                aria-label={`${scope} max turns`}
                value={session.maxTurns ?? null}
                onValueChange={(v) => onChange({ maxTurns: v && v > 0 ? Math.min(1000, Math.round(v)) : undefined })}
                min={0}
                max={1000}
              />
            </Row>
          </>
        ) : null}

        {has('mode') ? (
          <>
            <Row label="Agent mode" hint="Plan waits for approval before it acts.">
              <SegmentedControl
                label={`${scope} agent mode`}
                value={session.defaultAgentMode ?? INHERIT}
                onValueChange={(v) => onChange({ defaultAgentMode: v === INHERIT ? undefined : (v as SessionSpec['defaultAgentMode']) })}
                items={[
                  { value: INHERIT, label: scope === 'stage' ? 'Inherit' : 'Default' },
                  ...AGENT_MODES.map((m) => ({ value: m, label: m === 'plan' ? 'Plan' : 'Auto' })),
                ]}
              />
            </Row>
            <Row label="Permission">
              <Select
                size="sm"
                aria-label={`${scope} permission mode`}
                value={session.permissionMode ?? ''}
                onValueChange={(v) => onChange({ permissionMode: (v || undefined) as SessionSpec['permissionMode'] })}
                items={[
                  { value: '', label: scope === 'chat' ? 'Default' : scope === 'stage' ? 'Workflow default' : 'Run default' },
                  ...RUN_PERMISSION_MODES.map((m) => ({ value: m, label: PERMISSION_LABELS[m] })),
                ]}
              />
            </Row>
          </>
        ) : null}

        {has('warnings') && warnings.length > 0 ? (
          <ul className="flex flex-col gap-1.5" aria-label="Session capability warnings" data-testid={`session-warnings-${scope}`}>
            {warnings.map((w) => (
              <li key={w.code}>
                <Callout tone={w.severity === 'error' ? 'err' : 'warn'}>{w.message}</Callout>
              </li>
            ))}
          </ul>
        ) : null}
      </>
    ) : null;

  return (
    <div className={cn('flex flex-col gap-3', className)} data-testid={`session-spec-editor-${scope}`}>
      {headings && agentPart ? (
        <InspectorSection title="Agent" action={<span className="text-small text-fg-3">optional</span>}>
          {agentPart}
        </InspectorSection>
      ) : (
        agentPart
      )}
      {headings && modelPart ? (
        <InspectorSection
          title="Model"
          action={<span className="text-small text-fg-3">agent, then {scope === 'stage' ? 'workflow' : 'provider'} default</span>}
        >
          {modelPart}
        </InspectorSection>
      ) : (
        modelPart
      )}

      {has('skills') ? <SkillsSection session={value} onChange={onChange} catalog={catalog} agentSkillIds={agent?.skillIds} /> : null}
      {has('mcp') ? <McpSection session={value} onChange={onChange} catalog={catalog} agentMcpIds={agent?.mcpServerIds} /> : null}
      {has('platform') ? <PlatformToolsSection session={value} effective={effective} onChange={onChange} scope={scope} /> : null}
    </div>
  );
}
