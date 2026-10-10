// ────────────────────────────────────────────────────────────────
// CodebaseDraftFields — the "add a codebase" field set (F-projects-03 inline
// form; mobile MAddCodebase / MProjectCreate content): Source seg Git remote /
// Local git / Local folder, Alias, Repository URL or Local path (+ Browse on
// the server host), Default branch, Subdirectory (optional). Shared by the
// Codebases tab's AddCodebaseCard and CreateProjectPage's repository rows.
// ────────────────────────────────────────────────────────────────

import type { CodebaseType } from '@generatorai/shared';
import { useFolderPicker } from '@/blocks/directory-browser/useFolderPicker.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { CODEBASE_TYPE_HINT, CODEBASE_TYPE_ITEMS } from './projectFormat.js';

export interface CodebaseDraft {
  alias: string;
  type: CodebaseType;
  url: string;
  localPath: string;
  branch: string;
  subdirectory: string;
}

export function emptyCodebaseDraft(): CodebaseDraft {
  return { alias: '', type: 'git-remote', url: '', localPath: '', branch: '', subdirectory: '' };
}

/** What is still missing, or null when the draft can be linked. */
export function codebaseDraftProblem(draft: CodebaseDraft): string | null {
  if (!draft.alias.trim()) return 'Give the codebase an alias.';
  if (draft.type === 'git-remote' ? !draft.url.trim() : !draft.localPath.trim()) {
    return draft.type === 'git-remote' ? 'Enter the repository URL.' : 'Choose the local path.';
  }
  return null;
}

/** The `useLinkCodebase` payload (without `projectId`). */
export function codebaseLinkParams(draft: CodebaseDraft) {
  const remote = draft.type === 'git-remote';
  return {
    alias: draft.alias.trim(),
    type: draft.type,
    ...(remote ? { url: draft.url.trim() } : { localPath: draft.localPath.trim() }),
    ...(draft.branch.trim() ? { defaultBranch: draft.branch.trim() } : {}),
    ...(draft.subdirectory.trim() ? { subdirectory: draft.subdirectory.trim() } : {}),
  };
}

export interface CodebaseDraftFieldsProps {
  draft: CodebaseDraft;
  onChange: (patch: Partial<CodebaseDraft>) => void;
  /** Accessible name prefix for the Source seg when several rows share a page. */
  label?: string;
}

/** The field grid for one codebase draft. */
export function CodebaseDraftFields({ draft, onChange, label = 'Source' }: CodebaseDraftFieldsProps) {
  const folderPicker = useFolderPicker({
    onPick: (picked) => onChange({ localPath: picked }),
    initialPath: draft.localPath || undefined,
  });
  const remote = draft.type === 'git-remote';
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2 flex flex-col gap-1.5">
        <span className="text-small font-medium text-fg-2">Source</span>
        <SegmentedControl<CodebaseType>
          value={draft.type}
          onValueChange={(type) => onChange({ type })}
          items={CODEBASE_TYPE_ITEMS}
          label={label}
          className="self-start"
        />
        <span className="text-small text-fg-3">{CODEBASE_TYPE_HINT[draft.type]}</span>
      </div>
      <Field label="Alias">
        <Input value={draft.alias} onChange={(e) => onChange({ alias: e.target.value })} placeholder="frontend" />
      </Field>
      <Field label="Default branch" optional>
        <Input mono value={draft.branch} onChange={(e) => onChange({ branch: e.target.value })} placeholder="main" />
      </Field>
      {remote ? (
        <Field label="Repository URL" className="col-span-2">
          <Input
            mono
            value={draft.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://github.com/org/repo.git"
          />
        </Field>
      ) : (
        <Field label="Local path" className="col-span-2" hint="A folder on the server machine.">
          <div className="flex gap-2">
            <Input
              mono
              className="flex-1"
              value={draft.localPath}
              onChange={(e) => onChange({ localPath: e.target.value })}
              placeholder="/path/to/repo"
            />
            <Button icon="folder-open" onClick={() => void folderPicker.open()}>
              Browse
            </Button>
          </div>
        </Field>
      )}
      <Field label="Subdirectory" optional className="col-span-2">
        <Input
          mono
          value={draft.subdirectory}
          onChange={(e) => onChange({ subdirectory: e.target.value })}
          placeholder="services/ledger"
        />
      </Field>
      {folderPicker.dialog}
    </div>
  );
}
