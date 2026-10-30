// Breadcrumbs from a path (06 §3.3) for screens whose own data does not name their ancestors yet (the legacy
// screens in the M5 shell, MD-141): the module, then the generic names of the real ancestors in between. Labels
// from data arrive with each screen's rewrite; nothing is invented (MD-27). Pure, unit-tested.
import { NAV_DESTINATIONS } from '@generatorai/shared/ui-contract';

import { parentHref } from './parentHref';
import type { CrumbInput } from './useHeaderNav';

const KIND: Record<string, string> = { workflows: 'Workflow', projects: 'Project', chats: 'Chat', automations: 'Automation', scripts: 'Script', agents: 'Agent' };

export function crumbLabel(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const root = parts[0] ?? '';
  const module = NAV_DESTINATIONS.find((d) => d.path === `/${root}`)?.label ?? (root === 'settings' ? 'Settings' : root);
  if (parts.length === 1) return module;
  const kind = parts[parts.length - 2];
  if (kind === 'runs') return 'Run';
  if (kind === 'codebases') return 'Codebase';
  return KIND[root] ?? module;
}

export function pathCrumbs(pathname: string): CrumbInput[] {
  const out: CrumbInput[] = [];
  let path = parentHref(pathname);
  while (path && path !== '/') {
    out.unshift({ label: crumbLabel(path), href: path });
    path = parentHref(path);
  }
  return out;
}
