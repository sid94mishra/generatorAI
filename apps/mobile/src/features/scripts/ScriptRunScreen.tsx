// Run script (`/scripts/[id]/run?profile=`, a route sheet; footer `lg` "Run", MD-85): the profile, an optional
// project, one field per declared input pre-filled from the profile; Run starts one invocation and replaces the sheet
// with the new run (under its workflow, MD-80).
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';

import { runHref } from '../../blocks/shell/hrefs';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { errorText } from '../../ui/lib/format';
import { RouteSheet } from '../../ui/native/Sheet';
import { Select } from '../../ui/native/Select';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { Field } from '../../ui/primitives/Field';
import { Input } from '../../ui/primitives/Input';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { useIdempotencyKey } from '../../services/api/useIdempotencyKey';
import { missingRequired, variableFields, variablesBody, type VariableField } from './model/scriptView';
import { useProjectsList, useRunScript, useScript, useScriptProfiles } from './queries';

type Href = Parameters<typeof router.replace>[0];

export default function ScriptRunScreen(): React.ReactElement {
  const { id = '', profile: profileParam } = useLocalSearchParams<{ id: string; profile?: string }>();
  const navigation = useNavigation();
  const script = useScript(id);
  const profiles = useScriptProfiles(id);
  const projects = useProjectsList();
  const run = useRunScript(id);
  const [profileName, setProfile] = useState<string | null>(profileParam ?? null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const idempotency = useIdempotencyKey();
  const profile = (profiles.data ?? []).find((p) => p.name === profileName) ?? null;
  const fields = useMemo<VariableField[]>(
    () => variableFields(script.data?.meta ?? { variables: [] }, profile?.variables).map((f) => (f.name in values ? { ...f, value: values[f.name]! } : f)),
    [script.data?.meta, profile, values],
  );
  const missing = missingRequired(fields);
  const close = (): void => {
    if (router.canGoBack()) router.back();
  };
  const submit = (): void => {
    setTouched(true);
    if (missing.length) return;
    run.mutate(
      { variables: variablesBody(fields), profile: profileName, projectId, idempotencyKey: idempotency.get() },
      {
        onSettled: (_r, e) => idempotency.settle(e ?? undefined),
        onSuccess: (r) => {
          haptic('success');
          router.replace(runHref(r.workflowDefinitionId, r.runId) as Href);
        },
        onError: (e) => toast({ kind: 'error', message: errorText(e) }),
      },
    );
  };
  return (
    <RouteSheet
      title="Run script"
      {...(script.data ? { subtitle: script.data.meta.name } : {})}
      onDismiss={close}
      scrollable
      navigation={navigation as never}
      footer={<Button label="Run" icon="play" variant="primary" size="lg" fullWidth loading={run.isPending} onPress={submit} testID="script-run-submit" />}
      testID="script-run-sheet"
    >
      {script.isLoading ? (
        <Skeleton preset="list" count={4} />
      ) : (
        <View className="gap-4">
          {(profiles.data ?? []).length ? (
            <Select label="Profile" value={profileName} placeholder="None" options={(profiles.data ?? []).map((p) => ({ value: p.name, label: p.name, ...(p.description ? { description: p.description } : {}) }))} onValueChange={setProfile} presentation="field" testID="script-run-profile" />
          ) : null}
          <Select label="Project (optional)" value={projectId} placeholder="No project" options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} onValueChange={setProjectId} presentation="field" />
          {fields.length ? (
            <View className="gap-3">
              <Text role="subhead" weight={600}>
                Inputs
              </Text>
              {fields.map((f) =>
                f.type === 'boolean' ? (
                  <ListSection key={f.name}>
                    <ListRow kind="toggle" title={f.label} switchValue={f.value === 'true'} onValueChange={(v) => setValues({ ...values, [f.name]: String(v) })} />
                  </ListSection>
                ) : (
                  <Field key={f.name} required={f.required} {...(touched && f.required && !f.value.trim() ? { error: `${f.label} is required.` } : {})}>
                    <Input label={f.label} value={f.value} onChangeText={(v) => setValues({ ...values, [f.name]: v })} kind={f.type === 'number' ? 'number' : 'mono'} presentation="standalone" testID={`script-run-var-${f.name}`} />
                  </Field>
                ),
              )}
            </View>
          ) : (
            <Text role="footnote" tone="fg-3">
              This script declares no inputs.
            </Text>
          )}
        </View>
      )}
    </RouteSheet>
  );
}
