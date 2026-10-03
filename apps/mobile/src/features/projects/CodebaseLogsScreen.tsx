// Fetch logs (MCodebaseLogs; `/projects/[id]/codebases/[cid]/logs`, G-16): the job (Cloning / Fetching / Succeeded /
// Failed + started · elapsed), git's progress bar and phase, the mono log lines (time + text; stderr in fg-2) following
// the tail while the job runs (polled every second); Copy all; "Retry fetch" after a failure.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import type { CodebaseJob } from '@generatorai/shared';

import { PROJECTS_HREF, codebaseHref, projectHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { Screen } from '../../ui/layout/Screen';
import { errorText, formatElapsed } from '../../ui/lib/format';
import { Header } from '../../ui/native/router/Header';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ProgressBar } from '../../ui/primitives/ProgressBar';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { logProgress, logTime } from './model/projectsModel';
import { useCodebaseLogs, useCodebaseWrites, useProject } from './queries';

/** A clock for the running job's elapsed time; idle once it ends. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function jobBadge(job: CodebaseJob): { state: 'running' | 'succeeded' | 'failed'; label: string } {
  if (job.status === 'running') return { state: 'running', label: job.kind === 'clone' ? 'Cloning' : 'Fetching' };
  return job.status === 'succeeded' ? { state: 'succeeded', label: 'Done' } : { state: 'failed', label: 'Failed' };
}

export default function CodebaseLogsScreen(): React.ReactElement {
  const { id = '', cid = '' } = useLocalSearchParams<{ id: string; cid: string }>();
  const onBack = useHeaderBack();
  const canEdit = checkFeature('projectEdit', useGrantedScopes()).available;
  const project = useProject(id);
  const codebase = project.data?.codebases.find((c) => c.id === cid);
  const logs = useCodebaseLogs(id, cid);
  const writes = useCodebaseWrites(id);
  const scroller = useRef<ScrollView | null>(null);
  const breadcrumb = useBreadcrumb(
    useMemo(
      () => [
        { label: 'Projects', href: PROJECTS_HREF },
        { label: project.data?.name ?? 'Project', href: projectHref(id) },
        { label: codebase?.alias ?? 'Codebase', href: codebaseHref(id, cid) },
      ],
      [project.data?.name, codebase?.alias, id, cid],
    ),
  );
  const lines = useMemo(() => logs.data?.lines ?? [], [logs.data]);
  const job = logs.data?.job;
  const progress = logProgress(lines);
  const running = job?.status === 'running';
  useEffect(() => {
    if (running) scroller.current?.scrollToEnd({ animated: false });
  }, [lines.length, running]);
  const now = useNow(running);
  const elapsed = job ? formatElapsed((job.endedAt ? Date.parse(job.endedAt) : now) - Date.parse(job.startedAt)) : '';
  const copyAll = (): void => void Clipboard.setStringAsync(lines.map((l) => `${logTime(l.ts)} ${l.text}`).join('\n'));

  const header = <Header role="detail" title="Logs" breadcrumb={breadcrumb} onBack={onBack} actions={[{ id: 'copy', icon: 'copy', label: 'Copy all', onPress: copyAll }]} />;
  const state = logs.isLoading
    ? { kind: 'loading' as const }
    : logs.isError
      ? { kind: 'error' as const, error: logs.error, onRetry: () => void logs.refetch(), title: "Couldn't load the logs" }
      : lines.length === 0 && !job
        ? { kind: 'empty' as const, empty: <EmptyState icon="file-text" title="No logs yet" description="Clone and fetch output shows here." /> }
        : { kind: 'ready' as const };

  return (
    <Screen header={header} state={state} scroll="none" testID="codebase-logs">
      <View className="flex-1 gap-3 px-4 pb-4 pt-2">
        {job ? (
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <StatusBadge state={jobBadge(job).state} label={jobBadge(job).label} size="sm" />
              <Text role="monoSm" tone="fg-3" className="flex-1">
                {`started ${logTime(job.startedAt)} · ${elapsed}`}
              </Text>
              {progress && running ? (
                <Text role="monoSm" tone="fg-2">
                  {`${progress.percent}%`}
                </Text>
              ) : null}
            </View>
            {running ? <ProgressBar {...(progress ? { value: progress.percent / 100 } : {})} accessibilityLabel={progress?.phase ?? 'Working'} /> : null}
            {progress && running ? (
              <Text role="footnote" tone="fg-2">
                {progress.phase}
              </Text>
            ) : null}
            {job.status === 'failed' && job.error ? (
              <Text role="footnote" tone="err">
                {job.error}
              </Text>
            ) : null}
          </View>
        ) : null}
        <ScrollView ref={scroller} className="flex-1 rounded-card bg-sunken" contentContainerClassName="gap-1 p-3" testID="codebase-logs-lines">
          {lines.map((l, i) => (
            <View key={i} className="flex-row gap-3">
              <Text role="monoSm" tone="fg-3">
                {logTime(l.ts)}
              </Text>
              <Text role="monoSm" tone={l.stream === 'stderr' ? 'fg-2' : 'fg'} selectable className="flex-1">
                {l.text.split('\r').pop()}
              </Text>
            </View>
          ))}
        </ScrollView>
        <Text role="footnote" tone="fg-3">
          The fetch keeps running if you leave this screen. Failures also show here with the full git output.
        </Text>
        {job?.status === 'failed' && canEdit && codebase?.type === 'git-remote' ? (
          <Button
            label="Retry fetch"
            icon="retry"
            fullWidth
            onPress={() => writes.fetch(cid).then(() => void logs.refetch()).catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }))}
            testID="codebase-logs-retry"
          />
        ) : null}
      </View>
    </Screen>
  );
}

