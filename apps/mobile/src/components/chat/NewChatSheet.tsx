// ────────────────────────────────────────────────────────────────
// New chat (v2).
//
// The web flow spreads creation options across a dialog plus the composer.
// Here it is a single sheet with progressive disclosure: the one required
// field is at the top, sensible defaults are shown as rows, and "More
// options" reveals the rest. That keeps the common case to two taps without
// removing anything web's `CreateChatDialog` offers:
//
//   model · project · agent (+ capability overrides with a live effective-
//   capabilities preview) · sources (codebase, in-place / worktree, branch
//   current / existing / new + base, alias, primary) · tags · browser
//   visibility (+ eval, allowed hosts) · plan first · permissions ·
//   orchestrator
//
// Pickers push a page WITHIN the sheet rather than opening a second sheet —
// HIG is explicit that a sheet opening another sheet loses people.
//
// Scope honesty: mounting sources creates a workspace (`write:workspaces`);
// folder sources need a host path (`write:projects`, never grantable from a
// phone). Both are shown locked with the reason rather than hidden.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Cpu,
  Eye,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Lock,
  ShieldCheck,
  Tag,
  Trash2,
  Wand2,
} from 'lucide-react-native';
import type { AgentMode, AgentSummary, ModelInfo, ProjectSummary } from '@generatorai/client-core';
import type { ChatSourceControlOptions } from '@generatorai/shared';

import { Sheet, SheetRow, SheetSection } from '../ui/Sheet';
import { Button, IconButton } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Field, Switch } from '../ui/Form';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Spinner } from '../ui/States';
import { Touchable } from '../ui/Touchable';
import { useApi } from '../../api/useApi';
import { useAuth } from '../../auth/AuthProvider';
import { checkFeature } from '../../auth/featureGate';
import { useModelGroups } from '../../api/useModels';
import { useTheme } from '../../theme/ThemeProvider';
import { PERMISSION_MODES } from './composer/turnOptions';
import {
  BROWSER_VISIBILITY_OPTIONS,
  DEFAULT_BROWSER_PICKER_VALUE,
  browserSummary,
  type BrowserPickerValue,
} from './composer/browserConfig';
import {
  NO_SOURCE_CONTROL,
  addTag,
  buildCreateChatBody,
  isEmptyOverrides,
  overrideIncludes,
  sourceControlSummary,
  toggleOverrideId,
  type AgentOverrides,
  type CreateChatBody,
} from './composer/newChatModel';
import {
  defaultNewBranch,
  describeDraft,
  draftFromCodebase,
  sanitizeAlias,
  sourcesSummary,
  uniqueAlias,
  validateDrafts,
  type BranchMode,
  type DraftSource,
  type SourceMode,
} from './composer/sourceModel';

/**
 * What `onCreate` receives: the wire body for `POST /api/chats`, a
 * superset of client-core's `chats.create` input (which predates
 * `sources` / `browserConfig` / `agentOverrides`). Passing it straight to
 * `api.chats.create(values)` is correct.
 */
export type NewChatValues = CreateChatBody;

type Page =
  | 'main'
  | 'model'
  | 'project'
  | 'permission'
  | 'agent'
  | 'capabilities'
  | 'sources'
  | 'source'
  | 'tags'
  | 'browser'
  | 'source-control';

const PAGE_TITLES: Record<Page, string> = {
  main: 'New chat',
  model: 'Model',
  project: 'Project',
  permission: 'Permissions',
  agent: 'Agent',
  capabilities: 'Capabilities',
  sources: 'Sources',
  source: 'Source',
  tags: 'Tags',
  browser: 'Browser',
  'source-control': 'Source control',
};

interface Projection {
  driving?: { name: string; role?: string } | null;
  skills?: { names?: string[]; ids?: string[] };
  mcpServers?: Record<string, unknown>;
  warnings?: Array<{ message?: string; code?: string } | string>;
}

/**
 * The stand-in title for a chat created without one.
 *
 * Deliberately a real, sortable name rather than "Untitled": the catalogue
 * shows a preview of the conversation underneath, so the title only has to
 * disambiguate two chats started on the same day.
 */
function defaultChatName(): string {
  const now = new Date();
  return `Chat ${now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${now
    .toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    .replace(/\s/g, '')}`;
}

export function NewChatSheet({
  visible,
  onClose,
  onCreate,
  creating,
  error,
  models,
  projects,
  agents,
  scopes,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (values: NewChatValues) => void;
  creating: boolean;
  error?: string | null;
  models: ModelInfo[] | undefined;
  projects: ProjectSummary[] | undefined;
  agents?: AgentSummary[] | undefined;
  /** Granted scopes. Omit to treat every option as available (v1 callers). */
  scopes?: readonly string[] | undefined;
}): React.ReactElement {
  const { colors } = useTheme();
  const api = useApi();
  const { fetch: authedFetch } = useAuth();
  const [page, setPage] = useState<Page>('main');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>('auto');
  const [permissionMode, setPermissionMode] = useState('default');
  const [orchestrator, setOrchestrator] = useState(false);
  const [agentRef, setAgentRef] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<AgentOverrides>({});
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [drafts, setDrafts] = useState<DraftSource[]>([]);
  const [primaryAlias, setPrimaryAlias] = useState<string | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [browser, setBrowser] = useState<BrowserPickerValue>(DEFAULT_BROWSER_PICKER_VALUE);
  const [sourceControl, setSourceControl] = useState<ChatSourceControlOptions>(NO_SOURCE_CONTROL);
  const [expanded, setExpanded] = useState(false);

  // `write:workspaces` has no entry in FEATURE_REQUIREMENTS yet, so it is
  // checked directly; `projectEdit` (folder sources) goes through the gate.
  const sourcesAllowed = scopes ? scopes.includes('write:workspaces') : true;
  const sourcesReason =
    'Mounting a codebase creates a workspace on your machine, which needs workspace-write permission.';
  // Folder sources name a path on the host, which a phone cannot browse —
  // structurally unavailable, whatever the device's scopes.
  const projectEdit = scopes ? checkFeature('codebaseLinkLocal', scopes) : null;

  const groups = useModelGroups(models);
  const selectedModel = useMemo(() => models?.find((m) => m.id === model), [models, model]);
  const selectedProject = useMemo(
    () => projects?.find((p) => p.id === projectId),
    [projects, projectId],
  );
  const selectableAgents = useMemo(() => (agents ?? []).filter((a) => a.enabled), [agents]);
  const selectedAgent = useMemo(
    () => selectableAgents.find((a) => a.ref === agentRef),
    [selectableAgents, agentRef],
  );

  // ── Data the pages need, loaded only once the page is reached ──
  const codebases = useQuery({
    queryKey: ['projects', projectId ?? '', 'codebases'],
    queryFn: () => api.projects.codebases(projectId!),
    enabled: visible && Boolean(projectId) && (page === 'sources' || page === 'source'),
    staleTime: 60_000,
  });
  const skills = useQuery({
    queryKey: ['system', 'artifacts', 'skill'],
    queryFn: () => api.system.artifacts('skill'),
    enabled: visible && page === 'capabilities',
    staleTime: 60_000,
  });
  const mcpServers = useQuery({
    queryKey: ['system', 'mcp-servers'],
    queryFn: () => api.system.mcpServers(),
    enabled: visible && page === 'capabilities',
    staleTime: 60_000,
  });

  // Effective-capabilities preview (web: debounced resolve-preview).
  const [projection, setProjection] = useState<Projection | undefined>(undefined);
  const [previewBusy, setPreviewBusy] = useState(false);
  const overridesKey = JSON.stringify(overrides);
  useEffect(() => {
    if (!visible) return;
    if (!agentRef && overridesKey === '{}') {
      setProjection(undefined);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewBusy(true);
      void authedFetch('/api/agents/resolve-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'chat',
          ...(agentRef ? { agentRef } : {}),
          ...(projectId ? { projectId } : {}),
          overrides: JSON.parse(overridesKey) as AgentOverrides,
        }),
      })
        .then(async (res) => (res.ok ? ((await res.json()) as Projection) : undefined))
        .then((p) => {
          if (!cancelled) setProjection(p);
        })
        .catch(() => {
          if (!cancelled) setProjection(undefined);
        })
        .finally(() => {
          if (!cancelled) setPreviewBusy(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, agentRef, overridesKey, projectId, authedFetch]);

  const reset = (): void => {
    setPage('main');
    setName('');
    setDescription('');
    setModel(null);
    setProjectId(null);
    setAgentMode('auto');
    setPermissionMode('default');
    setOrchestrator(false);
    setAgentRef(null);
    setOverrides({});
    setTags([]);
    setTagInput('');
    setDrafts([]);
    setPrimaryAlias(undefined);
    setEditingId(null);
    setBrowser(DEFAULT_BROWSER_PICKER_VALUE);
    setSourceControl(NO_SOURCE_CONTROL);
    setExpanded(false);
  };

  const close = (): void => {
    reset();
    onClose();
  };

  const sourceError = validateDrafts(drafts);
  // The name is OPTIONAL. Naming a conversation before having it is a
  // desktop habit; on a phone the flow has to be open, type, send. An unnamed
  // chat gets a date-stamped placeholder that the first prompt replaces.
  const canCreate = sourceError === null;

  const submit = (): void => {
    onCreate(
      buildCreateChatBody({
        name: name.trim() || defaultChatName(),
        description,
        ...(model ? { model } : {}),
        ...(projectId ? { projectId } : {}),
        defaultAgentMode: agentMode,
        permissionMode,
        orchestratorMode: orchestrator,
        ...(agentRef ? { agentRef } : {}),
        agentOverrides: overrides,
        tags,
        sources: drafts,
        ...(primaryAlias ? { primaryAlias } : {}),
        browser,
        sourceControl,
      }),
    );
  };

  const editing = drafts.find((d) => d.id === editingId) ?? null;
  const updateDraft = (id: string, patch: Partial<DraftSource>): void =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const back = (): void => setPage(page === 'source' ? 'sources' : page === 'capabilities' ? 'agent' : 'main');

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={PAGE_TITLES[page]}
      footer={page === 'main' ? (
        <Button
          label="Create chat"
          full
          size="lg"
          loading={creating}
          disabled={!canCreate}
          onPress={submit}
        />
      ) : undefined}
      // Sized to its content, capped at 0.92. The fixed detent left roughly
      // 300pt of empty sheet under "Create chat" on the first page, and the
      // sheet grows on its own when "More options" or a sub-page opens.
      detents={[0.92]}
      fitContent
      leading={
        page === 'main' ? undefined : (
          <IconButton
            accessibilityLabel="Back"
            icon={<ChevronLeft size={22} color={colors.foreground} />}
            onPress={back}
          />
        )
      }
    >
      {page === 'model' ? (
        groups.map((group) => (
          <View key={group.provider}>
            <SheetSection title={group.label} />
            {group.models.map((entry) => (
              <SheetRow
                key={entry.id}
                title={entry.name}
                subtitle={entry.description ?? null}
                selected={entry.id === model}
                onPress={() => {
                  setModel(entry.id);
                  setPage('main');
                }}
              />
            ))}
          </View>
        ))
      ) : page === 'project' ? (
        <>
          <SheetRow
            title="No project"
            subtitle="The chat gets a scratch workspace of its own."
            selected={projectId === null}
            onPress={() => {
              setProjectId(null);
              setDrafts([]);
              setPrimaryAlias(undefined);
              setPage('main');
            }}
          />
          {(projects ?? []).map((project) => (
            <SheetRow
              key={project.id}
              title={project.name}
              subtitle={project.description ?? null}
              selected={project.id === projectId}
              onPress={() => {
                if (project.id !== projectId) {
                  setDrafts([]);
                  setPrimaryAlias(undefined);
                }
                setProjectId(project.id);
                setPage('main');
              }}
            />
          ))}
        </>
      ) : page === 'permission' ? (
        PERMISSION_MODES.map((option) => (
          <SheetRow
            key={option.value}
            title={option.title}
            subtitle={option.help}
            selected={permissionMode === option.value}
            onPress={() => {
              setPermissionMode(option.value);
              setPage('main');
            }}
          />
        ))
      ) : page === 'agent' ? (
        <>
          <SheetRow
            title="No agent"
            subtitle="Use the platform default instructions and capabilities."
            selected={agentRef === null}
            onPress={() => {
              setAgentRef(null);
              setOverrides({});
              setPage('main');
            }}
          />
          {selectableAgents.map((entry) => (
            <SheetRow
              key={entry.ref}
              title={entry.name}
              subtitle={`${entry.description} — ${entry.skillIds.length} skills, ${entry.mcpServerIds.length} MCP`}
              selected={entry.ref === agentRef}
              onPress={() => {
                if (entry.ref !== agentRef) setOverrides({});
                setAgentRef(entry.ref);
                // An orchestrator agent IS the orchestrator; keep the toggle
                // from contradicting the chosen agent.
                if (entry.role === 'orchestrator') setOrchestrator(true);
                setPage('main');
              }}
            />
          ))}
          <View className="px-4 pb-6 pt-3">
            <Button
              label={isEmptyOverrides(overrides) ? 'Customize capabilities' : 'Edit capabilities'}
              variant="secondary"
              full
              icon={<Bot size={16} color={colors.foreground} />}
              onPress={() => setPage('capabilities')}
            />
          </View>
        </>
      ) : page === 'capabilities' ? (
        <CapabilitiesPage
          agent={selectedAgent}
          overrides={overrides}
          onOverridesChange={setOverrides}
          skills={skills.data?.map((s) => ({ id: s.id, name: s.name })) ?? []}
          mcp={(mcpServers.data ?? []).map((m) => ({ id: m.id ?? m.name, name: m.name }))}
          loading={skills.isLoading || mcpServers.isLoading}
          projection={projection}
          previewBusy={previewBusy}
        />
      ) : page === 'sources' ? (
        <SourcesPage
          allowed={sourcesAllowed}
          reason={sourcesReason}
          projectName={selectedProject?.name ?? null}
          drafts={drafts}
          chatName={name}
          primaryAlias={primaryAlias}
          onPrimaryChange={setPrimaryAlias}
          codebases={(codebases.data ?? []).map((c) => ({ id: c.id, alias: c.alias, ...(c.defaultBranch ? { defaultBranch: c.defaultBranch } : {}) }))}
          codebasesLoading={codebases.isLoading}
          folderReason={projectEdit && !projectEdit.available ? projectEdit.reason : null}
          onAdd={(cb) => {
            const draft = draftFromCodebase(cb, drafts.map((d) => d.alias));
            setDrafts((prev) => [...prev, draft]);
            setEditingId(draft.id);
            setPage('source');
          }}
          onEdit={(id) => {
            setEditingId(id);
            setPage('source');
          }}
          onRemove={(id) => {
            setDrafts((prev) => prev.filter((d) => d.id !== id));
            setPrimaryAlias((prev) => (drafts.find((d) => d.id === id)?.alias === prev ? undefined : prev));
          }}
          error={sourceError}
        />
      ) : page === 'source' && editing ? (
        <SourceEditPage
          draft={editing}
          chatName={name}
          otherAliases={drafts.filter((d) => d.id !== editing.id).map((d) => d.alias)}
          projectId={projectId}
          fetchBranches={async (cid) => {
            const res = await authedFetch(`/api/projects/${projectId}/codebases/${cid}/branches`);
            if (!res.ok) return [];
            const body = (await res.json()) as unknown;
            const list = Array.isArray(body) ? body : ((body as { branches?: unknown[] })?.branches ?? []);
            return list
              .map((b) => (typeof b === 'string' ? b : ((b as { name?: string })?.name ?? '')))
              .filter((b): b is string => Boolean(b));
          }}
          onChange={(patch) => updateDraft(editing.id, patch)}
          onRemove={() => {
            setDrafts((prev) => prev.filter((d) => d.id !== editing.id));
            if (primaryAlias === editing.alias) setPrimaryAlias(undefined);
            setEditingId(null);
            setPage('sources');
          }}
          onDone={() => setPage('sources')}
        />
      ) : page === 'tags' ? (
        <View className="gap-4 px-4 py-4">
          <View className="flex-row items-end gap-2">
            <View className="flex-1">
              <Field
                label="Add a tag"
                placeholder="e.g. bugfix"
                value={tagInput}
                onChangeText={setTagInput}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={() => {
                  setTags((prev) => addTag(prev, tagInput));
                  setTagInput('');
                }}
                accessibilityLabel="Tag"
              />
            </View>
            <Button
              label="Add"
              variant="secondary"
              disabled={!tagInput.trim() || tags.length >= 20}
              onPress={() => {
                setTags((prev) => addTag(prev, tagInput));
                setTagInput('');
              }}
            />
          </View>
          {tags.length > 0 ? (
            <View className="flex-row flex-wrap gap-2">
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  icon={<Tag size={12} color={colors.primary} />}
                  tone="accent"
                  size="sm"
                  onRemove={() => setTags((prev) => prev.filter((t) => t !== tag))}
                  removeLabel={`Remove tag ${tag}`}
                />
              ))}
            </View>
          ) : (
            <Text className="text-sm text-muted-foreground">
              Tags help you find this chat later. Up to 20.
            </Text>
          )}
        </View>
      ) : page === 'source-control' ? (
        <SourceControlPage value={sourceControl} onChange={setSourceControl} />
      ) : page === 'browser' ? (
        <>
          <SheetSection title="Visibility" />
          {BROWSER_VISIBILITY_OPTIONS.map((option) => (
            <SheetRow
              key={option.value}
              title={option.title}
              subtitle={option.help}
              selected={browser.visibility === option.value}
              onPress={() => setBrowser((prev) => ({ ...prev, visibility: option.value }))}
              left={<Eye size={18} color={colors['muted-foreground']} />}
            />
          ))}
          <SheetSection title="Permissions" />
          <View className="overflow-hidden rounded-3xl border border-border bg-card mx-4">
            <ToggleRow
              icon={<ShieldCheck size={18} color={colors['muted-foreground']} />}
              label="Allow page scripts (eval)"
              help="Lets the agent run JavaScript inside pages it opens."
              value={browser.evalAllowed === true}
              onChange={(on) => setBrowser((prev) => ({ ...prev, evalAllowed: on }))}
            />
          </View>
          <View className="px-4 pb-6 pt-4">
            <Field
              label="Allowed hosts"
              hint="Comma-separated. Empty means any host."
              placeholder="example.com, localhost"
              value={browser.allowedHostsCsv ?? ''}
              onChangeText={(text) => setBrowser((prev) => ({ ...prev, allowedHostsCsv: text }))}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Allowed hosts"
            />
          </View>
        </>
      ) : (
        <View className="gap-4 px-4 py-4">
          <Field
            label="Name (optional)"
            placeholder={defaultChatName()}
            value={name}
            onChangeText={setName}
            accessibilityLabel="Chat name, optional"
          />

          <View className="overflow-hidden rounded-3xl border border-border bg-card">
            <PickerRow
              icon={<Cpu size={18} color={colors['muted-foreground']} />}
              label="Model"
              value={selectedModel?.name ?? 'Server default'}
              onPress={() => setPage('model')}
            />
            <View className="ml-[46px] h-px bg-border-muted" />
            <PickerRow
              icon={<FolderGit2 size={18} color={colors['muted-foreground']} />}
              label="Project"
              value={selectedProject?.name ?? 'None'}
              onPress={() => setPage('project')}
            />
            <View className="ml-[46px] h-px bg-border-muted" />
            <PickerRow
              icon={<Bot size={18} color={colors['muted-foreground']} />}
              label="Agent"
              value={
                selectedAgent
                  ? isEmptyOverrides(overrides)
                    ? selectedAgent.name
                    : `${selectedAgent.name} · customized`
                  : 'None'
              }
              onPress={() => setPage('agent')}
            />
            <View className="ml-[46px] h-px bg-border-muted" />
            <PickerRow
              icon={
                sourcesAllowed ? (
                  <GitBranch size={18} color={colors['muted-foreground']} />
                ) : (
                  <Lock size={18} color={colors['muted-foreground']} />
                )
              }
              label="Sources"
              value={sourcesAllowed ? sourcesSummary(drafts) : 'Locked'}
              onPress={() => setPage('sources')}
            />
          </View>

          {projection?.skills?.names?.length || projection?.driving ? (
            <View className="flex-row flex-wrap gap-1.5" accessibilityLabel="Effective capabilities">
              {projection.driving ? (
                <Chip label={projection.driving.name} icon={<Bot size={12} color={colors.primary} />} tone="accent" size="sm" />
              ) : null}
              {(projection.skills?.names ?? []).slice(0, 6).map((s) => (
                <Chip key={s} label={s} size="sm" />
              ))}
              {(projection.skills?.names?.length ?? 0) > 6 ? (
                <Chip label={`+${(projection.skills?.names?.length ?? 0) - 6}`} size="sm" />
              ) : null}
            </View>
          ) : null}

          {/* A full-width 44pt row that says what it hides — the bare text link
              was a 20pt target that gave no hint of what was behind it. */}
          <Touchable
            accessibilityLabel={expanded ? 'Hide more options' : 'Show more options'}
            accessibilityState={{ expanded }}
            haptic="select"
            scale="none"
            onPress={() => setExpanded((v) => !v)}
            className="-my-1 min-h-11 flex-row items-center gap-2"
          >
            <View className="flex-1">
              <Text className="text-md font-medium text-primary">{expanded ? 'Fewer options' : 'More options'}</Text>
              {expanded ? null : (
                <Text numberOfLines={1} className="text-sm text-muted-foreground">
                  Plan first, permissions, orchestrator, tags, browser
                </Text>
              )}
            </View>
            {expanded ? (
              <ChevronDown size={18} color={colors.primary} />
            ) : (
              <ChevronRight size={18} color={colors.primary} />
            )}
          </Touchable>

          {expanded ? (
            <View className="gap-4">
              <Field
                label="Description"
                placeholder="Optional context for this chat"
                value={description}
                onChangeText={setDescription}
                multiline
                accessibilityLabel="Chat description"
              />

              <View className="overflow-hidden rounded-3xl border border-border bg-card">
                <ToggleRow
                  icon={<Wand2 size={18} color={colors['muted-foreground']} />}
                  label="Plan before acting"
                  help="Ask for a plan before editing. Plan review controls depend on the provider; Codex uses command approvals."
                  value={agentMode === 'plan'}
                  onChange={(on) => setAgentMode(on ? 'plan' : 'auto')}
                />
                <View className="ml-[46px] h-px bg-border-muted" />
                <PickerRow
                  icon={<ShieldCheck size={18} color={colors['muted-foreground']} />}
                  label="Permissions"
                  value={
                    PERMISSION_MODES.find((m) => m.value === permissionMode)?.title ?? 'Ask me'
                  }
                  onPress={() => setPage('permission')}
                />
                <View className="ml-[46px] h-px bg-border-muted" />
                <ToggleRow
                  icon={<Cpu size={18} color={colors['muted-foreground']} />}
                  label="Orchestrator mode"
                  help="Lets the agent delegate work to background sub-agents."
                  value={orchestrator}
                  onChange={setOrchestrator}
                />
                <View className="ml-[46px] h-px bg-border-muted" />
                <PickerRow
                  icon={<Tag size={18} color={colors['muted-foreground']} />}
                  label="Tags"
                  value={tags.length ? `${tags.length}` : 'None'}
                  onPress={() => setPage('tags')}
                />
                <View className="ml-[46px] h-px bg-border-muted" />
                <PickerRow
                  icon={<Eye size={18} color={colors['muted-foreground']} />}
                  label="Browser"
                  value={browserSummary(browser)}
                  onPress={() => setPage('browser')}
                />
                <View className="ml-[46px] h-px bg-border-muted" />
                <PickerRow
                  icon={<GitPullRequest size={18} color={colors['muted-foreground']} />}
                  label="Source control"
                  value={sourceControlSummary(sourceControl)}
                  onPress={() => setPage('source-control')}
                />
              </View>
            </View>
          ) : null}

          {sourceError ? <Text className="text-sm text-danger">{sourceError}</Text> : null}
          {error ? <Text className="text-sm text-danger">{error}</Text> : null}
        </View>
      )}
    </Sheet>
  );
}

// ── Pages ────────────────────────────────────────────────────────

function SourcesPage({
  allowed,
  reason,
  projectName,
  drafts,
  chatName,
  primaryAlias,
  onPrimaryChange,
  codebases,
  codebasesLoading,
  folderReason,
  onAdd,
  onEdit,
  onRemove,
  error,
}: {
  allowed: boolean;
  reason: string;
  projectName: string | null;
  drafts: DraftSource[];
  chatName: string;
  primaryAlias: string | undefined;
  onPrimaryChange: (alias: string | undefined) => void;
  codebases: Array<{ id: string; alias: string; defaultBranch?: string }>;
  codebasesLoading: boolean;
  folderReason: string | null;
  onAdd: (codebase: { id: string; alias: string; defaultBranch?: string }) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  error: string | null;
}): React.ReactElement {
  const { colors } = useTheme();

  if (!allowed) {
    return (
      <View className="items-center gap-3 px-6 py-10">
        <Lock size={24} color={colors['muted-foreground']} />
        <Text className="text-center text-md font-medium text-foreground">Sources are locked</Text>
        <Text className="text-center text-sm text-muted-foreground">{reason}</Text>
        <Text className="text-center text-xs text-muted-foreground">
          Request workspace access from Settings → Security & devices.
        </Text>
      </View>
    );
  }

  const added = new Set(drafts.map((d) => d.codebaseId));
  const available = codebases.filter((c) => !added.has(c.id));
  const effectivePrimary = primaryAlias ?? drafts[0]?.alias;

  return (
    <>
      {drafts.length > 0 ? (
        <>
          <SheetSection title="Mounted in this chat" />
          {drafts.map((d) => (
            <SheetRow
              key={d.id}
              title={d.name}
              subtitle={describeDraft(d, chatName)}
              selected={d.alias === effectivePrimary}
              onPress={() => onEdit(d.id)}
              left={<GitBranch size={18} color={colors['muted-foreground']} />}
              right={
                <View className="flex-row items-center gap-1">
                  <Touchable
                    accessibilityLabel={d.alias === effectivePrimary ? `${d.alias} is the primary mount` : `Make ${d.alias} the primary mount`}
                    haptic="select"
                    onPress={() => onPrimaryChange(d.alias)}
                    className={`h-7 justify-center rounded-lg px-2 ${d.alias === effectivePrimary ? 'bg-control-strong' : 'bg-control'}`}
                  >
                    <Text className={`text-xs font-medium ${d.alias === effectivePrimary ? 'text-primary' : 'text-muted-foreground'}`}>
                      {d.alias === effectivePrimary ? 'Primary' : 'Set primary'}
                    </Text>
                  </Touchable>
                  <IconButton
                    accessibilityLabel={`Remove ${d.alias}`}
                    compact
                    icon={<Trash2 size={16} color={colors['muted-foreground']} />}
                    onPress={() => onRemove(d.id)}
                  />
                </View>
              }
            />
          ))}
          {error ? <Text className="px-4 pt-1 text-sm text-danger">{error}</Text> : null}
        </>
      ) : null}

      <SheetSection title={projectName ? `Codebases in ${projectName}` : 'Codebases'} />
      {!projectName ? (
        <Text className="px-4 py-2 text-sm text-muted-foreground">
          Pick a project first — its codebases can then be mounted here.
        </Text>
      ) : codebasesLoading ? (
        <View className="flex-row items-center gap-2 px-4 py-3">
          <Spinner />
          <Text className="text-sm text-muted-foreground">Loading codebases…</Text>
        </View>
      ) : available.length === 0 ? (
        <Text className="px-4 py-2 text-sm text-muted-foreground">
          {codebases.length === 0
            ? 'This project has no codebases yet. Add one from the desktop app.'
            : 'Every codebase in this project is already mounted.'}
        </Text>
      ) : (
        available.map((c) => (
          <SheetRow
            key={c.id}
            title={c.alias}
            subtitle={c.defaultBranch ? `default branch ${c.defaultBranch}` : null}
            onPress={() => onAdd(c)}
            left={<FolderGit2 size={18} color={colors['muted-foreground']} />}
            right={<ChevronRight size={18} color={colors['muted-foreground']} />}
          />
        ))
      )}

      <SheetSection title="Local folder" />
      <View className="flex-row items-center gap-2 px-4 pb-6 pt-1">
        <Lock size={16} color={colors['muted-foreground']} />
        <Text className="flex-1 text-sm text-muted-foreground">
          {folderReason ??
            'A folder source is a path on the machine running GeneratorAI, which this device cannot browse. Add it from the desktop app.'}
        </Text>
      </View>
    </>
  );
}

const MODE_SEGMENTS: ReadonlyArray<{ value: SourceMode; label: string }> = [
  { value: 'worktree', label: 'Worktree' },
  { value: 'in-place', label: 'In place' },
];
const BRANCH_SEGMENTS: ReadonlyArray<{ value: BranchMode; label: string }> = [
  { value: 'current', label: 'Current' },
  { value: 'existing', label: 'Existing' },
  { value: 'new', label: 'New' },
];

function SourceEditPage({
  draft,
  chatName,
  otherAliases,
  projectId,
  fetchBranches,
  onChange,
  onRemove,
  onDone,
}: {
  draft: DraftSource;
  chatName: string;
  otherAliases: string[];
  projectId: string | null;
  fetchBranches: (codebaseId: string) => Promise<string[]>;
  onChange: (patch: Partial<DraftSource>) => void;
  onRemove: () => void;
  onDone: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const branches = useQuery({
    queryKey: ['projects', projectId ?? '', 'codebases', draft.codebaseId ?? '', 'branches'],
    queryFn: () => fetchBranches(draft.codebaseId!),
    enabled: draft.branchMode === 'existing' && Boolean(draft.codebaseId) && Boolean(projectId),
    staleTime: 60_000,
  });

  return (
    <View className="gap-5 px-4 py-4">
      <View className="gap-1">
        <Text className="text-lg font-semibold text-foreground">{draft.name}</Text>
        <Text className="text-sm text-muted-foreground">{describeDraft(draft, chatName)}</Text>
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium text-foreground">Mount</Text>
        <SegmentedControl
          segments={MODE_SEGMENTS}
          value={draft.mode}
          onChange={(mode) => onChange({ mode })}
          accessibilityLabel="Mount mode"
        />
        <Text className="text-xs text-muted-foreground">
          {draft.mode === 'worktree'
            ? 'A separate checkout, so the agent’s edits never touch your working copy.'
            : 'Edits land directly in the repository checkout.'}
        </Text>
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium text-foreground">Branch</Text>
        <SegmentedControl
          segments={BRANCH_SEGMENTS}
          value={draft.branchMode}
          onChange={(branchMode) => onChange({ branchMode })}
          accessibilityLabel="Branch mode"
        />
        {draft.branchMode === 'existing' ? (
          <>
            <Field
              label="Branch name"
              placeholder={draft.defaultBranch ?? 'main'}
              value={draft.branch}
              onChangeText={(branch) => onChange({ branch })}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Existing branch"
            />
            {branches.isLoading ? (
              <View className="flex-row items-center gap-2">
                <Spinner />
                <Text className="text-xs text-muted-foreground">Loading branches…</Text>
              </View>
            ) : branches.data && branches.data.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {branches.data.slice(0, 30).map((b) => (
                  <Chip
                    key={b}
                    label={b}
                    size="sm"
                    selected={draft.branch === b}
                    onPress={() => onChange({ branch: b })}
                  />
                ))}
              </ScrollView>
            ) : null}
          </>
        ) : draft.branchMode === 'new' ? (
          <>
            <Field
              label="New branch"
              placeholder={defaultNewBranch(chatName)}
              value={draft.newBranch}
              onChangeText={(newBranch) => onChange({ newBranch })}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="New branch name"
            />
            <Field
              label="Base ref"
              hint="Optional. Defaults to the current branch."
              placeholder={draft.defaultBranch ?? 'main'}
              value={draft.baseRef}
              onChangeText={(baseRef) => onChange({ baseRef })}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Base ref"
            />
          </>
        ) : (
          <Text className="text-xs text-muted-foreground">
            Stays on whatever branch the codebase is on now
            {draft.defaultBranch ? ` (${draft.defaultBranch})` : ''}.
          </Text>
        )}
      </View>

      <Field
        label="Alias"
        hint="How the agent refers to this mount. Letters, digits, . _ -"
        value={draft.alias}
        onChangeText={(alias) => onChange({ alias })}
        onBlur={() => onChange({ alias: uniqueAlias(sanitizeAlias(draft.alias), otherAliases) })}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Alias"
        error={otherAliases.includes(draft.alias) ? 'Another source already uses this alias.' : null}
      />

      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button label="Done" full onPress={onDone} />
        </View>
        <Button
          label="Remove"
          variant="danger"
          icon={<Trash2 size={16} color={colors['destructive-foreground']} />}
          onPress={onRemove}
        />
      </View>
    </View>
  );
}

function CapabilitiesPage({
  agent,
  overrides,
  onOverridesChange,
  skills,
  mcp,
  loading,
  projection,
  previewBusy,
}: {
  agent: AgentSummary | undefined;
  overrides: AgentOverrides;
  onOverridesChange: (next: AgentOverrides) => void;
  skills: Array<{ id: string; name: string }>;
  mcp: Array<{ id: string; name: string }>;
  loading: boolean;
  projection: Projection | undefined;
  previewBusy: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const baseSkills = new Set(agent?.skillIds ?? []);
  const baseMcp = new Set(agent?.mcpServerIds ?? []);

  return (
    <>
      <View className="px-4 pb-2 pt-1">
        <Text className="text-sm text-muted-foreground">
          {agent
            ? `Adds to or removes from what “${agent.name}” already has. The agent itself is not changed.`
            : 'No agent is bound; these apply on top of the platform defaults.'}
        </Text>
      </View>

      <SheetSection
        title="Effective capabilities"
        right={previewBusy ? <Spinner /> : undefined}
      />
      <View className="px-4 pb-2">
        {projection ? (
          <View className="gap-2">
            <View className="flex-row flex-wrap gap-1.5">
              {(projection.skills?.names ?? []).map((s) => (
                <Chip key={s} label={s} size="sm" />
              ))}
              {Object.keys(projection.mcpServers ?? {}).map((m) => (
                <Chip key={`mcp:${m}`} label={`MCP · ${m}`} size="sm" tone="neutral" />
              ))}
              {(projection.skills?.names?.length ?? 0) === 0 && Object.keys(projection.mcpServers ?? {}).length === 0 ? (
                <Text className="text-sm text-muted-foreground">No skills or MCP servers.</Text>
              ) : null}
            </View>
            {(projection.warnings ?? []).map((w, i) => (
              <Text key={i} className="text-xs text-warning">
                {typeof w === 'string' ? w : (w.message ?? w.code ?? 'Warning')}
              </Text>
            ))}
          </View>
        ) : (
          <Text className="text-sm text-muted-foreground">
            {previewBusy ? 'Resolving…' : 'Pick an agent or toggle a capability to preview the result.'}
          </Text>
        )}
      </View>

      <SheetSection title="Skills" />
      {loading ? (
        <View className="flex-row items-center gap-2 px-4 py-3">
          <Spinner />
          <Text className="text-sm text-muted-foreground">Loading catalogue…</Text>
        </View>
      ) : skills.length === 0 ? (
        <Text className="px-4 py-2 text-sm text-muted-foreground">No skills installed.</Text>
      ) : (
        skills.map((s) => {
          const inBase = baseSkills.has(s.id);
          const on = overrideIncludes(overrides, 'skill', s.id, inBase);
          return (
            <ToggleRow
              key={s.id}
              icon={<Wand2 size={18} color={colors['muted-foreground']} />}
              label={s.name}
              help={inBase ? (on ? 'From the agent' : 'Removed for this chat') : on ? 'Added for this chat' : 'Not included'}
              value={on}
              onChange={(wanted) => onOverridesChange(toggleOverrideId(overrides, 'skill', s.id, inBase, wanted))}
            />
          );
        })
      )}

      <SheetSection title="MCP servers" />
      {mcp.length === 0 && !loading ? (
        <Text className="px-4 py-2 text-sm text-muted-foreground">No MCP servers configured.</Text>
      ) : (
        mcp.map((m) => {
          const inBase = baseMcp.has(m.id);
          const on = overrideIncludes(overrides, 'mcp', m.id, inBase);
          return (
            <ToggleRow
              key={m.id}
              icon={<Cpu size={18} color={colors['muted-foreground']} />}
              label={m.name}
              help={inBase ? (on ? 'From the agent' : 'Removed for this chat') : on ? 'Added for this chat' : 'Not included'}
              value={on}
              onChange={(wanted) => onOverridesChange(toggleOverrideId(overrides, 'mcp', m.id, inBase, wanted))}
            />
          );
        })
      )}

      <View className="px-4 pb-6 pt-4">
        <Field
          label="Extra instructions"
          hint="Appended to the agent's instructions for this chat only."
          placeholder="Optional"
          value={overrides.appendInstructions ?? ''}
          onChangeText={(text) => {
            const next = { ...overrides };
            if (text.trim()) next.appendInstructions = text;
            else delete next.appendInstructions;
            onOverridesChange(next);
          }}
          multiline
          accessibilityLabel="Extra instructions"
        />
      </View>
    </>
  );
}

// ── Rows ────────────────────────────────────────────────────────

/**
 * Agent-native source control.
 *
 * Three switches that imply each other downward — a pull request needs a
 * push needs a commit — so turning the bottom one on turns the ones above it
 * on rather than leaving a combination the server has to repair. Base and
 * draft only appear once there is a pull request to apply them to.
 */
function SourceControlPage({
  value,
  onChange,
}: {
  value: ChatSourceControlOptions;
  onChange: (next: ChatSourceControlOptions) => void;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <>
      <View className="px-4 pb-2 pt-3">
        <Text className="text-xs leading-relaxed text-muted-foreground">
          Runs after every completed turn that changed files. Conflicts stop it and ask you what to
          do — nothing is force-pushed, and the default branch is never pushed to.
        </Text>
      </View>
      <View className="mx-4 overflow-hidden rounded-3xl border border-border bg-card">
        <ToggleRow
          icon={<GitBranch size={18} color={colors['muted-foreground']} />}
          label="Auto-commit"
          help="Commit the change set when the agent finishes a turn."
          value={value.autoCommit}
          onChange={(autoCommit) =>
            onChange(
              autoCommit
                ? { ...value, autoCommit: true }
                : { ...value, autoCommit: false, autoPush: false, autoPullRequest: false },
            )
          }
        />
        <View className="ml-[46px] h-px bg-border-muted" />
        <ToggleRow
          icon={<GitBranch size={18} color={colors['muted-foreground']} />}
          label="Push"
          help="Push the work branch after committing."
          value={value.autoPush}
          onChange={(autoPush) =>
            onChange(
              autoPush
                ? { ...value, autoCommit: true, autoPush: true }
                : { ...value, autoPush: false, autoPullRequest: false },
            )
          }
        />
        <View className="ml-[46px] h-px bg-border-muted" />
        <ToggleRow
          icon={<GitPullRequest size={18} color={colors['muted-foreground']} />}
          label="Open pull request"
          help="Opens one against the base branch, once."
          value={value.autoPullRequest}
          onChange={(autoPullRequest) =>
            onChange(
              autoPullRequest
                ? { ...value, autoCommit: true, autoPush: true, autoPullRequest: true }
                : { ...value, autoPullRequest: false },
            )
          }
        />
      </View>

      {value.autoPullRequest ? (
        <View className="gap-4 px-4 pb-6 pt-4">
          <Field
            label="Base branch"
            hint="Empty means the repository's default branch."
            placeholder="main"
            value={value.base ?? ''}
            onChangeText={(base) => onChange({ ...value, base })}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Base branch"
          />
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-foreground">Open as draft</Text>
            <Switch
              value={value.draft === true}
              onValueChange={(draft) => onChange({ ...value, draft })}
              accessibilityLabel="Open as draft"
            />
          </View>
        </View>
      ) : (
        <View className="px-4 pb-6 pt-2" />
      )}
    </>
  );
}

function PickerRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onPress: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Touchable
      accessibilityLabel={`${label}: ${value}`}
      haptic="tap"
      scale="large"
      onPress={onPress}
      className="min-h-14 flex-row items-center gap-3 px-4 py-2.5"
    >
      {icon}
      <Text className="flex-1 text-md text-foreground">{label}</Text>
      <Text numberOfLines={1} className="max-w-40 text-sm text-muted-foreground">
        {value}
      </Text>
      <ChevronRight size={18} color={colors['muted-foreground']} />
    </Touchable>
  );
}

function ToggleRow({
  icon,
  label,
  help,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  help: string;
  value: boolean;
  onChange: (value: boolean) => void;
}): React.ReactElement {
  return (
    <View className="min-h-14 flex-row items-center gap-3 px-4 py-2.5">
      {icon}
      <View className="flex-1 gap-0.5">
        <Text className="text-md text-foreground">{label}</Text>
        <Text className="text-xs text-muted-foreground">{help}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}
