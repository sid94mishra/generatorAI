// ────────────────────────────────────────────────────────────────
// F-settings-06 Skills (04 §3.1). Built-in skills extend what agents can do.
// A disabled skill is a client preference (`catalogPrefsStore`) that hides
// it from the chat `/` menu and skill pickers everywhere, so it is never
// offered to you or sent to a model.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { useSystemArtifacts, useArtifactContent } from '@/hooks/projectQueries.js';
import { useCatalogPrefsStore } from '@/stores/catalogPrefsStore.js';
import type { ArtifactWithSource } from '@generatorai/shared';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Icon } from '@/ui/icons/Icon.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';
import { CatalogRow } from '../CatalogRow.js';

export function SkillsSection() {
  const { data: skills, isLoading } = useSystemArtifacts('skill');
  const disabledSkills = useCatalogPrefsStore((s) => s.disabledSkills);
  const setSkillEnabled = useCatalogPrefsStore((s) => s.setSkillEnabled);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArtifactWithSource | null>(null);

  const list = useMemo(() => (skills ?? []) as ArtifactWithSource[], [skills]);
  const filtered = useMemo(() => {
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter((a) => a.name.toLowerCase().includes(s) || (a.description ?? '').toLowerCase().includes(s));
  }, [list, q]);

  const enabledCount = list.length - disabledSkills.filter((id) => list.some((a) => a.id === id)).length;

  if (preview) return <SkillPreview artifact={preview} onBack={() => setPreview(null)} />;

  return (
    <SettingsSection
      title="Skills"
      description="Built-in skills extend what agents can do. Disabled skills are excluded from the chat slash menu and skill pickers, so they are never offered to you or sent to models."
    >
      <SectionHeader
        title={skills ? `${enabledCount} of ${list.length} enabled` : 'Built-in skills'}
        level={3}
        action={
          <div className="ml-auto w-52">
            <SearchInput value={q} onValueChange={setQ} placeholder="Search skills…" label="Search skills" shortcut={null} />
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={14} /> Loading skills…
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-small text-fg-3">No skills found.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((a) => {
            const enabled = !disabledSkills.includes(a.id);
            return (
              <CatalogRow
                key={a.id}
                icon="skills"
                title={a.name}
                // System artifacts carry no `source` (the badge rendered empty); this list is the system catalog.
                badges={<Badge tone="neutral">System</Badge>}
                subtitle={a.description}
                disabled={!enabled}
                open={expanded === a.id}
                onOpenChange={(open) => setExpanded(open ? a.id : null)}
                control={
                  <Switch
                    checked={enabled}
                    onCheckedChange={(on) => setSkillEnabled(a.id, on)}
                    aria-label={`${enabled ? 'Disable' : 'Enable'} skill ${a.name}`}
                  />
                }
              >
                <div className="rounded-control-sm border border-line bg-raised px-3 py-2.5">
                  <SectionHeader variant="label" title="Description" />
                  <p className="text-small text-fg-2">{a.description || 'No description provided for this skill.'}</p>
                </div>
                <div className="mt-2.5 flex justify-end">
                  <Button variant="secondary" size="sm" icon="view" onClick={() => setPreview(a)}>
                    Preview full details
                  </Button>
                </div>
              </CatalogRow>
            );
          })}
        </div>
      )}
    </SettingsSection>
  );
}

function SkillPreview({ artifact, onBack }: { artifact: ArtifactWithSource; onBack: () => void }) {
  const { data: content, isLoading } = useArtifactContent(undefined, artifact.id, 'system');
  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" icon="back" className="self-start" onClick={onBack}>
        Back to skills
      </Button>

      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-card border border-line bg-sunken text-fg-2">
          <Icon concept="skills" size={20} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-title text-fg">{artifact.name}</h2>
            <Badge tone="neutral">System</Badge>
          </div>
          {artifact.description ? <p className="mt-0.5 text-small text-fg-3">{artifact.description}</p> : null}
        </div>
      </div>

      <div className="rounded-card border border-line bg-raised p-4">
        <SectionHeader variant="label" title="Full details" />
        {isLoading ? (
          <div className="flex items-center gap-2 text-small text-fg-3">
            <Spinner size={14} /> Loading details…
          </div>
        ) : content ? (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-control-sm bg-sunken px-3 py-2.5 font-mono text-micro text-fg leading-relaxed">
            {content}
          </pre>
        ) : (
          <p className="text-small text-fg-3">No additional details.</p>
        )}
      </div>
    </div>
  );
}
