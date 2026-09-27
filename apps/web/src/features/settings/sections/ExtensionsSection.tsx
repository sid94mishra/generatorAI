// ────────────────────────────────────────────────────────────────
// F-settings-13 Extensions (04 §3.1; content reference MSetExtensions).
// Install (by path), enable/disable, uninstall and hot-reload. All
// operations take effect immediately (server hot-reload). System-scoped
// extensions are read-only here.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { InstalledExtension } from '@generatorai/shared';
import {
  useExtensions,
  useInstallExtension,
  useReloadExtensions,
  useSetExtensionEnabled,
  useUninstallExtension,
} from '@/hooks/extensionQueries.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Icon } from '@/ui/icons/Icon.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Select, type SelectItem } from '@/ui/primitives/Select/Select.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';

const SCOPE_ITEMS: SelectItem[] = [
  { value: 'user', label: 'User scope' },
  { value: 'workspace', label: 'Workspace scope' },
];

function ExtensionRow({ extension, onError }: { extension: InstalledExtension; onError: (message: string) => void }) {
  const setEnabled = useSetExtensionEnabled();
  const uninstall = useUninstallExtension();
  const confirmer = useConfirm();
  const isSystem = extension.scope === 'system';
  const { manifest } = extension;

  const onUninstall = async () => {
    const ok = await confirmer.confirm({
      title: `Uninstall "${manifest.name}"?`,
      description: 'This deletes the extension folder from its scope.',
      confirmLabel: 'Uninstall',
    });
    if (!ok) return;
    uninstall.mutate(manifest.id, { onError: (err) => onError(err instanceof Error ? err.message : String(err)) });
  };

  return (
    <Card>
      <Card.Body>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="flex size-control shrink-0 items-center justify-center rounded-control border border-line bg-selected text-fg-2">
              <Icon concept="tool" size={16} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ui font-medium text-fg">{manifest.name}</span>
                <span className="break-all font-mono text-micro text-fg-3">
                  {manifest.id}@{manifest.version}
                </span>
                <Badge tone={isSystem ? 'run' : 'neutral'} className="capitalize">
                  {extension.scope}
                </Badge>
                {extension.enabled && !extension.ready ? <Badge tone="err">Error</Badge> : null}
                {!extension.enabled ? <Badge>Disabled</Badge> : null}
              </div>
              {manifest.description ? <p className="mt-0.5 text-small text-fg-3">{manifest.description}</p> : null}
              <p className="mt-1 break-all font-mono text-micro text-fg-3">{extension.rootPath}</p>
              {extension.errors && extension.errors.length > 0 ? (
                <p className="mt-1 break-words text-micro text-err">{extension.errors.join('; ')}</p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Switch
              checked={extension.enabled}
              disabled={setEnabled.isPending || isSystem}
              onCheckedChange={(next) => setEnabled.mutate({ id: manifest.id, enabled: next }, { onError: (err) => onError(err instanceof Error ? err.message : String(err)) })}
              aria-label={`${extension.enabled ? 'Disable' : 'Enable'} extension ${manifest.name}`}
            />
            {!isSystem ? (
              <IconButton
                size="sm"
                icon="trash"
                label="Uninstall extension"
                disabled={uninstall.isPending}
                onClick={() => void onUninstall()}
              />
            ) : null}
          </div>
        </div>
      </Card.Body>
      {confirmer.dialog}
    </Card>
  );
}

export function ExtensionsSection() {
  const extensions = useExtensions();
  const install = useInstallExtension();
  const reload = useReloadExtensions();
  const [installPath, setInstallPath] = useState('');
  const [scope, setScope] = useState<'user' | 'workspace'>('user');
  const [error, setError] = useState<string | null>(null);

  const onInstall = () => {
    if (!installPath.trim()) return;
    setError(null);
    install.mutate(
      { path: installPath.trim(), scope },
      {
        onSuccess: () => setInstallPath(''),
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const items = extensions.data ?? [];

  return (
    <SettingsSection title="Extensions" description="Hot-loadable extensions contribute widgets, tools, skills, prompts, and hooks.">
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <SectionHeader title="Install an extension" level={3} />
          <p className="text-small text-fg-3">Absolute path to a folder containing an extension.json. It's copied into the target scope and hot-loaded.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={installPath}
              onChange={(e) => setInstallPath(e.target.value)}
              placeholder="/path/to/extension"
              mono
              className="min-w-0 flex-1"
              aria-label="Extension path"
            />
            <Select aria-label="Install scope" value={scope} onValueChange={(v) => setScope((v as 'user' | 'workspace') ?? 'user')} items={SCOPE_ITEMS} className="w-40" />
            <Button variant="primary" disabled={install.isPending || !installPath.trim()} loading={install.isPending} onClick={onInstall}>
              Install
            </Button>
            <Button icon="refresh" loading={reload.isPending} onClick={() => reload.mutate()}>
              Reload all
            </Button>
          </div>
          {error ? <Callout tone="err">{error}</Callout> : null}
        </section>

        <section className="flex flex-col gap-2">
          <SectionHeader title="Installed" level={3} count={extensions.data ? items.length : undefined} />
          {extensions.isLoading ? (
            <div className="flex items-center gap-2 text-small text-fg-3">
              <Spinner size={14} /> Loading…
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon="tool" title="No extensions installed" framed />
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((extension) => (
                <ExtensionRow key={extension.manifest.id} extension={extension} onError={setError} />
              ))}
            </div>
          )}
        </section>
      </div>
    </SettingsSection>
  );
}
