// Standing computer grants for this workspace (F-dock-05 "Grants"), with Revoke.

import { COMPUTER_ANY_APP, type ComputerGrant } from '@generatorai/shared';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Icon } from '@/ui/icons/Icon.js';
import { useComputerGrants, useRevokeComputerGrant } from '@/hooks/computerQueries.js';

function scopeWord(scope: ComputerGrant['scope']): string {
  return scope === 'read' ? 'Screen' : 'Keyboard & mouse';
}

export function ComputerGrants({ workspaceId }: { workspaceId: string }) {
  const { data: grants } = useComputerGrants(workspaceId);
  const revoke = useRevokeComputerGrant(workspaceId);
  if (!grants || grants.length === 0) return null;
  return (
    <section aria-label="Grants" className="flex flex-col gap-1 border-t border-line-soft px-3 py-2">
      <SectionHeader level={3} title="Grants" count={grants.length} />
      <ul className="flex flex-col">
        {grants.map((g) => (
          <li
            key={`${g.appIdentity}:${g.scope}`}
            className="flex min-h-row min-w-0 items-center gap-2 border-b border-line-soft last:border-b-0"
          >
            <Icon concept={g.scope === 'read' ? 'view' : 'pointer'} size={14} className="shrink-0 text-fg-3" />
            <span className="min-w-0 truncate text-ui text-fg" title={g.appIdentity}>
              {scopeWord(g.scope)} · {g.appIdentity === COMPUTER_ANY_APP ? 'Any app' : g.appLabel || g.appIdentity}
            </span>
            <span className="min-w-0 flex-1 truncate text-small text-fg-3">
              {g.decision === 'deny' ? 'Denied' : 'Always allowed'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(g.appIdentity)}
              aria-label={`Revoke ${g.appIdentity === COMPUTER_ANY_APP ? 'Any app' : g.appLabel || g.appIdentity}`}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
