// ────────────────────────────────────────────────────────────────
// CreateChatDialog — Modal for creating a new v2 Chat
// Supports name, description, model selection, repo URL, tags
// ────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateChat } from '@/hooks/queries.js';
import { useProjects, useProjectCodebases } from '@/hooks/projectQueries.js';
import { X, MessageSquarePlus, Loader2, Tag, Plus, GitBranch, FolderGit2, FolderOpen, Boxes } from 'lucide-react';
import { Select, Modal, Button, Input, Textarea } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import { getDefaultChatModel } from '@/lib/appPreferences.js';
import { ModelPicker } from '@/components/shared/ModelPicker.js';
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
  const [selectedCodebases, setSelectedCodebases] = useState<string[]>([]);
  const [localFolderPath, setLocalFolderPath] = useState('');
  const [browserPicker, setBrowserPicker] = useState<BrowserPickerValue>(DEFAULT_BROWSER_PICKER_VALUE);
  const [orchestratorMode, setOrchestratorMode] = useState(false);

  const { data: projects } = useProjects();
  const { data: codebases, isLoading: codebasesLoading } = useProjectCodebases(selectedProjectId || undefined);

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
      setSelectedCodebases([]);
      setLocalFolderPath('');
      setBrowserPicker(DEFAULT_BROWSER_PICKER_VALUE);
    }
  }, [open]);

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

    try {
      const params: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || undefined,
        model: model || undefined,
        tags,
        projectId: selectedProjectId || undefined,
        codebaseIds: selectedCodebases.length > 0 ? selectedCodebases : undefined,
        createWorktree: selectedCodebases.length > 0 ? true : undefined,
        orchestratorMode: orchestratorMode || undefined,
      };

      // If a local folder path is provided, pass as gitRepositories
      if (localFolderPath.trim()) {
        params.gitRepositories = [{ url: localFolderPath.trim(), alias: 'local' }];
      }

      // Browser config from the visibility picker.
      const bc = pickerValueToBrowserConfig(browserPicker);
      if (bc) params.browserConfig = bc;

      const chat = await createMutation.mutateAsync(params as any);
      onOpenChange(false);
      navigate(`/chats/${chat.id}`);
    } catch {
      // Error displayed via mutation state
    }
  }, [name, description, model, tags, selectedProjectId, selectedCodebases, localFolderPath, browserPicker, orchestratorMode, createMutation, onOpenChange, navigate]);

  const toggleCodebase = useCallback(
    (alias: string) => {
      if (selectedCodebases.includes(alias)) {
        setSelectedCodebases(selectedCodebases.filter((a) => a !== alias));
      } else if (selectedCodebases.length < 3) {
        setSelectedCodebases([...selectedCodebases, alias]);
      }
    },
    [selectedCodebases],
  );

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title="New Chat"
      description="Start a new conversation with Copilot"
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

          {/* Orchestrate mode */}
          <div className="rounded-lg border border-[var(--color-border)] p-3">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
                checked={orchestratorMode}
                onChange={(e) => setOrchestratorMode(e.target.checked)}
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

          {/* Project & Codebase Selection */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground flex items-center gap-1.5">
              <FolderGit2 className="h-4 w-4 text-primary" />
              Project & Codebases
            </label>
            <Select
              value={selectedProjectId}
              onChange={(v) => {
                setSelectedProjectId(v);
                setSelectedCodebases([]);
              }}
              options={[
                { value: '', label: 'No Project' },
                ...(projects ?? []).filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            {selectedProjectId && (
              <div className="mt-2 space-y-1.5">
                {codebasesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading codebases...
                  </div>
                ) : !codebases || codebases.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No codebases linked to this project.
                  </p>
                ) : (
                  <>
                    <p className="text-[10px] text-muted-foreground">
                      Select codebases ({selectedCodebases.length}/3)
                    </p>
                    {codebases.map((cb) => {
                      const isSelected = selectedCodebases.includes(cb.id);
                      const isDisabled = !isSelected && selectedCodebases.length >= 3;
                      const notReady = cb.status !== 'ready';
                      return (
                        <label
                          key={cb.id}
                          className={cn(
                            'flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-all',
                            notReady ? 'opacity-50 cursor-not-allowed border-border' :
                            isSelected
                              ? 'border-primary bg-primary/5 cursor-pointer'
                              : isDisabled
                                ? 'opacity-50 cursor-not-allowed border-border'
                                : 'border-border hover:border-primary/50 cursor-pointer',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isDisabled || notReady}
                            onChange={() => toggleCodebase(cb.id)}
                            className="h-3.5 w-3.5 rounded accent-primary"
                          />
                          <GitBranch className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">{cb.alias}</span>
                          <span className={cn(
                            'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                            cb.status === 'ready'
                              ? 'bg-success-muted text-success'
                              : 'bg-warning-muted text-warning',
                          )}>
                            {cb.status}
                          </span>
                        </label>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Local Folder Path (alternative to project codebases) */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground flex items-center gap-1.5">
              <FolderOpen className="h-4 w-4 text-primary" />
              Local Folder Path
            </label>
            <Input
              type="text"
              value={localFolderPath}
              onChange={(e) => setLocalFolderPath(e.target.value)}
              placeholder="C:\path\to\your\project (optional)"
              className="font-mono"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              The agent will use this folder as the working directory for commands.
            </p>
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs font-medium text-primary hover:underline"
          >
            {showAdvanced ? 'Hide advanced options' : 'Show advanced options'}
          </button>

          {showAdvanced && (
            <>
              {/* Tags */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Tags
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Tag className="absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
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
                        <button
                          onClick={() => handleRemoveTag(tag)}
                          className="rounded-full p-0.5 hover:bg-primary/20"
                        >
                          <X className="h-3 w-3" />
                        </button>
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

          {/* Error */}
          {createMutation.isError && (
            <p className="text-xs text-danger">
              Failed to create chat: {createMutation.error instanceof Error ? createMutation.error.message : 'Unknown error'}
            </p>
          )}
      </div>
    </Modal>
  );
}
