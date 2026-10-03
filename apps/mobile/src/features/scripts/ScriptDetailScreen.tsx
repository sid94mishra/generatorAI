// Script (MScriptDetail; `/scripts/[id]`): breadcrumb "Scripts", the file name; the title, description and tags; the
// run profile (segments ≤ 4, else a Select) with what it pre-fills; Run script (→ the run sheet with that profile) and
// Materialize as draft (a Draft workflow, then its screen); the stage outline (loops as groups, children indented;
// agent and approval when the graph says so) and the edges.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { SCRIPTS_HREF, workflowHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { errorText } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import { Header } from '../../ui/native/router/Header';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { Select } from '../../ui/native/Select';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Chip } from '../../ui/primitives/Chip';
import { Icon } from '../../ui/primitives/Icon';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { profileSummary } from './model';
import { edgeChips, fileName, stageOutline } from './model/scriptView';
import { useScript, useScriptProfiles, useScriptWrites } from './queries';

type Href = Parameters<typeof router.push>[0];

export default function ScriptDetailScreen(): React.ReactElement {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const onBack = useHeaderBack();
  const breadcrumb = useBreadcrumb(useMemo(() => [{ label: 'Scripts', href: SCRIPTS_HREF }], []));
  const scopes = useGrantedScopes();
  const canRun = checkFeature('scriptRun', scopes).available;
  const canMaterialize = scopes.includes('write:workflows');
  const script = useScript(id);
  const profiles = useScriptProfiles(id);
  const writes = useScriptWrites(id);
  const [profileName, setProfile] = useState<string | null>(null);
  const meta = script.data?.meta;
  const stages = useMemo(() => stageOutline(script.data?.graph), [script.data?.graph]);
  const edges = useMemo(() => edgeChips(script.data?.graph), [script.data?.graph]);
  const list = profiles.data ?? [];
  const profile = list.find((p) => p.name === (profileName ?? list[0]?.name)) ?? null;
  const loops = stages.filter((s) => s.kind === 'loop').length;

  const materialize = (): void =>
    void confirm({ title: 'Materialize as a draft workflow?', message: 'Saves this script as a Draft workflow you can open in the builder. The script itself stays as it is.', confirmLabel: 'Materialize', destructive: false }).then((ok) => {
      if (!ok) return;
      writes
        .materialize()
        .then((r) => router.push(workflowHref(r.definitionId) as Href))
        .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
    });

  const state = script.isLoading ? { kind: 'loading' as const } : script.isError || !meta ? { kind: 'error' as const, error: script.error, onRetry: () => void script.refetch(), title: "Couldn't load this script" } : { kind: 'ready' as const };
  return (
    <Screen header={<Header role="detail" title={meta ? fileName(meta) : 'Script'} breadcrumb={breadcrumb} onBack={onBack} />} state={state} onRefresh={async () => void (await Promise.all([script.refetch(), profiles.refetch()]))} testID="script-detail">
      {meta ? (
        <View className="gap-5 pb-8 pt-2">
          <View className="gap-2 px-4">
            <Text role="title" weight={600}>
              {meta.name}
            </Text>
            {meta.description ? (
              <Text role="body" tone="fg-2">
                {meta.description}
              </Text>
            ) : null}
            {meta.tags?.length ? (
              <View className="flex-row flex-wrap gap-1.5">
                {meta.tags.map((t) => (
                  <Badge key={t} label={t} tone="outline" size="sm" />
                ))}
              </View>
            ) : null}
          </View>
          {list.length ? (
            <View className="gap-2 px-4">
              <Text role="subhead" weight={600}>
                Run profile
              </Text>
              {list.length <= 4 ? (
                <SegmentedControl accessibilityLabel="Run profile" value={profile?.name ?? ''} onValueChange={setProfile} segments={list.map((p) => ({ value: p.name, label: p.name }))} fullWidth testID="script-profile" />
              ) : (
                <Select label="Run profile" value={profile?.name ?? null} options={list.map((p) => ({ value: p.name, label: p.name, ...(p.description ? { description: p.description } : {}) }))} onValueChange={setProfile} presentation="field" testID="script-profile" />
              )}
              {profile ? (
                <Text role="footnote" tone="fg-3">
                  {[profileSummary(profile), ...Object.entries(profile.variables).map(([k, v]) => `${k}=${String(v)}`)].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View className="flex-row gap-2 px-4">
            <View className="flex-1">
              <Button
                label="Run script"
                icon="play"
                variant="primary"
                fullWidth
                disabled={!canRun}
                {...(!canRun ? { disabledReason: 'Running a script needs write:workflows and exec:agent.' } : {})}
                onPress={() => router.push(`/scripts/${encodeURIComponent(id)}/run${profile ? `?profile=${encodeURIComponent(profile.name)}` : ''}` as Href)}
                testID="script-run"
              />
            </View>
            {canMaterialize ? (
              <View className="flex-1">
                <Button label="Materialize as draft" icon="layers" fullWidth onPress={materialize} testID="script-materialize" />
              </View>
            ) : null}
          </View>
          <ListSection title="Stages" count={stages.filter((s) => s.depth === 0).length} {...(loops ? { footer: `${loops} loop${loops === 1 ? '' : 's'}` } : {})}>
            {stages.map((s) => (
              <View key={s.key} className="min-h-row flex-row items-center gap-3 px-4 py-2" style={{ paddingStart: 16 + s.depth * 20 }} accessible accessibilityLabel={[s.index ? `Stage ${s.index}` : 'Inside the loop', s.name, s.detail, s.agent ? `agent ${s.agent}` : null, s.approval ? 'needs approval' : null].filter(Boolean).join(', ')}>
                <Text role="monoSm" tone="fg-3">
                  {s.index ? String(s.index) : ' '}
                </Text>
                <View className="flex-1 gap-0.5">
                  <View className="flex-row flex-wrap items-baseline gap-x-2">
                    <Text role="subhead" weight={600}>
                      {s.name}
                    </Text>
                    <Text role="monoSm" tone="fg-3">
                      {s.key}
                    </Text>
                  </View>
                  {s.detail || s.agent ? (
                    <View className="flex-row items-center gap-1">
                      <Icon concept={s.kind === 'loop' ? 'repeat' : 'agents'} size={12} tone="fg-3" />
                      <Text role="footnote" tone="fg-3">
                        {s.detail ?? s.agent}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {s.approval ? <Badge label="Approval" icon="hand" size="sm" /> : null}
              </View>
            ))}
          </ListSection>
          {edges.length ? (
            <View className="gap-2 px-4">
              <Text role="subhead" weight={600}>{`Edges · ${edges.length}`}</Text>
              <View className="flex-row flex-wrap gap-2">
                {edges.map((e) => (
                  <Chip key={e} label={e} />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
