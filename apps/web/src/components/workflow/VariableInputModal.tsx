// ────────────────────────────────────────────────────────────────
// VariableInputModal — Collect variable values before starting a run
// Renders type-appropriate inputs based on WorkflowDefinition.variables
// ────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Play, AlertCircle, Upload, FileText, Trash2, FolderGit2, ChevronDown, ChevronRight, Settings2 } from 'lucide-react';
import type { VariableDefinition } from '@generatorai/shared';
import { Select, Modal, Button, Input, Textarea, Badge } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';

type UploadCategory = 'prompts' | 'skills' | 'agents';

export interface UploadedFileSet {
  prompts: File[];
  skills: File[];
  agents: File[];
}

/** Stage override entry for runtime per-stage configuration */
export interface StageOverrideEntry {
  stageName: string;
  stageIndex: number;
  skip: boolean;
  variables: Record<string, string>;
}

/** Codebase info for auto-filling git variables */
export interface LinkedCodebaseInfo {
  alias: string;
  url: string;
  branch: string;
}

interface VariableInputModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (variables: Record<string, unknown>, uploads?: UploadedFileSet, stageOverrides?: StageOverrideEntry[]) => void;
  variables: VariableDefinition[];
  workflowName: string;
  isSubmitting?: boolean;
  /** When set, git_url/branch variables are auto-filled from linked project codebases */
  linkedCodebases?: LinkedCodebaseInfo[];
  /** Stage names for the override section */
  stageNames?: string[];
}

export function VariableInputModal({
  open,
  onClose,
  onSubmit,
  variables,
  workflowName,
  isSubmitting,
  linkedCodebases,
  stageNames,
}: VariableInputModalProps) {
  // Determine which variables are auto-filled from linked project codebases
  const hasLinkedCodebases = linkedCodebases && linkedCodebases.length > 0;
  const GIT_VARIABLE_NAMES = new Set(['git_url', 'repo_url', 'repository_url', 'repository']);
  const BRANCH_VARIABLE_NAMES = new Set(['branch', 'git_branch', 'repo_branch']);

  // Filter out git-related variables when project codebases are linked
  const displayVariables = useMemo(() => {
    if (!hasLinkedCodebases) return variables;
    return variables.filter(
      (v) => !GIT_VARIABLE_NAMES.has(v.name) && !BRANCH_VARIABLE_NAMES.has(v.name),
    );
  }, [variables, hasLinkedCodebases]);

  // Seed one field from its definition. Shared by the initial state and the
  // re-seed on open so both paths apply defaults identically.
  const seedValue = useCallback(
    (v: VariableDefinition): unknown => {
      let def = v.defaultValue ?? (v.type === 'boolean' ? false : '');
      // Auto-fill git variables from linked codebases
      if (hasLinkedCodebases) {
        if (GIT_VARIABLE_NAMES.has(v.name)) {
          def = linkedCodebases![0]!.url;
        } else if (BRANCH_VARIABLE_NAMES.has(v.name)) {
          def = linkedCodebases![0]!.branch || 'main';
        }
      }
      // Coerce boolean defaults so "false" string doesn't render as checked
      if (v.type === 'boolean') {
        def = def === true || def === 'true' || def === '1';
      }
      return def;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasLinkedCodebases, linkedCodebases],
  );

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const v of variables) initial[v.name] = seedValue(v);
    return initial;
  });

  // Re-seed every time the dialog opens.
  //
  // The dialog is mounted for the whole page lifetime and toggled with `open`,
  // so its useState initialiser ran while `variables` was still the empty
  // array the builder store starts with — every default (including required
  // ones) came up blank, and choice fields read "Select…". Re-seeding on open
  // also discards a half-filled abandoned run, which is the expected
  // behaviour for a dialog that reopens from scratch.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const fresh: Record<string, unknown> = {};
      for (const v of variables) fresh[v.name] = seedValue(v);
      setValues(fresh);
      setErrors({});
      setStageOverrides(
        (stageNames ?? []).map((name, index) => ({
          stageName: name,
          stageIndex: index,
          skip: false,
          variables: {},
        })),
      );
    }
    wasOpen.current = open;
  }, [open, variables, stageNames, seedValue]);

  // Update git variable values when linkedCodebases loads asynchronously
  React.useEffect(() => {
    if (!hasLinkedCodebases) return;
    setValues((prev) => {
      const updated = { ...prev };
      for (const v of variables) {
        if (GIT_VARIABLE_NAMES.has(v.name)) {
          updated[v.name] = linkedCodebases![0]!.url;
        } else if (BRANCH_VARIABLE_NAMES.has(v.name)) {
          updated[v.name] = linkedCodebases![0]!.branch || 'main';
        }
      }
      return updated;
    });
  }, [hasLinkedCodebases, linkedCodebases, variables]);

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Upload state
  const [uploadCategory, setUploadCategory] = useState<UploadCategory>('prompts');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileSet>({ prompts: [], skills: [], agents: [] });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasUploads = uploadedFiles.prompts.length + uploadedFiles.skills.length + uploadedFiles.agents.length > 0;

  // Stage override state
  const [showStageOverrides, setShowStageOverrides] = useState(false);
  const [stageOverrides, setStageOverrides] = useState<StageOverrideEntry[]>(() =>
    (stageNames ?? []).map((name, index) => ({
      stageName: name,
      stageIndex: index,
      skip: false,
      variables: {},
    })),
  );

  const hasActiveOverrides = stageOverrides.some((o) => o.skip || Object.keys(o.variables).length > 0);

  const toggleStageSkip = useCallback((index: number) => {
    setStageOverrides((prev) =>
      prev.map((o, i) => (i === index ? { ...o, skip: !o.skip } : o)),
    );
  }, []);

  const handleFilesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // FileList is live: resetting the picker clears it before React may run
    // the queued state updater. Snapshot it synchronously first.
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadedFiles((prev) => ({
      ...prev,
      [uploadCategory]: [...prev[uploadCategory], ...files],
    }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadCategory]);

  const removeFile = useCallback((category: UploadCategory, index: number) => {
    setUploadedFiles((prev) => ({
      ...prev,
      [category]: prev[category].filter((_, i) => i !== index),
    }));
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    for (const v of variables) {
      // Skip validation for auto-filled git variables when codebases are linked
      if (hasLinkedCodebases && (GIT_VARIABLE_NAMES.has(v.name) || BRANCH_VARIABLE_NAMES.has(v.name))) {
        continue;
      }
      const val = values[v.name];
      if (v.required) {
        if (val === undefined || val === null || val === '') {
          newErrors[v.name] = `${v.label} is required`;
        }
      }
      if (v.type === 'number' && val !== '' && val !== undefined) {
        const num = Number(val);
        if (isNaN(num)) {
          newErrors[v.name] = `${v.label} must be a number`;
        }
      }
      // Bug 7: Validate choice variables against allowed options
      if (v.type === 'choice' && v.options && val !== undefined && val !== '') {
        if (!v.options.includes(String(val))) {
          newErrors[v.name] = `${v.label} must be one of: ${v.options.join(', ')}`;
        }
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [variables, values, hasLinkedCodebases]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!validate()) return;

      // Convert types
      const converted: Record<string, unknown> = {};
      for (const v of variables) {
        let val = values[v.name];

        // Bug 8: Re-apply default value when user clears the field
        if ((val === '' || val === undefined || val === null) && v.defaultValue !== undefined) {
          val = v.defaultValue;
        }

        if (v.type === 'number') {
          // Bug 5: Convert empty/undefined to undefined, otherwise to a proper number
          if (val === '' || val === undefined || val === null) {
            val = undefined;
          } else {
            val = Number(val);
          }
        }
        if (v.type === 'boolean') {
          // Bug 6: Explicit true/false check instead of Boolean() which makes "false" → true
          val = val === true || val === 'true' || val === '1';
        }
        converted[v.name] = val;
      }

      onSubmit(converted, hasUploads ? uploadedFiles : undefined, hasActiveOverrides ? stageOverrides.filter(o => o.skip || Object.keys(o.variables).length > 0) : undefined);
    },
    [validate, variables, values, onSubmit, hasUploads, uploadedFiles, hasActiveOverrides, stageOverrides],
  );

  const updateValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      const { [name]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  if (!open) return null;

  // If no displayable variables (either none defined, or all git vars are auto-filled)
  if (displayVariables.length === 0) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Start Workflow Run"
        description={workflowName}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              leftIcon={<Play className="h-4 w-4" />}
              loading={isSubmitting}
              onClick={() => onSubmit({}, hasUploads ? uploadedFiles : undefined)}
            >
              Start Run
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Start a new run of "{workflowName}"?{' '}
            {!hasLinkedCodebases && 'No input variables are required.'}
          </p>

          {/* Show linked codebases info */}
          {hasLinkedCodebases && (
            <div className="rounded-md border border-border bg-subtle/50 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <FolderGit2 className="h-3.5 w-3.5 text-primary" />
                Linked Codebases
              </div>
              {linkedCodebases!.map((cb) => (
                <div key={cb.alias} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{cb.alias}</span>
                  <span className="truncate">{cb.url}</span>
                  {cb.branch && <span className="shrink-0 rounded bg-subtle px-1.5 py-0.5">{cb.branch}</span>}
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">
                A worktree will be created from the project codebase for this run.
              </p>
            </div>
          )}

          {/* Upload section for no-variables case */}
          <UploadSection
            uploadCategory={uploadCategory}
            setUploadCategory={setUploadCategory}
            uploadedFiles={uploadedFiles}
            fileInputRef={fileInputRef}
            handleFilesSelected={handleFilesSelected}
            removeFile={removeFile}
          />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start Workflow Run"
      description={workflowName}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            leftIcon={<Play className="h-4 w-4" />}
            loading={isSubmitting}
            onClick={handleSubmit as unknown as React.MouseEventHandler}
          >
            Start Run
          </Button>
        </>
      }
    >
      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
          {/* Show linked codebases info when git variables are auto-filled */}
          {hasLinkedCodebases && (
            <div className="rounded-md border border-border bg-subtle/50 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <FolderGit2 className="h-3.5 w-3.5 text-primary" />
                Linked Codebases
              </div>
              {linkedCodebases!.map((cb) => (
                <div key={cb.alias} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{cb.alias}</span>
                  <span className="truncate">{cb.url}</span>
                  {cb.branch && <span className="shrink-0 rounded bg-subtle px-1.5 py-0.5">{cb.branch}</span>}
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">
                Git variables (URL, branch) are auto-filled from project codebases. A worktree will be created for this run.
              </p>
            </div>
          )}

          {displayVariables.map((v) => (
            <div key={v.name}>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {v.label}
                {v.required && <span className="text-danger ml-0.5">*</span>}
              </label>
              {v.description && (
                <p className="mb-1.5 text-xs text-muted-foreground">
                  {v.description}
                </p>
              )}

              {/* String input */}
              {v.type === 'string' && (
                <Input
                  type="text"
                  value={String(values[v.name] ?? '')}
                  onChange={(e) => updateValue(v.name, e.target.value)}
                  invalid={!!errors[v.name]}
                  placeholder={v.label}
                />
              )}

              {/* Number input */}
              {v.type === 'number' && (
                <Input
                  type="number"
                  value={String(values[v.name] ?? '')}
                  onChange={(e) => updateValue(v.name, e.target.value)}
                  invalid={!!errors[v.name]}
                  placeholder={v.label}
                />
              )}

              {/* Boolean checkbox */}
              {v.type === 'boolean' && (
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={Boolean(values[v.name])}
                    onCheckedChange={(next) => updateValue(v.name, next === true)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-foreground">
                    {v.label}
                  </span>
                </label>
              )}

              {/* Choice dropdown */}
              {v.type === 'choice' && (
                <Select
                  value={String(values[v.name] ?? '')}
                  onChange={(val) => updateValue(v.name, val)}
                  options={(v.options ?? []).map((opt) => ({ value: opt, label: opt }))}
                  placeholder="Select…"
                />
              )}

              {/* Text (multiline) */}
              {v.type === 'text' && (
                <Textarea
                  value={String(values[v.name] ?? '')}
                  onChange={(e) => updateValue(v.name, e.target.value)}
                  rows={4}
                  invalid={!!errors[v.name]}
                  placeholder={v.label}
                />
              )}

              {/* Error message */}
              {errors[v.name] && (
                <div className="mt-1 flex items-center gap-1 text-xs text-danger">
                  <AlertCircle className="h-3 w-3" />
                  {errors[v.name]}
                </div>
              )}
            </div>
          ))}

          {/* Stage Overrides section */}
          {stageNames && stageNames.length > 0 && (
            <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
              <Button
                type="button"
                onClick={() => setShowStageOverrides(!showStageOverrides)}
                variant="ghost"
                size="sm"
                className="h-auto flex w-full items-center gap-2 bg-transparent p-0 text-sm font-medium text-foreground hover:bg-transparent"
              >
                {showStageOverrides ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <Settings2 className="h-4 w-4 text-primary" />
                Stage Overrides
                {hasActiveOverrides && (
                  <Badge tone="info" size="sm">
                    {stageOverrides.filter(o => o.skip).length} skipped
                  </Badge>
                )}
              </Button>

              {showStageOverrides && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs text-muted-foreground">
                    Toggle stages to skip or configure per-stage overrides.
                  </p>
                  {stageOverrides.map((override, index) => (
                    <div
                      key={override.stageName}
                      className={cn(
                        'flex items-center gap-3 rounded-md border px-3 py-2 text-sm',
                        override.skip
                          ? 'border-warning/40 bg-warning-muted'
                          : 'border-border bg-background',
                      )}
                    >
                      <Checkbox
                        checked={!override.skip}
                        aria-label={`Run stage ${index + 1}: ${override.stageName}`}
                        onCheckedChange={() => toggleStageSkip(index)}
                        className="h-4 w-4"
                        title={override.skip ? 'Enable this stage' : 'Skip this stage'}
                      />
                      <span className={cn(
                        'flex-1 text-sm',
                        override.skip ? 'text-muted-foreground line-through' : 'text-foreground',
                      )}>
                        {index + 1}. {override.stageName}
                      </span>
                      {override.skip && (
                        <span className="text-[10px] font-medium text-warning">SKIP</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Upload section inside the form */}
          <UploadSection
            uploadCategory={uploadCategory}
            setUploadCategory={setUploadCategory}
            uploadedFiles={uploadedFiles}
            fileInputRef={fileInputRef}
            handleFilesSelected={handleFilesSelected}
            removeFile={removeFile}
          />
      </form>
    </Modal>
  );
}

// ── Upload Section Component ──
const CATEGORY_LABELS: Record<UploadCategory, string> = {
  prompts: 'Prompt templates (.md, .txt, .prompt)',
  skills: 'Skill definitions (.md)',
  agents: 'Agent definitions (.md, .json)',
};

function UploadSection({
  uploadCategory,
  setUploadCategory,
  uploadedFiles,
  fileInputRef,
  handleFilesSelected,
  removeFile,
}: {
  uploadCategory: UploadCategory;
  setUploadCategory: (c: UploadCategory) => void;
  uploadedFiles: UploadedFileSet;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFilesSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  removeFile: (category: UploadCategory, index: number) => void;
}) {
  const totalFiles = uploadedFiles.prompts.length + uploadedFiles.skills.length + uploadedFiles.agents.length;

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Upload className="h-4 w-4 text-done" />
        Custom Content
        {totalFiles > 0 && (
          <Badge tone="done" size="sm">
            {totalFiles}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Optionally upload prompts, skills, or agent definitions for this run.
      </p>

      {/* Category tabs */}
      <div className="flex gap-1">
        {(['prompts', 'skills', 'agents'] as UploadCategory[]).map((cat) => (
          <Button
            key={cat}
            type="button"
            onClick={() => setUploadCategory(cat)}
            variant="ghost"
            size="sm"
            className={cn(
              'h-auto rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
              uploadCategory === cat
                ? 'bg-primary text-primary-foreground hover:bg-primary'
                : 'bg-subtle text-muted-foreground hover:bg-subtle',
            )}
          >
            {cat}
            {uploadedFiles[cat].length > 0 && ` (${uploadedFiles[cat].length})`}
          </Button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        {CATEGORY_LABELS[uploadCategory]}
      </p>

      {/* File picker */}
      <div>
        <Input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".md,.txt,.json,.yaml,.yml,.toml,.ts,.js,.py,.sh,.prompt"
          onChange={handleFilesSelected}
          className="hidden"
        />
        <Button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          variant="ghost"
          size="sm"
          className="h-auto flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-subtle"
        >
          <Upload className="h-3.5 w-3.5" />
          Add {uploadCategory} files
        </Button>
      </div>

      {/* File list for selected category */}
      {uploadedFiles[uploadCategory].length > 0 && (
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {uploadedFiles[uploadCategory].map((file, i) => (
            <li key={`${file.name}-${i}`} className="flex items-center gap-2 rounded px-2 py-1 text-xs bg-subtle">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 truncate text-foreground">{file.name}</span>
              <Button type="button" onClick={() => removeFile(uploadCategory, i)} variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} className="h-auto w-auto p-0 text-muted-foreground hover:bg-transparent hover:text-danger">
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
