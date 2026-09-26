// ────────────────────────────────────────────────────────────────
// F-settings-08 Templates (04 §3.1). Start a new workflow from a
// ready-made template. `isError` is read deliberately: a failed fetch must
// not read as an empty catalog with no way to recover.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTemplates } from '@/hooks/queries.js';
import { useCreateFromTemplate } from '@/hooks/workflowQueries.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Icon } from '@/ui/icons/Icon.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';

export function TemplatesSection() {
  const { data: templates, isLoading, isError, refetch, isFetching } = useTemplates();
  const createFromTemplate = useCreateFromTemplate();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const listAll = templates ?? [];
    if (!q.trim()) return listAll;
    const s = q.toLowerCase();
    return listAll.filter((t) => t.name.toLowerCase().includes(s) || t.description.toLowerCase().includes(s));
  }, [templates, q]);

  return (
    <SettingsSection title="Templates" description="Start a new workflow from a ready-made template.">
      <SectionHeader
        title={templates ? `${templates.length} templates` : 'Workflow templates'}
        level={3}
        action={
          <div className="ml-auto w-52">
            <SearchInput value={q} onValueChange={setQ} placeholder="Search templates…" label="Search templates" shortcut={null} />
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={14} /> Loading templates…
        </div>
      ) : isError ? (
        <EmptyState
          data-testid="templates-error"
          framed
          tone="error"
          icon="warning"
          title="Couldn't load templates."
          description="The catalog request failed — this is not an empty catalog."
          action={
            <Button variant="secondary" size="sm" loading={isFetching} onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState framed icon="workflows" title="No templates found." />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-card border border-line bg-raised px-3 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-control-sm border border-line bg-sunken text-fg-2">
                <Icon concept="workflows" size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-ui font-medium text-fg">{t.name}</span>
                  <Badge tone="neutral">{t.category}</Badge>
                </div>
                <div className="mt-0.5 line-clamp-2 text-small text-fg-3">{t.description}</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                trailingIcon="chevron-right"
                loading={createFromTemplate.isPending}
                className="shrink-0"
                onClick={async () => {
                  const def = await createFromTemplate.mutateAsync({ templateId: t.id });
                  navigate(`/workflows/${def.id}`);
                }}
              >
                Use
              </Button>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
