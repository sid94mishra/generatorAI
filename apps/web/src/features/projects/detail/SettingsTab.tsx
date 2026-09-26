// ────────────────────────────────────────────────────────────────
// ProjectDetail · Settings (P5-04; F-projects-08; 04 §4.5 #50; mobile
// MProjectSettings content). Worktrees (retention, max codebases; Save when
// dirty), Location (root path, created), Project (Archive / Unarchive,
// Delete project… — the confirmation names what goes with it).
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Project, WorktreeRetentionPolicy } from '@generatorai/shared';
import { useDeleteProject, useUpdateProject } from '@/hooks/projectQueries.js';
import { SettingRow, SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import {
  DEFAULT_MAX_CODEBASES,
  DEFAULT_RETENTION,
  MAX_CODEBASES_LIMIT,
  RETENTION_OPTIONS,
  plural,
  retentionHint,
} from '../projectFormat.js';

export function SettingsTab({ project }: { project: Project }) {
  const navigate = useNavigate();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const confirmer = useConfirm();

  const savedRetention = project.settings?.worktreeRetention ?? DEFAULT_RETENTION;
  const savedMax = project.settings?.maxCodebases ?? DEFAULT_MAX_CODEBASES;
  const [retention, setRetention] = useState<WorktreeRetentionPolicy>(savedRetention);
  const [maxCodebases, setMaxCodebases] = useState(savedMax);
  // Re-sync after a save refetches the project.
  useEffect(() => {
    setRetention(savedRetention);
    setMaxCodebases(savedMax);
  }, [savedRetention, savedMax]);
  const dirty = retention !== savedRetention || maxCodebases !== savedMax;
  const archived = project.status === 'archived';

  const save = () =>
    updateProject.mutate(
      { id: project.id, settings: { worktreeRetention: retention, maxCodebases } },
      { onError: (err) => toast.error("Couldn't save the settings", { description: err instanceof Error ? err.message : String(err) }) },
    );

  const toggleArchive = () =>
    updateProject.mutate(
      { id: project.id, status: archived ? 'active' : 'archived' },
      { onError: (err) => toast.error(`Couldn't ${archived ? 'unarchive' : 'archive'} the project`, { description: String(err) }) },
    );

  const remove = async () => {
    const s = project.summary;
    const ok = await confirmer.confirm({
      title: `Delete ${project.name}?`,
      description: (
        <>
          This permanently deletes the project and all its codebases, configs and worktrees. It can’t be undone.
          {s ? (
            <span className="mt-2 block font-mono text-small text-fg-3">
              {plural(s.codebases, 'codebase')} · {plural(s.worktrees.active + s.worktrees.orphaned, 'worktree')}
              {s.needsYou ? ` · ${s.needsYou} need${s.needsYou === 1 ? 's' : ''} you` : ''}
            </span>
          ) : null}
        </>
      ),
      confirmLabel: 'Delete project',
    });
    if (!ok) return;
    try {
      await deleteProject.mutateAsync(project.id);
      navigate('/projects');
    } catch (err) {
      toast.error("Couldn't delete the project", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="flex max-w-180 flex-col gap-10">
      <SettingsSection title="Worktrees" description={retentionHint(retention)}>
        <div>
          <SettingRow
            label="Retention"
            hint="How long a completed chat's or run's worktree is kept."
            control={
              <Select
                aria-label="Worktree retention"
                value={retention}
                onValueChange={(v) => v && setRetention(v as WorktreeRetentionPolicy)}
                items={RETENTION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                className="w-52"
              />
            }
          />
          <SettingRow
            label="Max codebases"
            hint={`1–${MAX_CODEBASES_LIMIT}`}
            control={
              <NumberField
                aria-label="Max codebases"
                value={maxCodebases}
                min={1}
                max={MAX_CODEBASES_LIMIT}
                onValueChange={(v) => setMaxCodebases(Math.max(1, Math.min(MAX_CODEBASES_LIMIT, v ?? 1)))}
                className="w-24"
              />
            }
          />
        </div>
        <div className="flex justify-end gap-2">
          {dirty ? (
            <Button
              onClick={() => {
                setRetention(savedRetention);
                setMaxCodebases(savedMax);
              }}
            >
              Discard
            </Button>
          ) : null}
          <Button variant="primary" disabled={!dirty} loading={updateProject.isPending && dirty} onClick={save}>
            Save settings
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="Location">
        <div>
          <SettingRow label="Root path" control={<span className="font-mono text-small text-fg-2">{project.rootPath}</span>} />
          <SettingRow label="Created" control={<span className="text-small text-fg-2">{new Date(project.createdAt).toLocaleString()}</span>} />
        </div>
      </SettingsSection>

      <SettingsSection title="Project">
        <div>
          <SettingRow
            label={archived ? 'Unarchive project' : 'Archive project'}
            hint={archived ? 'Moves it back to Active.' : 'Moves it to Archived; codebases and worktrees stay.'}
            control={
              <Button icon={archived ? 'undo' : 'archive'} onClick={toggleArchive}>
                {archived ? 'Unarchive' : 'Archive'}
              </Button>
            }
          />
          <SettingRow
            label="Delete project"
            hint="Removes codebases, configs and worktrees."
            control={
              <Button variant="danger" icon="trash" onClick={() => void remove()}>
                Delete project…
              </Button>
            }
          />
        </div>
      </SettingsSection>
      {confirmer.dialog}
    </div>
  );
}
