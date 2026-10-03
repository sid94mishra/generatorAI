// `generatorai:///live?script=<id>` (dev builds only; 08 §6 system-surface smoke, M9-01): plays a fixture script
// into the live store a step every few seconds and lists what the model makes of it — the state, the surface
// candidates, the lock-screen form and the dismissal. With no script it lists the store as it is.
import React, { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { isLiveStale, liveDismissal, redactForLockScreen, type LiveState } from '@generatorai/client-core';

import { useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { followLive, liveStore, readFollowed, readLiveSurfacePrefs, useFollowVersion, useLiveMap } from '../../services/live/liveStore';
import { surfaceCandidates } from '../../services/live/liveSurfaces';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';
import { FIXTURE_KEYS, FIXTURE_SERVER, isLiveScriptId, liveScript } from './liveScripts';

const STEP_MS = 3000;

export default function LiveScreen(): React.ReactElement {
  return __DEV__ ? <LiveInspector /> : <Redirect href="/" />;
}

function describe(s: LiveState, now: Date): string {
  const step = s.step ? [s.step.index && s.step.count ? `${s.step.index}/${s.step.count}` : '', s.step.label ?? ''].filter(Boolean).join(' · ') : '';
  return [s.statusWord, step, s.ask?.summary, s.next ? `Next: ${s.next}` : '', isLiveStale(s, now) ? 'Updates paused' : ''].filter(Boolean).join(' · ');
}

function LiveInspector(): React.ReactElement {
  const params = useLocalSearchParams<{ script?: string }>();
  const onBack = useHeaderBack();
  const map = useLiveMap();
  useFollowVersion();
  const [played, setPlayed] = useState<string>('');

  useEffect(() => {
    if (!isLiveScriptId(params.script)) return;
    const steps = liveScript(params.script, new Date());
    followLive(FIXTURE_SERVER.id, 'workflow_run', FIXTURE_KEYS.run.split(':')[2]!);
    followLive(FIXTURE_SERVER.id, 'chat', FIXTURE_KEYS.chat.split(':')[2]!);
    liveStore.dispatch({ type: 'forgetServer', serverId: FIXTURE_SERVER.id });
    const timers = steps.map((step, i) =>
      setTimeout(() => {
        liveStore.dispatch(step.event(new Date()));
        setPlayed(`${i + 1}/${steps.length} · ${step.label}`);
      }, i * STEP_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [params.script]);

  const now = new Date();
  const states = Object.values(map);
  // Re-read on every render: `useFollowVersion` re-renders when the follow set changes.
  const followed = new Set([...new Set(states.map((s) => s.serverId))].flatMap((id) => [...readFollowed(id)]));
  const candidates = surfaceCandidates(map, followed, readLiveSurfacePrefs());

  return (
    <Screen header={<Header role="detail" title="Live state" onBack={onBack} />} background="grouped" testID="dev-live-screen">
      <ListSection title="Script" footer={`Scripts: ${['run-needs-you', 'run-fails', 'chat-permission'].join(', ')}`}>
        <ListRow kind="value" title={isLiveScriptId(params.script) ? params.script : 'None'} value={played || '—'} testID="dev-live-step" />
      </ListSection>
      <ListSection title="Items" count={states.length}>
        {states.length ? (
          states.map((s) => <ListRow key={s.key} kind="info" title={s.title} subtitle={describe(s, now)} value={s.entity} testID={`dev-live-item-${s.entityId}`} />)
        ) : (
          <ListRow kind="info" title="No live items" />
        )}
      </ListSection>
      <ListSection title="Surfaces (at most 3)" count={candidates.length}>
        {candidates.map((s) => {
          const locked = redactForLockScreen(s);
          return <ListRow key={s.key} kind="info" title={locked.title} subtitle={`Lock screen: ${describe(locked, now)}`} value={s.deepLink} mono testID={`dev-live-surface-${s.entityId}`} />;
        })}
      </ListSection>
      <ListSection title="Ending">
        {states
          .filter((s) => s.endedAt)
          .map((s) => {
            const end = liveDismissal(s);
            return <ListRow key={s.key} kind="info" title={s.title} value={end ? `Dismiss ${end.at.toLocaleTimeString()}` : 'Awaiting outcome'} />;
          })}
      </ListSection>
    </Screen>
  );
}
