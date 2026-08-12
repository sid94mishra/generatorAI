// ────────────────────────────────────────────────────────────────
// New chat.
//
// The web flow spreads creation options across a dialog plus the composer.
// Here it is a single sheet with progressive disclosure: the one required
// field is at the top, sensible defaults are shown as rows, and "More
// options" reveals the rest. That keeps the common case to two taps without
// removing anything.
//
// Pickers push a page WITHIN the sheet rather than opening a second sheet —
// HIG is explicit that a sheet opening another sheet loses people.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Bot, ChevronLeft, ChevronRight, Cpu, FolderGit2, ShieldCheck, Wand2 } from 'lucide-react-native';
import type { AgentMode, AgentSummary, ModelInfo, ProjectSummary } from '@generatorai/client-core';

import { Sheet, SheetRow, SheetSection } from '../ui/Sheet';
import { Button, IconButton } from '../ui/Button';
import { Field, Switch } from '../ui/Form';
import { Touchable } from '../ui/Touchable';
import { useModelGroups } from '../../api/useModels';
import { PERMISSION_MODES } from './TurnOptionsSheet';
import { useTheme } from '../../theme/ThemeProvider';

export interface NewChatValues {
  name: string;
  description?: string;
  model?: string;
  projectId?: string;
  defaultAgentMode?: AgentMode;
  permissionMode?: string;
  orchestratorMode?: boolean;
  /** Portable `scope:slug` ref of the agent driving the chat. */
  agentRef?: string;
}

type Page = 'main' | 'model' | 'project' | 'permission' | 'agent';

export function NewChatSheet({
  visible,
  onClose,
  onCreate,
  creating,
  error,
  models,
  projects,
  agents,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (values: NewChatValues) => void;
  creating: boolean;
  error?: string | null;
  models: ModelInfo[] | undefined;
  projects: ProjectSummary[] | undefined;
  agents?: AgentSummary[] | undefined;
}): React.ReactElement {
  const { colors } = useTheme();
  const [page, setPage] = useState<Page>('main');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>('auto');
  const [permissionMode, setPermissionMode] = useState('default');
  const [orchestrator, setOrchestrator] = useState(false);
  const [agentRef, setAgentRef] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

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
    setExpanded(false);
  };

  const close = (): void => {
    reset();
    onClose();
  };

  const title =
    page === 'model'
      ? 'Model'
      : page === 'project'
        ? 'Project'
        : page === 'permission'
          ? 'Permissions'
          : page === 'agent'
            ? 'Agent'
            : 'New chat';

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={title}
      detents={[0.75, 0.92]}
      leading={
        page === 'main' ? undefined : (
          <IconButton
            accessibilityLabel="Back"
            icon={<ChevronLeft size={22} color={colors.foreground} />}
            onPress={() => setPage('main')}
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
                setAgentRef(entry.ref);
                // An orchestrator agent IS the orchestrator; keep the toggle
                // from contradicting the chosen agent.
                if (entry.role === 'orchestrator') setOrchestrator(true);
                setPage('main');
              }}
            />
          ))}
        </>
      ) : (
        <View className="gap-4 px-4 py-4">
          <Field
            label="Name"
            placeholder="What is this chat about?"
            value={name}
            onChangeText={setName}
            autoFocus
            accessibilityLabel="Chat name"
          />

          <View className="overflow-hidden rounded-3xl border border-border bg-card">
            <PickerRow
              icon={<Cpu size={18} color={colors['muted-foreground']} />}
              label="Model"
              value={selectedModel?.name ?? 'Server default'}
              onPress={() => setPage('model')}
            />
            <View className="ml-4 h-px bg-border-muted" />
            <PickerRow
              icon={<FolderGit2 size={18} color={colors['muted-foreground']} />}
              label="Project"
              value={selectedProject?.name ?? 'None'}
              onPress={() => setPage('project')}
            />
            <View className="ml-4 h-px bg-border-muted" />
            <PickerRow
              icon={<Bot size={18} color={colors['muted-foreground']} />}
              label="Agent"
              value={selectedAgent?.name ?? 'None'}
              onPress={() => setPage('agent')}
            />
          </View>

          <Touchable
            accessibilityLabel={expanded ? 'Hide more options' : 'Show more options'}
            haptic="select"
            onPress={() => setExpanded((v) => !v)}
            className="self-start"
          >
            <Text className="text-sm font-medium text-primary">
              {expanded ? 'Fewer options' : 'More options'}
            </Text>
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
                  help="The agent writes a plan and waits for approval."
                  value={agentMode === 'plan'}
                  onChange={(on) => setAgentMode(on ? 'plan' : 'auto')}
                />
                <View className="ml-4 h-px bg-border-muted" />
                <PickerRow
                  icon={<ShieldCheck size={18} color={colors['muted-foreground']} />}
                  label="Permissions"
                  value={
                    PERMISSION_MODES.find((m) => m.value === permissionMode)?.title ?? 'Ask me'
                  }
                  onPress={() => setPage('permission')}
                />
                <View className="ml-4 h-px bg-border-muted" />
                <ToggleRow
                  icon={<Cpu size={18} color={colors['muted-foreground']} />}
                  label="Orchestrator mode"
                  help="Lets the agent delegate work to background sub-agents."
                  value={orchestrator}
                  onChange={setOrchestrator}
                />
              </View>
            </View>
          ) : null}

          {error ? <Text className="text-sm text-danger">{error}</Text> : null}

          <Button
            label="Create chat"
            full
            size="lg"
            loading={creating}
            disabled={name.trim().length === 0}
            onPress={() =>
              onCreate({
                name: name.trim(),
                ...(description.trim() ? { description: description.trim() } : {}),
                ...(model ? { model } : {}),
                ...(projectId ? { projectId } : {}),
                defaultAgentMode: agentMode,
                permissionMode,
                ...(agentRef ? { agentRef } : {}),
                ...(orchestrator ? { orchestratorMode: true } : {}),
              })
            }
          />
        </View>
      )}
    </Sheet>
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
