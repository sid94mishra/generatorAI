// Settings › Extensions (MSetExtensions, MDF-119; `/settings/extensions`, header Install + Reload all): "Installed n";
// one row per extension (name, scope · id in mono, state); a built-in shows a lock and "On · built in" instead of a
// disabled switch (announced "On, can't be turned off"); a row opens the detail sheet (id@version, description,
// scope and state badges, where it is installed, Enabled, Reload, Uninstall… with confirmation, load errors). Install
// takes a **server** path in the sheet. Writes need `admin:settings` and a step-up.
import React, { useState } from 'react';
import { View } from 'react-native';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { confirm } from '../../ui/native/AlertDialog';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { Icon } from '../../ui/primitives/Icon';
import { Input } from '../../ui/primitives/Input';
import { Pressable } from '../../ui/primitives/Pressable';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';
import { SettingsPage } from './components/SettingsPage';
import { SCOPE_LABEL, extensionState, isBuiltIn, type ExtensionRow } from './extensionModel';
import { useExtensionWrites, useExtensions } from './queries';
import { adminWrite, useScopeAccess } from './useSettingsAccess';

function ExtensionDetail({ ext, canWrite, onDone }: { ext: ExtensionRow; canWrite: boolean; onDone: () => void }): React.ReactElement {
  const writes = useExtensionWrites();
  const [enabled, setEnabled] = useState(ext.enabled);
  const state = extensionState({ ...ext, enabled });
  const builtIn = isBuiltIn(ext);
  return (
    <View className="gap-4 pb-4">
      <Text role="monoSm" tone="fg-3" selectable>
        {ext.id}
        {ext.version ? `@${ext.version}` : ''}
      </Text>
      {ext.description ? (
        <Text role="body" tone="fg-2">
          {ext.description}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-1.5">
        <Badge label={`${SCOPE_LABEL[ext.scope ?? ''] ?? ext.scope ?? 'Unknown'} scope`} size="sm" />
        <Badge label={state.label} icon={state.health === 'err' ? 'warning' : state.health === 'ok' ? 'check' : undefined} size="sm" />
      </View>
      {ext.rootPath ? (
        <View className="gap-1">
          <Text role="footnote" weight={600} tone="fg-2">
            Installed at
          </Text>
          <View className="rounded-card bg-sunken p-3">
            <Text role="monoSm" selectable>
              {ext.rootPath}
            </Text>
          </View>
        </View>
      ) : null}
      {ext.errors.length ? <Callout tone="err" title="Failed to load" body={ext.errors.join('\n')} /> : null}
      {builtIn ? (
        <ListRow kind="info" icon="lock" title="Enabled" value="On · built in" />
      ) : (
        <ListRow
          kind="toggle"
          title="Enabled"
          switchValue={enabled}
          disabled={!canWrite}
          onValueChange={(v) => {
            setEnabled(v);
            void adminWrite(`${v ? 'Enable' : 'Disable'} ${ext.name}`, async () => {
              await writes.setEnabled(ext.id, v);
              return true;
            }).then((ok) => {
              if (!ok) setEnabled(!v);
            });
          }}
          testID="extension-enabled"
        />
      )}
      {canWrite ? (
        <View className="flex-row gap-3">
          {!builtIn ? (
            <View className="flex-1">
              <Button
                label="Uninstall"
                icon="trash"
                variant="destructive"
                fullWidth
                onPress={() =>
                  void confirm({ title: `Uninstall ${ext.name}?`, message: 'Deletes the extension folder from its scope. Its widgets and tools go away.', confirmLabel: 'Uninstall', destructive: true }).then(
                    (ok) =>
                      ok &&
                      void adminWrite(`Uninstall ${ext.name}`, async () => {
                        await writes.uninstall(ext.id);
                        return true;
                      }).then((done) => done && onDone()),
                  )
                }
                testID="extension-uninstall"
              />
            </View>
          ) : null}
          <View className="flex-1">
            <Button label="Reload" icon="refresh" variant="secondary" fullWidth onPress={() => void adminWrite(`Reload ${ext.name}`, () => writes.reload(ext.id)).then(() => haptic('success'))} testID="extension-reload" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function InstallForm({ onDone }: { onDone: () => void }): React.ReactElement {
  const writes = useExtensionWrites();
  const [path, setPath] = useState('');
  const [scope, setScope] = useState<'user' | 'workspace'>('user');
  const [busy, setBusy] = useState(false);
  const install = (): void => {
    if (!path.trim()) return;
    setBusy(true);
    void adminWrite('Install an extension', async () => {
      await writes.install(path.trim(), scope);
      return true;
    })
      .then((ok) => {
        if (!ok) return;
        haptic('success');
        onDone();
      })
      .finally(() => setBusy(false));
  };
  return (
    <View className="gap-4 pb-4">
      <Input label="Folder on the server" kind="mono" value={path} onChangeText={setPath} placeholder="/path/to/extension" presentation="standalone" autoFocus testID="extension-install-path" />
      <Text role="footnote" tone="fg-3">
        A folder on the machine running GeneratorAI that holds an extension.json. It is copied into the scope and loaded at once.
      </Text>
      <SegmentedControl accessibilityLabel="Scope" value={scope} onValueChange={setScope} segments={[{ value: 'user', label: 'User' }, { value: 'workspace', label: 'Workspace' }]} fullWidth />
      <Button label="Install" size="lg" fullWidth loading={busy} disabled={!path.trim()} onPress={install} testID="extension-install" />
    </View>
  );
}

function ExtensionListRow({ ext, onPress }: { ext: ExtensionRow; onPress: () => void }): React.ReactElement {
  const state = extensionState(ext);
  const builtIn = isBuiltIn(ext);
  return (
    <Pressable
      onPress={onPress}
      frame="none"
      accessibilityRole="button"
      accessibilityLabel={`${ext.name}, ${SCOPE_LABEL[ext.scope ?? ''] ?? ''}, ${builtIn ? "on, can't be turned off" : state.label}`}
      className="min-h-row-2 flex-row items-center gap-3 px-4 py-3"
      testID={`extension-row-${ext.id}`}
    >
      <Icon concept="layers" tone={ext.enabled ? 'fg-2' : 'fg-3'} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text role="body" tone={ext.enabled ? 'fg' : 'fg-3'} numberOfLines={1}>
          {ext.name}
        </Text>
        <Text role="monoSm" tone="fg-3" numberOfLines={1}>
          {`${SCOPE_LABEL[ext.scope ?? ''] ?? ext.scope ?? ''} · ${ext.id}`}
        </Text>
      </View>
      {builtIn ? (
        <View className="flex-row items-center gap-1">
          <Icon concept="lock" size={14} tone="fg-3" />
          <Text role="footnote" tone="fg-3">
            On
          </Text>
        </View>
      ) : (
        <View className="flex-row items-center gap-1.5">
          <StatusDot health={state.health} size="sm" />
          <Text role="footnote" tone="fg-2">
            {state.label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export default function ExtensionsScreen(): React.ReactElement {
  const extensions = useExtensions();
  const writes = useExtensionWrites();
  const access = useScopeAccess('admin:settings', 'Manage extensions from this device');
  const sheet = useSheet();
  const list = extensions.data ?? [];

  const open = (ext: ExtensionRow): void => sheet.present(<ExtensionDetail ext={ext} canWrite={access.granted} onDone={() => sheet.dismiss()} />, { title: ext.name, detents: ['medium', 'large'], scrollable: true, testID: 'extension-sheet' });
  const install = (): void => sheet.present(<InstallForm onDone={() => sheet.dismiss()} />, { title: 'Install from a path', detents: ['large'], testID: 'extension-install-sheet' });

  return (
    <SettingsPage
      title="Extensions"
      actions={access.granted ? [
        { id: 'install', icon: 'plus', label: 'Install extension', onPress: install, testID: 'extensions-install' },
        { id: 'reload', icon: 'refresh', label: 'Reload all', onPress: () => void adminWrite('Reload every extension', writes.reloadAll).then(() => haptic('success')), testID: 'extensions-reload' },
      ] : []}
      onRefresh={async () => void (await extensions.refetch())}
      state={extensions.isError && !extensions.data ? { kind: 'error', error: extensions.error, onRetry: () => void extensions.refetch(), title: "Couldn't load extensions" } : { kind: 'ready' }}
      testID="settings-extensions-screen"
    >
      {!access.granted ? (
        <ListSection>
          <ListRow kind="requires-admin" icon="layers" title="Install and switch extensions" onPress={access.request} testID="extensions-requires-admin" />
        </ListSection>
      ) : null}
      {extensions.isLoading ? (
        <Skeleton preset="list" count={4} />
      ) : list.length === 0 ? (
        <EmptyState compact copyKey="extensions" />
      ) : (
        <ListSection title="Installed" count={list.length} footer="Extensions add widgets, tools, skills, prompts and hooks. Built-in ones can't be turned off. Changes load at once.">
          {list.map((ext) => (
            <ExtensionListRow key={ext.id} ext={ext} onPress={() => open(ext)} />
          ))}
        </ListSection>
      )}
    </SettingsPage>
  );
}

