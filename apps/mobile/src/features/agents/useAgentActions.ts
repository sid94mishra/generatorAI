// Agent actions shared by the list's long-press menu and the detail screen: Edit, Duplicate (→ the editor seeded from
// the agent), Export .agent.md (the share sheet), Delete (asks where the agent is used first: a real delete when it is
// free, "Disable" — the soft delete — when it is bound, MD-29 / MDF-104).
import { useCallback } from 'react';
import { Share } from 'react-native';
import { router } from 'expo-router';

import { AGENTS_HREF, agentHref } from '../../blocks/shell/hrefs';
import { useAdminApi } from '../../services/api/useAdminApi';
import { errorText } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import { toast } from '../../ui/primitives/Toast';
import { deleteDialog, type AgentMenuId, type UsageLike } from './model/agentsModel';
import { useAgentWrites } from './queries';

type Href = Parameters<typeof router.push>[0];

export function useAgentActions(): (id: AgentMenuId, agent: { id: string; name: string }, opts?: { afterDelete?: () => void }) => void {
  const writes = useAgentWrites();
  const admin = useAdminApi();
  return useCallback(
    (id, agent, opts = {}) => {
      switch (id) {
        case 'edit':
          router.push(`${agentHref(agent.id)}/edit` as Href);
          return;
        case 'duplicate':
          router.push(`/agents/create?from=${encodeURIComponent(`agent:${agent.id}`)}` as Href);
          return;
        case 'export':
          writes
            .export(agent.id)
            .then((markdown) => Share.share({ message: markdown, title: `${agent.name}.agent.md` }))
            .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
          return;
        case 'delete':
          void (async () => {
            const usage = (await admin.agents.usage(encodeURIComponent(agent.id)).catch(() => null)) as UsageLike | null;
            const dialog = deleteDialog(agent.name, usage);
            const ok = await confirm({ title: dialog.title, message: dialog.message, impact: dialog.impact, confirmLabel: dialog.confirmLabel, icon: 'trash' });
            if (!ok) return;
            try {
              await writes.remove(agent.id, dialog.force);
              if (opts.afterDelete) opts.afterDelete();
              else if (router.canGoBack()) router.back();
              else router.replace(AGENTS_HREF as Href);
            } catch (e) {
              toast({ kind: 'error', message: errorText(e) });
            }
          })();
      }
    },
    [writes, admin],
  );
}
