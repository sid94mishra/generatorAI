// ────────────────────────────────────────────────────────────────
// Settings ▸ Audio — the phone form of the desktop Audio section.
//
// Dictation and read-aloud both run on the SERVER (speech never leaves the
// machine GeneratorAI runs on), so how they behave is a server setting the
// phone depends on every time the mic button is used. It used to be reachable
// from desktop only. Reads `/api/system/audio`; writing needs the "Change
// server settings" permission and applies live, to every connected client.
//
// Not here: the microphone picker (it chooses an input of the desktop
// machine; a phone's input is routed by the OS) and the 790MB speech-model
// download, which belongs on the machine it lands on.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AudioLines, Check, Mic, Volume2 } from 'lucide-react-native';

import { useAuth } from '../../src/auth/AuthProvider';
import { checkFeature } from '../../src/auth/featureGate';
import { Chip } from '../../src/components/ui/Chip';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { Card, SectionHeader } from '../../src/components/ui/primitives';
import { Screen } from '../../src/components/ui/Screen';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { ErrorState } from '../../src/components/ui/States';
import { useToast } from '../../src/components/ui/Toast';
import { haptics } from '../../src/components/ui/haptics';
import { useTheme } from '../../src/theme/ThemeProvider';
import {
  ENGINE_DETAIL,
  FORMATTER_DETAIL,
  SPEED_STOPS,
  engineLabel,
  formatterLabel,
  parseAudioSettings,
  pauseLabel,
  pauseStops,
  speedLabel,
  type AudioSettings,
} from '../../src/settings/audioModel';

const AUDIO_KEY = ['system', 'audio'] as const;

type AudioPatch = Partial<Pick<AudioSettings, 'sttEngine' | 'textFormatter' | 'endpointSilenceMs' | 'ttsEnabled' | 'ttsSpeed'>>;

export default function AudioSettingsScreen(): React.ReactElement {
  const auth = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const scopes = auth.state.status === 'authenticated' ? auth.state.scopes : [];
  const canManage = checkFeature('capabilityAdmin', scopes).available;

  const audio = useQuery({
    queryKey: AUDIO_KEY,
    queryFn: async () => {
      const res = await auth.fetch('/api/system/audio');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseAudioSettings(await res.json());
      if (!parsed) throw new Error('Unexpected response');
      return parsed;
    },
  });

  const save = useMutation({
    mutationFn: async (patch: AudioPatch) => {
      const res = await auth.fetch('/api/system/audio', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseAudioSettings(await res.json());
    },
    // Optimistic: a settings row that lags its own tap feels broken.
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: AUDIO_KEY });
      const previous = queryClient.getQueryData<AudioSettings>(AUDIO_KEY);
      if (previous) queryClient.setQueryData<AudioSettings>(AUDIO_KEY, { ...previous, ...patch });
      return { previous };
    },
    onSuccess: (next) => {
      if (next) queryClient.setQueryData(AUDIO_KEY, next);
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(AUDIO_KEY, context.previous);
      haptics.error();
      toast({ message: 'That setting did not save. Try again.', variant: 'danger' });
    },
  });

  const set = (patch: AudioPatch): void => {
    haptics.select();
    save.mutate(patch);
  };

  const data = audio.data;
  const engineLocked = Boolean(data?.engineLockedByEnv);

  return (
    <Screen title="Audio" back backFallback="/settings" onRefresh={() => audio.refetch()} refreshing={audio.isFetching}>
      <Text className="text-sm leading-relaxed text-muted-foreground">
        Dictation and read-aloud run on the machine hosting GeneratorAI — audio is never sent to a cloud service.
        {canManage ? ' Changes apply straight away, on every connected device.' : ''}
      </Text>

      {audio.isLoading ? (
        <SkeletonList rows={4} />
      ) : audio.isError || !data ? (
        <ErrorState message="Could not load the audio settings." onRetry={() => void audio.refetch()} />
      ) : (
        <>
          <SectionHeader title="Speech to text" />
          <ListGroup>
            {data.engines.map((id) => (
              <ListRow
                key={id}
                title={engineLabel(id)}
                subtitle={ENGINE_DETAIL[id] ?? null}
                icon={<Mic size={18} color={colors['muted-foreground']} />}
                selected={data.sttEngine === id}
                chevron={false}
                trailing={<SelectionCheck selected={data.sttEngine === id} color={colors.primary} />}
                disabled={!canManage || engineLocked}
                {...(canManage && !engineLocked ? { onPress: () => set({ sttEngine: id }) } : {})}
                accessibilityLabel={`${engineLabel(id)}${data.sttEngine === id ? ', selected' : ''}`}
              />
            ))}
          </ListGroup>
          {engineLocked ? (
            <Text className="px-1 text-sm text-warning">
              The engine is pinned to “{data.engineLockedByEnv}” by the server’s environment, so it cannot be changed here.
            </Text>
          ) : null}

          <SectionHeader title="Spoken punctuation" />
          <ListGroup>
            {data.formatters.map((id) => (
              <ListRow
                key={id}
                title={formatterLabel(id)}
                subtitle={FORMATTER_DETAIL[id] ?? null}
                icon={<AudioLines size={18} color={colors['muted-foreground']} />}
                selected={data.textFormatter === id}
                chevron={false}
                trailing={<SelectionCheck selected={data.textFormatter === id} color={colors.primary} />}
                disabled={!canManage}
                {...(canManage ? { onPress: () => set({ textFormatter: id }) } : {})}
                accessibilityLabel={`Spoken punctuation ${formatterLabel(id)}${data.textFormatter === id ? ', selected' : ''}`}
              />
            ))}
          </ListGroup>

          <SectionHeader title="Pause before committing" />
          <Card className="gap-3 p-4">
            <Text className="text-sm leading-relaxed text-muted-foreground">
              How long a silence ends a sentence and adds it to the message. Shorter feels snappier; too short splits
              sentences mid-thought.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {pauseStops(data.minEndpointMs, data.maxEndpointMs, data.endpointSilenceMs).map((ms) => (
                <Chip
                  key={ms}
                  label={pauseLabel(ms)}
                  accessibilityLabel={`${pauseLabel(ms)} pause`}
                  selected={data.endpointSilenceMs === ms}
                  tone="accent"
                  disabled={!canManage}
                  {...(canManage ? { onPress: () => set({ endpointSilenceMs: ms }) } : {})}
                />
              ))}
            </ScrollView>
          </Card>

          <SectionHeader title="Text to speech" />
          <ListGroup>
            <ListRow
              title="Read replies aloud"
              subtitle="Adds Read aloud to assistant messages."
              icon={<Volume2 size={18} color={colors['muted-foreground']} />}
              disabled={!canManage}
              {...(canManage
                ? { toggle: { value: data.ttsEnabled, onValueChange: (next: boolean) => set({ ttsEnabled: next }) } }
                : {})}
              accessibilityLabel={`Read replies aloud, ${data.ttsEnabled ? 'on' : 'off'}`}
            />
          </ListGroup>
          {data.ttsEnabled ? (
            <Card className="gap-3 p-4">
              <Text className="text-sm text-muted-foreground">Speaking speed</Text>
              <View className="flex-row flex-wrap gap-2">
                {SPEED_STOPS.map((speed) => (
                  <Chip
                    key={speed}
                    label={speedLabel(speed)}
                    accessibilityLabel={`Speed ${speedLabel(speed)}`}
                    selected={Math.abs(data.ttsSpeed - speed) < 0.01}
                    tone="accent"
                    disabled={!canManage}
                    {...(canManage ? { onPress: () => set({ ttsSpeed: speed }) } : {})}
                  />
                ))}
              </View>
            </Card>
          ) : null}

          {!canManage ? (
            <Card className="p-4">
              <Text className="text-sm text-muted-foreground">
                Read-only on this phone. Changing these needs the “Change server settings” permission — ask for it
                from Settings › Security, or change them on the desktop.
              </Text>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}

/** A picked row carries a tick, not a chevron — it selects, it does not navigate. */
function SelectionCheck({ selected, color }: { selected: boolean; color: string | undefined }): React.ReactElement {
  return <View className="w-[18px] items-center">{selected ? <Check size={18} color={color} /> : null}</View>;
}
