// ────────────────────────────────────────────────────────────────
// Script — a programmatic workflow (.workflow.mjs): what it runs, the
// profiles it ships with, and a way to run it.
//
// Running a script materialises a fresh definition and starts a run in one
// call (`POST /workflow-scripts/:id/run { profileName, variables,
// projectId }`), so the form mirrors StartRunSheet — one field per declared
// input, pre-filled from the chosen profile — and lands on the new run.
//
// The run route starts agents, so it needs write:workflows AND exec:agent
// (the `runControl` feature), matching the route policy.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCode2, Lock, Play } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { useAdminApi } from '../../src/api/useAdminApi';
import { useApi } from '../../src/api/useApi';
import { useFeature } from '../../src/components/runs/useFeature';
import { usePullRefresh } from '../../src/components/runs/usePullRefresh';
import { STICKY_BAR_SPACE, StickyActionBar } from '../../src/components/work/StickyActionBar';
import { VariableField } from '../../src/components/work/StartRunSheet';
import {
  applyProfileDefaults,
  parseScriptDetail,
  parseScriptProfiles,
  profileSummary,
  scriptRunIdOf,
} from '../../src/components/work/scriptModel';
import { buildVariables, initialDraft, parseVariables, type Draft } from '../../src/components/work/variableForm';
import { Button } from '../../src/components/ui/Button';
import { Chip } from '../../src/components/ui/Chip';
import { Badge, Card, SectionHeader } from '../../src/components/ui/primitives';
import { PlainScroll } from '../../src/components/ui/Screen';
import { SkeletonCard, SkeletonList } from '../../src/components/ui/Skeleton';
import { ErrorState } from '../../src/components/ui/States';
import { haptics } from '../../src/components/ui/haptics';
import { useTheme } from '../../src/theme/ThemeProvider';

const scriptKey = (id: string) => ['workflow-scripts', id] as const;

export default function ScriptScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scriptId = String(id ?? '');
  const admin = useAdminApi();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const runControl = useFeature('runControl');

  const [profileName, setProfileName] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [showErrors, setShowErrors] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const script = useQuery({
    queryKey: scriptKey(scriptId),
    queryFn: async () => parseScriptDetail(await admin.scripts.get(scriptId), scriptId),
    enabled: scriptId.length > 0,
  });

  const profiles = useQuery({
    queryKey: [...scriptKey(scriptId), 'profiles'],
    queryFn: async () => parseScriptProfiles(await admin.scripts.profiles(scriptId)),
    enabled: scriptId.length > 0,
  });

  const projects = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => api.projects.list(),
    staleTime: 60_000,
  });

  const pull = usePullRefresh(() => Promise.all([script.refetch(), profiles.refetch()]));

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: script.data?.name ?? 'Script' });
  }, [navigation, script.data?.name]);

  const profile = useMemo(
    () => (profiles.data ?? []).find((p) => p.name === profileName) ?? null,
    [profiles.data, profileName],
  );
  const defs = useMemo(
    () => parseVariables(applyProfileDefaults(script.data?.variables, profile)),
    [script.data?.variables, profile],
  );

  // Re-seed the inputs whenever the declared variables or the profile change,
  // so choosing a profile visibly fills in what it will send.
  useEffect(() => {
    setDraft(initialDraft(defs));
    setShowErrors(false);
  }, [defs]);

  const result = buildVariables(defs, draft);
  const pickableProjects = (projects.data ?? []).filter(
    (p) => (p as { status?: string }).status !== 'archived',
  );

  const run = useMutation({
    mutationFn: async (): Promise<string> => {
      const response = await admin.scripts.run(scriptId, {
        ...(profileName ? { profileName } : {}),
        variables: result.variables,
        ...(projectId ? { projectId } : {}),
      });
      const runId = scriptRunIdOf(response);
      if (!runId) throw new Error('The server did not return a run.');
      return runId;
    },
    onSuccess: (runId) => {
      haptics.success();
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs() });
      // The run materialised a new definition.
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflows() });
      router.push(`/runs/${runId}`);
    },
    onError: (err) => {
      haptics.error();
      setServerError(err instanceof Error ? err.message : String(err));
    },
  });

  const submit = (): void => {
    setServerError(null);
    if (!result.valid) {
      setShowErrors(true);
      haptics.warn();
      return;
    }
    run.mutate();
  };

  if (script.isLoading || !scriptId) {
    return (
      <View className="gap-3 p-4">
        <SkeletonCard height={112} />
        <SkeletonList rows={3} />
      </View>
    );
  }
  if (script.isError || !script.data) {
    return (
      <View className="flex-1 p-4">
        <ErrorState
          title={script.isError ? 'Could not load this script' : 'Script not found'}
          message={script.error instanceof Error ? script.error.message : undefined}
          onRetry={() => void script.refetch()}
        />
      </View>
    );
  }

  const data = script.data;
  const profileList = profiles.data ?? [];
  const facts = [
    `${data.stageCount} stage${data.stageCount === 1 ? '' : 's'}`,
    profileList.length > 0 ? `${profileList.length} profile${profileList.length === 1 ? '' : 's'}` : null,
    defs.length > 0 ? `${defs.length} input${defs.length === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const summary = profile ? profileSummary(profile) : null;

  return (
    <View className="flex-1 bg-background">
      <PlainScroll onRefresh={pull.onRefresh} refreshing={pull.refreshing}>
        <Card className="gap-2 p-4">
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-control">
              <FileCode2 size={18} color={colors['muted-foreground']} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text numberOfLines={2} className="text-lg font-semibold text-foreground">
                {data.name}
              </Text>
              <Text className="text-sm text-muted-foreground">{facts}</Text>
            </View>
          </View>
          {data.description ? (
            <Text className="text-sm leading-relaxed text-muted-foreground">{data.description}</Text>
          ) : null}
          {data.tags.length > 0 ? (
            <View className="flex-row flex-wrap gap-1.5">
              {data.tags.slice(0, 6).map((tag) => (
                <Badge key={tag} label={tag} tone="neutral" />
              ))}
            </View>
          ) : null}
        </Card>

        {profileList.length > 0 ? (
          <View className="gap-2">
            <SectionHeader title="Profile" />
            <View className="flex-row flex-wrap gap-2">
              <Chip label="Defaults" selected={profileName === null} tone="accent" onPress={() => setProfileName(null)} />
              {profileList.map((p) => (
                <Chip
                  key={p.name}
                  label={p.name}
                  selected={profileName === p.name}
                  tone="accent"
                  maxWidth={220}
                  onPress={() => setProfileName(profileName === p.name ? null : p.name)}
                  {...(p.description ? { accessibilityHint: p.description } : {})}
                />
              ))}
            </View>
            {profile?.description || summary ? (
              <Text className="text-sm text-muted-foreground">
                {[profile?.description, summary].filter(Boolean).join(' — ')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {defs.length > 0 ? (
          <View className="gap-4">
            <SectionHeader title="Inputs" />
            {defs.map((def) => (
              <VariableField
                key={def.name}
                def={def}
                value={draft[def.name]}
                error={showErrors ? result.errors[def.name] : undefined}
                onChange={(value) => setDraft((prev) => ({ ...prev, [def.name]: value }))}
              />
            ))}
          </View>
        ) : null}

        {pickableProjects.length > 0 ? (
          <View className="gap-2">
            <SectionHeader title="Project" />
            <View className="flex-row flex-wrap gap-2">
              <Chip label="None" selected={projectId === null} onPress={() => setProjectId(null)} />
              {pickableProjects.map((p) => (
                <Chip
                  key={p.id}
                  label={p.name}
                  selected={projectId === p.id}
                  tone="accent"
                  maxWidth={220}
                  onPress={() => setProjectId(p.id)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {data.stages.length > 0 ? (
          <>
            <SectionHeader title={`Stages (${data.stages.length})`} />
            <Card className="px-4 py-1">
              {data.stages.map((stage, index) => (
                <View
                  key={stage.key}
                  className={`flex-row gap-3 py-3 ${index > 0 ? 'border-t border-border-muted' : ''}`}
                >
                  <View className="h-7 w-7 items-center justify-center rounded-full bg-control">
                    <Text className="text-sm font-semibold text-muted-foreground">{index + 1}</Text>
                  </View>
                  <View className="min-h-7 flex-1 justify-center gap-1">
                    <Text numberOfLines={1} className="text-md font-medium text-foreground">
                      {stage.name}
                    </Text>
                    {stage.description ? (
                      <Text numberOfLines={3} className="text-sm leading-relaxed text-muted-foreground">
                        {stage.description}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {serverError ? (
          <Text accessibilityLiveRegion="assertive" className="text-sm text-danger">
            {serverError}
          </Text>
        ) : null}

        <View style={{ height: STICKY_BAR_SPACE }} />
      </PlainScroll>

      <StickyActionBar>
        {runControl.available ? (
          <Button
            label={profileName ? `Run with ${profileName}` : 'Run script'}
            size="lg"
            full
            haptic="commit"
            icon={<Play size={18} color={colors['primary-foreground']} />}
            loading={run.isPending}
            disabled={run.isPending}
            onPress={submit}
            accessibilityHint="Creates a workflow from this script and starts a run"
          />
        ) : (
          <View className="flex-row items-center gap-3">
            <Lock size={16} color={colors['muted-foreground']} />
            <Text className="flex-1 text-sm text-muted-foreground">
              Running scripts needs workflow and agent permission on this device.
            </Text>
            <Button label="Request access" variant="secondary" size="sm" onPress={runControl.requestAccess} />
          </View>
        )}
      </StickyActionBar>
    </View>
  );
}
