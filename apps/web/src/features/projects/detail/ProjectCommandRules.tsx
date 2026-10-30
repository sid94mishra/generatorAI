// ────────────────────────────────────────────────────────────────
// Project settings · Commands agents run without asking (D-157). The
// project's permission rules (D-153: "Allow … for this project" on any card
// of its chats and runs stores them here) — each removable — plus the
// project's own test / lint / build scripts suggested for one-click
// allowing, and any other command typed in. Risky commands are refused by
// the server and keep asking.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import {
  useAddProjectCommandRules,
  useClearProjectPermissionRules,
  useProjectCommandSuggestions,
  useProjectPermissionRules,
  useRevokeProjectPermissionRule,
} from '@/hooks/queries.js';
import { SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Input } from '@/ui/primitives/Input/Input.js';

export function ProjectCommandRules({ projectId }: { projectId: string }) {
  const rules = useProjectPermissionRules(projectId);
  const suggestions = useProjectCommandSuggestions(projectId);
  const add = useAddProjectCommandRules(projectId);
  const revoke = useRevokeProjectPermissionRule(projectId);
  const clear = useClearProjectPermissionRules(projectId);
  const [draft, setDraft] = useState('');

  const stored = rules.data ?? [];
  const allowed = new Set(stored.map((r) => r.match));
  const offered = (suggestions.data ?? []).filter((s) => !allowed.has(s.command));
  const submit = () => {
    const command = draft.trim();
    if (!command) return;
    add.mutate([command], { onSuccess: () => setDraft('') });
  };

  return (
    <SettingsSection
      title="Commands agents run without asking"
      description="Every chat and workflow run in this project runs these without an approval card. Risky commands (git push, sudo, deleting outside the folder…) always ask."
    >
      <div className="flex flex-col gap-3" data-testid="project-command-rules">
        {stored.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {stored.map((r) => (
              <Chip key={r.id} mono size="sm" onRemove={() => revoke.mutate(r.id)} removeLabel={`Stop allowing ${r.match}`}>
                {r.match}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-small text-fg-3">None yet. “Allow … for this project” on an approval card adds the command here.</p>
        )}
        {offered.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-small text-fg-3">From the project’s scripts:</span>
            {offered.map((s) => (
              <Chip key={s.command} mono size="sm" variant="ghost" icon="plus" title={s.source} onClick={() => add.mutate([s.command])}>
                {s.command}
              </Chip>
            ))}
            {offered.length > 1 ? (
              <Button size="sm" variant="ghost" loading={add.isPending} onClick={() => add.mutate(offered.map((s) => s.command))}>
                Allow all
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Input
            mono
            size="sm"
            aria-label="Command to allow"
            placeholder="e.g. pnpm test"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            spellCheck={false}
            className="w-72"
          />
          <Button size="sm" disabled={!draft.trim()} loading={add.isPending} onClick={submit}>
            Allow
          </Button>
          {stored.length > 0 ? (
            <Button size="sm" variant="ghost" loading={clear.isPending} onClick={() => clear.mutate()}>
              Clear all
            </Button>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  );
}
