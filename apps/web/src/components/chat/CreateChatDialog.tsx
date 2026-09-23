// ────────────────────────────────────────────────────────────────
// CreateChatDialog — Modal for creating a new v2 Chat
// Supports name, description, model selection, repo URL, tags
// ────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateChat } from '@/hooks/queries.js';
import { X, MessageSquarePlus, Tag, Plus, Boxes, Bot, Network } from 'lucide-react';
import { Modal, Button, Input, Textarea, Badge } from '@/components/ui/index.js';
import { SourcePicker } from '@/components/chat/sources/SourcePicker.js';
import {
  draftsToSources,
  validateDrafts,
  type DraftSource,
} from '@/components/chat/sources/sourceModel.js';
import { getDefaultChatModel } from '@/lib/appPreferences.js';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';
import { ModelPicker } from '@/components/shared/ModelPicker.js';
import { useModels } from '@/hooks/queries.js';
import {
  SourceControlOptionsFields,
  DEFAULT_SOURCE_CONTROL_OPTIONS,
} from '@/components/scm/SourceControlOptionsFields.js';
import { AgentPicker } from '@/components/agents/AgentPicker.js';
import { AgentOverridesEditor } from '@/components/agents/AgentOverridesEditor.js';
import { EffectiveCapabilitiesPanel } from '@/components/agents/EffectiveCapabilitiesPanel.js';
import { useResolveAgentPreview } from '@/hooks/agentQueries.js';
import type { Agent, AgentOverrides, ChatSourceControlOptions, CreateChatParams, ResolvedAgentProjection } from '@generatorai/shared';
import {
  BrowserVisibilityPicker,
  DEFAULT_BROWSER_PICKER_VALUE,
  pickerValueToBrowserConfig,
  type BrowserPickerValue,
} from '@/components/browser/BrowserVisibilityPicker.js';

interface CreateChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateChatDialog({ open, onOpenChange }: CreateChatDialogProps) {
  const navigate = useNavigate();
  const createMutation = useCreateChat();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  /**
   * The mount plan. `sources[0]` is the agent's cwd unless `primaryAlias`
   * names another, which is exactly what the server's `primary` field means.
   */
  const [sourceDrafts, setSourceDrafts] = useState<DraftSource[]>([]);
  const [primaryAlias, setPrimaryAlias] = useState<string | undefined>(undefined);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [browserPicker, setBrowserPicker] = useState<BrowserPickerValue>(DEFAULT_BROWSER_PICKER_VALUE);
  const [orchestratorMode, setOrchestratorMode] = useState(false);
  /**
   * Agent-native source control. Off by default: nothing commits to git
   * unless the user asked for it (principle 1 of the design).
   */
  const [sourceControl, setSourceControl] = useState<ChatSourceControlOptions>(
    DEFAULT_SOURCE_CONTROL_OPTIONS,
  );

  // AGT-01 — agent binding. The chat stores the portable `scope:slug` ref plus
  // an additive override delta; the server resolves the union at create time.
  const [agentRef, setAgentRef] = useState<string | undefined>(undefined);
  const [selectedAgent, setSelectedAgent] = useState<Agent | undefined>(undefined);
  const [agentOverrides, setAgentOverrides] = useState<AgentOverrides>({});
  const [showCapabilities, setShowCapabilities] = useState(false);
  const [projection, setProjection] = useState<ResolvedAgentProjection | undefined>(undefined);
  const resolvePreview = useResolveAgentPreview();

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus name input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [open]);

  // Seed the model from the user's default-model preference when the dialog
  // opens (empty preference → provider default). Read live so a change in
  // Settings takes effect on the very next chat creation.
  useEffect(() => {
    if (open) {
      setModel(getDefaultChatModel());
    }
  }, [open]);

  // No saved preference → start on the first model that can actually run.
  // The field used to open on "Select a model…" every single time, and Create
  // Chat with it left empty handed the choice to whichever provider happened
  // to be primary — signed in or not.
  const { data: availableModels } = useModels();
  useEffect(() => {
    if (!open || model) return;
    const first = availableModels?.[0];
    if (first) setModel(first.id);
  }, [open, model, availableModels]);

  // Reset form on close
  useEffect(() => {
    if (!open) {
      setName('');
      setDescription('');
      setModel('');
      setTagInput('');
      setTags([]);
      setShowAdvanced(false);
      setSelectedProjectId('');
      setSourceDrafts([]);
      setPrimaryAlias(undefined);
      setSourceError(null);
      setBrowserPicker(DEFAULT_BROWSER_PICKER_VALUE);
      setAgentRef(undefined);
      setSelectedAgent(undefined);
      setAgentOverrides({});
      setShowCapabilities(false);
      setProjection(undefined);
    }
  }, [open]);

  // Resolve the effective capabilities whenever the binding changes. Debounced
  // because toggling several skills in a row would otherwise fire a request per
  // click. The response is redacted server-side.
  const overridesKey = JSON.stringify(agentOverrides);
  const resolveMutate = resolvePreview.mutateAsync;
  useEffect(() => {
    if (!open) return;
    if (!agentRef && overridesKey === '{}') {
      setProjection(undefined);
      return;
    }
    const timer = setTimeout(() => {
      void resolveMutate({
        scope: 'chat',
        ...(agentRef ? { agentRef } : {}),
        ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
        overrides: JSON.parse(overridesKey) as AgentOverrides,
      })
        .then(setProjection)
        .catch(() => setProjection(undefined));
    }, 300);
    return () => clearTimeout(timer);
  }, [open, agentRef, overridesKey, selectedProjectId, resolveMutate]);

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag) && tags.length < 20) {
      setTags((prev) => [...prev, tag]);
      setTagInput('');
    }
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback((tagToRemove: string) => {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
  }, []);

  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag],
  );

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;

    // Everything the client can judge is judged here; the server's own 400
    // lands in the same place so the user never has to look in two spots.
    const localProblem = validateDrafts(sourceDrafts);
    if (localProblem) {
      setSourceError(localProblem);
      return;
    }
    setSourceError(null);

    try {
      const sources = draftsToSources(sourceDrafts, name.trim());
      const params: CreateChatParams = {
        name: name.trim(),
        description: description.trim() || undefined,
        model: model || undefined,
        tags,
        projectId: selectedProjectId || undefined,
        // `sources` supersedes codebaseIds / createWorktree / gitRepositories:
        // sending both would let the legacy mapping fight the explicit plan.
        ...(sources.length > 0 ? { sources } : {}),
        ...(sources.length > 0 && primaryAlias ? { primary: primaryAlias } : {}),
        orchestratorMode: orchestratorMode || undefined,
        agentRef: agentRef || undefined,
        agentOverrides: Object.keys(agentOverrides).length > 0 ? agentOverrides : undefined,
        // Only sent when the user actually opted in — an all-false object
        // would read on the server as "explicitly disabled" rather than
        // "not configured".
        ...(sourceControl.autoCommit ? { sourceControl } : {}),
      };

      // Browser config from the visibility picker.
      const bc = pickerValueToBrowserConfig(browserPicker);
      if (bc) params.browserConfig = bc;

      const chat = await createMutation.mutateAsync(params);
      onOpenChange(false);
      navigate(`/chats/${chat.id}`);
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : 'Could not create the chat.');
    }
  }, [name, description, model, tags, selectedProjectId, sourceDrafts, primaryAlias, browserPicker, orchestratorMode, agentRef, agentOverrides, sourceControl, createMutation, onOpenChange, navigate]);

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title="New Chat"
      description="Start a new conversation with your configured agent"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={!name.trim()}
            loading={createMutation.isPending}
            leftIcon={<MessageSquarePlus className="h-4 w-4" />}
          >
            Create Chat
          </Button>
        </>
      }
    >
      {/* Form */}
      <div className="space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="chat-name" className="mb-1.5 block text-sm font-medium text-foreground">
              Chat Name <span className="text-danger">*</span>
            </label>
            <Input
              ref={nameInputRef}
              id="chat-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Refactor auth module"
              maxLength={200}
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="chat-desc" className="mb-1.5 block text-sm font-medium text-foreground">
              Description
            </label>
            <Textarea
              id="chat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
              className="resize-none"
              maxLength={2000}
            />
          </div>

          {/* Model Selection */}
          <div>
            <label htmlFor="chat-model" className="mb-1.5 block text-sm font-medium text-foreground">
              Model
            </label>
            <ModelPicker
              id="chat-model"
              value={model}
              onChange={(v) => setModel(v)}
              placeholder="Select a model…"
              ariaLabel="Chat model"
            />
          </div>

          {/* Agent-native source control — the platform commits for the
              agent, so the agent never runs `git commit` itself. */}
          <SourceControlOptionsFields value={sourceControl} onChange={setSourceControl} />

          {/* Agent binding — reusable instructions with their own skills, MCP
              servers and capabilities. Capabilities selected below are a
              UNION with the agent's own, never a replacement. */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Bot className="h-4 w-4 text-primary" />
              Agent
            </label>
            <AgentPicker
              value={agentRef}
              projectId={selectedProjectId || undefined}
              data-testid="create-chat-agent-picker"
              onChange={(ref, agent) => {
                setAgentRef(ref);
                setSelectedAgent(agent);
                // An orchestrator agent IS the orchestrator: keep the checkbox
                // in sync rather than letting the two disagree.
                if (agent?.role === 'orchestrator') setOrchestratorMode(true);
              }}
            />
            {selectedAgent?.role === 'orchestrator' && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-primary">
                <Network className="h-3 w-3" />
                Orchestrate mode is enabled by this agent.
              </p>
            )}

            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowCapabilities((v) => !v)}
              data-testid="create-chat-customize-capabilities"
              className="mt-2 h-auto p-0 text-xs font-medium text-primary hover:underline"
            >
              {showCapabilities ? 'Hide capabilities' : 'Customize capabilities'}
            </Button>

            {projection && !showCapabilities && (
              <div className="mt-2 flex flex-wrap gap-1.5" data-testid="create-chat-capability-chips">
                <Badge tone="neutral" size="sm">
                  {projection.skills.names.length} skills
                  {selectedAgent
                    ? ` (${selectedAgent.skillIds.length} from agent + ${Math.max(
                        0,
                        projection.skills.names.length - selectedAgent.skillIds.length,
                      )} added)`
                    : ''}
                </Badge>
                <Badge tone="neutral" size="sm">
                  {Object.keys(projection.mcpServers ?? {}).length} MCP servers
                </Badge>
              </div>
            )}

            {showCapabilities && (
              <div className="mt-3 space-y-3 rounded-lg border border-border p-3">
                <AgentOverridesEditor
                  agent={selectedAgent}
                  value={agentOverrides}
                  onChange={setAgentOverrides}
                  {...(selectedProjectId ? { projectId: selectedProjectId } : {})}
                  {...(projection
                    ? { effectiveGroups: projection.toolPolicy.groups }
                    : {})}
                />
                <div className="border-t border-border pt-3">
                  <EffectiveCapabilitiesPanel
                    projection={projection}
                    isLoading={resolvePreview.isPending && !projection}
                    {...(selectedAgent
                      ? {
                          baseCounts: {
                            skills: selectedAgent.skillIds.length,
                            mcpServers: selectedAgent.mcpServerIds.length,
                          },
                        }
                      : {})}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Orchestrate mode */}
          <div className="rounded-lg border border-[var(--color-border)] p-3">
            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox
                className="mt-0.5"
                checked={orchestratorMode}
                disabled={selectedAgent?.role === 'orchestrator'}
                onCheckedChange={(v) => setOrchestratorMode(v === true)}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Boxes className="h-4 w-4 text-primary" />
                  Orchestrate mode
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-muted-foreground)]">
                  This chat becomes an orchestrator: pick a powerful model, and it will break the task
                  into subtasks, spawn background agents (each a separate chat, on a model it chooses),
                  review their results, and consolidate. Track them in the Background Tasks panel.
                </span>
                {orchestratorMode && !model && (
                  <span className="mt-1 block text-[11px] text-amber-500">
                    Tip: choose a powerful model above for the orchestrator.
                  </span>
                )}
              </span>
            </label>
          </div>

          {/* Sources — what the agent works on. Each entry becomes a mount:
              a project codebase or a local folder, edited in place or through
              a worktree, on a branch of its own. */}
          <SourcePicker
            chatName={name}
            projectId={selectedProjectId}
            onProjectIdChange={setSelectedProjectId}
            drafts={sourceDrafts}
            onChange={setSourceDrafts}
            primaryAlias={primaryAlias}
            onPrimaryChange={(alias) => setPrimaryAlias(alias || undefined)}
            error={sourceError}
          />

          {/* Advanced toggle */}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="h-auto p-0 text-xs font-medium text-primary hover:underline"
          >
            {showAdvanced ? 'Hide advanced options' : 'Show advanced options'}
          </Button>

          {showAdvanced && (
            <>
              {/* Tags */}
              <div>
                <label htmlFor="chat-tags" className="mb-1.5 block text-sm font-medium text-foreground">
                  Tags
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Tag className="absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="chat-tags"
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={handleTagKeyDown}
                      placeholder="Add tag..."
                      className="pl-8"
                      maxLength={50}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={handleAddTag}
                    disabled={!tagInput.trim()}
                    aria-label="Add tag"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                      >
                        {tag}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleRemoveTag(tag)}
                          aria-label={`Remove tag ${tag}`}
                          className="h-auto w-auto rounded-full p-0.5 hover:bg-primary/20"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Integrated Browser configuration — visibility + evalAllowed + hosts. */}
              <BrowserVisibilityPicker
                value={browserPicker}
                onChange={setBrowserPicker}
                compact
              />
            </>
          )}

          {/* Error — server failures that are not about the sources (those are
              rendered inline by the picker, next to the field that caused them). */}
          {createMutation.isError && !sourceError && (
            <p className="text-xs text-danger">
              Failed to create chat: {createMutation.error instanceof Error ? createMutation.error.message : 'Unknown error'}
            </p>
          )}
      </div>
    </Modal>
  );
}
